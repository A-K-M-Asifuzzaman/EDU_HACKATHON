"""DGHS GIS integration tests against a MOCK ArcGIS server.

The mock below is a test fixture with INVENTED attribute names and values. It is not DGHS data and says nothing about the real layer's
schema (which could not be reached when this was written). It checks our protocol handling: pagination, filters, caching, outages and
the rule that dataset ward IDs are never attached to official polygons.
"""
import re

import pytest
from fastapi.testclient import TestClient

from dengueshield.api import geo
from dengueshield.data import RAW_PATH

FIELDS = [{"name": "objectid", "type": "esriFieldTypeOID", "alias": "OBJECTID"},
          {"name": "dist_name", "type": "esriFieldTypeString", "alias": "District"},
          {"name": "city_name", "type": "esriFieldTypeString", "alias": "City Corporation"},
          {"name": "ward_no", "type": "esriFieldTypeInteger", "alias": "Ward No"}]
ROWS = [{"objectid": i + 1, "dist_name": "D'One" if i < 3 else "DTwo", "city_name": "CityA" if i < 2 else "CityB", "ward_no": i + 1} for i in range(5)]


class FakeArcGIS:
    def __init__(self, max_record=2):
        self.calls, self.max_record, self.down, self.error = [], max_record, False, None

    def __call__(self, url, params):
        self.calls.append((url, dict(params)))
        if self.down:
            raise geo.GeoError("ConnectTimeout: simulated outage")
        if self.error:
            raise geo.GeoError(self.error)
        if not url.endswith("/query"):
            return {"name": "mock", "type": "Feature Layer", "geometryType": "esriGeometryPolygon", "maxRecordCount": self.max_record, "fields": FIELDS,
                    "objectIdField": "objectid", "supportsPagination": True, "supportedQueryFormats": "JSON, geoJSON"}
        rows = list(ROWS)
        for fld, q in re.findall(r"(\w+) = ('(?:[^']|'')*'|-?\d+)", params["where"]):
            v = q[1:-1].replace("''", "'") if q.startswith("'") else q
            rows = [r for r in rows if str(r[fld]) == v]
        if params.get("returnDistinctValues") == "true":
            f = params["outFields"]
            return {"features": [{"attributes": {f: v}} for v in sorted({r[f] for r in rows})]}
        off, n = int(params["resultOffset"]), int(params["resultRecordCount"])
        page = rows[off:off + n]
        out = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": r, "geometry": {"type": "Polygon", "coordinates": [[[90, 23], [90.1, 23], [90.1, 23.1], [90, 23]]]}} for r in page]}
        if off + n < len(rows):
            out["exceededTransferLimit"] = True
        return out


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    from dengueshield.api import climate
    f = FakeArcGIS()
    monkeypatch.setattr(geo, "_http_get", f)
    monkeypatch.setattr(geo, "CACHE_DIR", tmp_path)
    for k in [k for k in climate.MEM if k.startswith("geo_")]:
        del climate.MEM[k]
    for k in ("DGHS_FIELD_DISTRICT", "DGHS_FIELD_CITY", "DGHS_FIELD_WARD"):
        monkeypatch.delenv(k, raising=False)
    return f


def test_pagination_collects_every_feature_in_stable_order(fake):
    out = geo.geojson({})
    assert [f["properties"]["objectid"] for f in out["features"]] == [1, 2, 3, 4, 5]
    assert out["dghs"]["pages"] == 3 and out["dghs"]["truncated"] is False
    pages = [p for u, p in fake.calls if u.endswith("/query")]
    assert [p["resultOffset"] for p in pages] == [0, 2, 4] and all(p["orderByFields"] == "objectid" and p["f"] == "geojson" and p["outSR"] == 4326 for p in pages)


def test_fields_are_detected_from_metadata_not_assumed(fake):
    d = geo.detect_fields(geo.meta()[0])
    assert (d["district"]["name"], d["city"]["name"], d["ward"]["name"]) == ("dist_name", "city_name", "ward_no")
    assert geo.detect_fields({"fields": [{"name": "objectid", "type": "esriFieldTypeOID"}]}) == {"district": None, "city": None, "ward": None}


def test_filters_build_safe_where_and_filter_results(fake):
    out = geo.geojson({"district": "D'One", "city": "CityA"})
    assert out["dghs"]["where"] == "dist_name = 'D''One' AND city_name = 'CityA'" and out["dghs"]["count"] == 2
    assert geo.geojson({"ward": "4"})["dghs"]["count"] == 1
    for bad in ({"ward": "4 OR 1=1"}, {"district": "x\x00"}, {"district": "y" * 81}):
        with pytest.raises(ValueError):
            geo.geojson(bad)


def test_filter_on_a_role_the_layer_lacks_is_refused_not_guessed(fake, monkeypatch):
    monkeypatch.setattr(geo, "detect_fields", lambda m: {"district": None, "city": None, "ward": None})
    with pytest.raises(ValueError, match="no detected 'city' field"):
        geo.geojson({"city": "CityA"})


def test_options_are_narrowed_by_parent_selection(fake):
    assert geo.options({})["options"]["district"] == ["D'One", "DTwo"]
    assert geo.options({"district": "DTwo"})["options"]["city"] == ["CityB"]


def test_results_are_cached_and_served_stale_when_the_service_dies(fake, monkeypatch):
    geo.geojson({})
    n = len(fake.calls)
    assert geo.geojson({})["dghs"]["cache"]["cached"] is True and len(fake.calls) == n            # no new upstream calls
    from dengueshield.api import climate
    climate.MEM.clear()
    fake.down = True
    monkeypatch.setattr(geo, "TTL", {k: 0 for k in geo.TTL})                                        # expire freshness; files stay on disk
    s = geo.geojson({})
    assert s["dghs"]["cache"]["stale"] is True and s["dghs"]["count"] == 5


def test_outage_without_cache_raises_cleanly_and_status_reports_unavailable(fake):
    fake.down = True
    with pytest.raises(geo.GeoError):
        geo.geojson({})
    st = geo.status()
    assert st["status"] == "unavailable" and st["id_mapping"]["verified"] is False and "unaffected" in st["note"]


def test_arcgis_error_payload_is_an_error_not_empty_data(fake):
    fake.error = "service error 400: Unable to complete operation."
    with pytest.raises(geo.GeoError, match="400"):
        geo.geojson({})


def test_http_layer_trips_the_circuit_breaker_after_a_network_failure(monkeypatch):
    import httpx
    monkeypatch.setitem(geo.STATE, "down_until", 0.0)
    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise httpx.ConnectTimeout("simulated")
    monkeypatch.setattr(httpx, "get", boom)
    for _ in range(3):
        with pytest.raises(geo.GeoError):
            geo._http_get(geo.LAYER, {"f": "json"})
    assert len(calls) == 1                                                                           # later calls fail fast, no hanging
    geo.STATE["down_until"] = 0.0


def test_truncation_is_flagged(fake, monkeypatch):
    monkeypatch.setattr(geo, "MAX_FEATURES", 3)
    out = geo.geojson({})
    assert out["dghs"]["count"] == 3 and out["dghs"]["truncated"] is True


def test_official_polygons_never_carry_dataset_ward_ids_or_forecasts(fake):
    out = geo.geojson({})
    assert out["dghs"]["id_mapping"] == {**geo.ID_MAPPING} and out["dghs"]["id_mapping"]["status"] == "unmapped"
    for f in out["features"]:
        assert set(f["properties"]) == {"objectid", "dist_name", "city_name", "ward_no"}            # exactly the source attributes, nothing added


@pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")
def test_endpoints_degrade_to_503_and_the_rest_of_the_app_keeps_working(fake):
    from dengueshield.api.main import app
    c = TestClient(app)
    fake.down = True
    for u in ("/api/geo/dghs/wards", "/api/geo/dghs/filters"):
        r = c.get(u)
        assert r.status_code == 503 and r.json()["status"] == "unavailable" and r.json()["id_mapping"]["verified"] is False
    assert c.get("/api/geo/dghs/status").json()["status"] == "unavailable"
    assert c.get("/api/health").json()["status"] == "ok"
    assert c.get("/api/forecast?ward_id=DNCC_Ward_19&origin=2024-08-05&horizon=3").status_code == 200
    ids = {i["id"]: i for i in c.get("/api/integrations/status").json()["integrations"]}
    assert ids["dghs_gis"]["feeds_inference"] is False


@pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")
def test_endpoints_validate_input_and_serve_geojson(fake):
    from dengueshield.api.main import app
    c = TestClient(app)
    r = c.get("/api/geo/dghs/wards", params={"district": "DTwo"})
    assert r.status_code == 200 and r.json()["dghs"]["count"] == 2 and r.headers["content-type"].startswith("application/json")
    assert c.get("/api/geo/dghs/wards", params={"ward": "1; DROP"}).status_code == 422
    assert c.get("/api/geo/dghs/wards", params={"simplify": 5}).status_code == 422
