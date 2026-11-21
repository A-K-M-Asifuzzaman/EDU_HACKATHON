"""DGHS Bangladesh GIS: authoritative ward boundaries (ArcGIS REST FeatureServer), used as CONTEXTUAL geography only.

The organizer dataset's ward IDs (e.g. DNCC_Ward_19) are synthetic identifiers. No verified identifier mapping to the official wards
exists, so this module never attaches a dataset ward ID, forecast or risk value to an official polygon (`ID_MAPPING` says so in every response).

The layer schema was NOT verified when this was written (the host was unreachable from the development network), so district/city/ward
fields are discovered at runtime from the service's own metadata (override with DGHS_FIELD_DISTRICT / _CITY / _WARD). Network access goes
through one function (`_http_get`) with a short connect timeout and a circuit breaker; payloads are cached on disk with stale fallback.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from typing import Optional

import httpx

from dengueshield.api.climate import cached_fetch
from dengueshield.api.store import CACHE_ROOT, ROOT

LAYER = os.environ.get("DGHS_LAYER_URL", "https://gis.dghs.gov.bd/server/rest/services/Hosted/All_Wards_main/FeatureServer/0")
CACHE_DIR = CACHE_ROOT / "geo"
TTL = {"meta": 86400, "distinct": 86400, "geojson": 7 * 86400}   # administrative boundaries change rarely
MAX_FEATURES = 3000          # hard cap per response (payload size); the response says when it truncated
PAGE = 1000                  # upper bound; the server's maxRecordCount is respected when smaller
BREAKER_S = 60               # after a network failure, fail fast for this long instead of hanging every request
STATE: dict = {"last_ok": None, "last_err": None, "down_until": 0.0, "calls": 0}

ATTRIBUTION = ("Administrative boundaries: Directorate General of Health Services (DGHS), Ministry of Health and Family Welfare, "
               "Government of Bangladesh (gis.dghs.gov.bd, layer Hosted/All_Wards_main).")
LICENSE = ("Reuse terms NOT verified: the service metadata could not be read from the development network and no licence was found. "
           "Boundaries are fetched at runtime for display, cached locally and not redistributed in this repository.")
ID_MAPPING = {"status": "unmapped", "verified": False,
              "reason": ("The dataset's ward IDs are synthetic identifiers with no published crosswalk to official ward codes. "
                         "Matching by name or number would be a guess, so official polygons carry no forecast or risk values. "
                         "Predictions are shown in a separate, non-geographic ward-risk matrix.")}
ROLE_PATTERNS = {"district": r"dist|zila|জেলা", "city": r"city|corporation|municipal|pourashava|paurashava|upazila|upazilla|\bcc\b|উপজেলা|সিটি",
                 "ward": r"ward|ওয়ার্ড"}


class GeoError(Exception):
    pass


def _http_get(url: str, params: dict) -> dict:
    """The single network seam (tests replace it). Short connect timeout; ArcGIS reports many errors as HTTP 200 + {"error": ...}."""
    if time.time() < STATE["down_until"]:
        raise GeoError(f"DGHS GIS recently unreachable ({STATE['last_err']}); retrying after {BREAKER_S}s")
    STATE["calls"] += 1
    try:
        r = httpx.get(url, params=params, timeout=httpx.Timeout(30.0, connect=6.0), headers={"User-Agent": "dengueshield-geo"}, follow_redirects=True)
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError) as e:
        STATE["last_err"] = f"{type(e).__name__}: {e}"[:200]
        STATE["down_until"] = time.time() + BREAKER_S
        raise GeoError(STATE["last_err"]) from e
    if isinstance(body, dict) and "error" in body:
        err = body["error"]
        STATE["last_err"] = f"service error {err.get('code')}: {err.get('message')}"[:200]
        raise GeoError(STATE["last_err"])
    STATE["last_ok"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return body


def _key(*parts) -> str:
    return "geo_" + hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:24]


def meta() -> tuple[dict, dict]:
    def fetch():
        m = _http_get(LAYER, {"f": "json"})
        if "fields" not in m:
            raise GeoError("layer metadata has no 'fields'; this is not a feature layer")
        return m
    return cached_fetch(_key("meta", LAYER), TTL["meta"], fetch, CACHE_DIR)


def detect_fields(m: dict) -> dict:
    """Map role -> field definition using env overrides first, then name/alias patterns. Unmatched roles are None (never guessed)."""
    fields = {f["name"]: f for f in m.get("fields", [])}
    out: dict = {}
    for role, pat in ROLE_PATTERNS.items():
        forced = os.environ.get(f"DGHS_FIELD_{role.upper()}")
        hit = fields.get(forced) if forced else next((f for f in fields.values() if f.get("type") in ("esriFieldTypeString", "esriFieldTypeInteger", "esriFieldTypeSmallInteger")
                                                      and re.search(pat, f"{f['name']} {f.get('alias') or ''}", re.I)), None)
        out[role] = {"name": hit["name"], "alias": hit.get("alias"), "type": hit["type"]} if hit else None
    return out


def _lit(f: dict, v: str) -> str:
    """SQL literal for a validated filter value: numbers stay numeric, strings are quoted with ' doubled."""
    if f["type"] == "esriFieldTypeString":
        return "'" + v.replace("'", "''") + "'"
    if not re.fullmatch(r"-?\d{1,12}", v):
        raise ValueError(f"'{v}' is not a valid integer for field {f['name']}")
    return v


def build_where(fields: dict, filters: dict) -> str:
    parts = []
    for role in ("district", "city", "ward"):
        v = filters.get(role)
        if v in (None, ""):
            continue
        if fields.get(role) is None:
            raise ValueError(f"this layer has no detected '{role}' field; available roles: {[r for r, f in fields.items() if f] or 'none'}")
        if len(v) > 80 or re.search(r"[\x00-\x1f]", v):
            raise ValueError(f"invalid {role} value")
        parts.append(f"{fields[role]['name']} = {_lit(fields[role], v)}")
    return " AND ".join(parts) or "1=1"


def status() -> dict:
    base = {"source": "DGHS Bangladesh GIS (ArcGIS REST FeatureServer)", "layer": LAYER, "attribution": ATTRIBUTION, "license": LICENSE, "id_mapping": ID_MAPPING,
            "last_ok": STATE["last_ok"], "last_error": STATE["last_err"]}
    try:
        m, c = meta()
    except Exception as e:
        return {**base, "status": "unavailable", "error": str(e)[:240], "note": "Forecasts and every other page are unaffected; boundaries are optional context."}
    return {**base, "status": "stale" if c["stale"] else "ok", "cache": c, "name": m.get("name"), "geometry_type": m.get("geometryType"),
            "max_record_count": m.get("maxRecordCount"), "supports_pagination": m.get("supportsPagination"), "formats": m.get("supportedQueryFormats"),
            "capabilities": m.get("capabilities"), "copyright_text": m.get("copyrightText") or None, "extent": m.get("extent"),
            "fields": [{"name": f["name"], "alias": f.get("alias"), "type": f["type"]} for f in m.get("fields", [])], "detected_fields": detect_fields(m)}


def options(filters: dict) -> dict:
    """Distinct values for the district/city/ward selectors, narrowed by the parent selection."""
    m, _ = meta()
    fields = detect_fields(m)
    out: dict = {"detected_fields": fields, "options": {}}
    parent: dict = {}
    for role in ("district", "city", "ward"):
        f = fields[role]
        if f is None:
            out["options"][role] = None
            continue
        where = build_where(fields, parent)

        def fetch(f=f, where=where):
            b = _http_get(LAYER + "/query", {"where": where, "outFields": f["name"], "returnDistinctValues": "true", "returnGeometry": "false",
                                             "orderByFields": f["name"], "resultRecordCount": 2000, "f": "json"})
            return [a["attributes"][f["name"]] for a in b.get("features", []) if a.get("attributes", {}).get(f["name"]) not in (None, "")]
        vals, _c = cached_fetch(_key("distinct", LAYER, f["name"], where), TTL["distinct"], fetch, CACHE_DIR)
        out["options"][role] = vals
        if filters.get(role) not in (None, ""):
            parent[role] = filters[role]
    return out


def geojson(filters: dict, simplify: float = 0.0002) -> dict:
    """Paginated GeoJSON (WGS84). Raises GeoError if the service is down and nothing is cached; ValueError for bad filters."""
    m, _ = meta()
    fields = detect_fields(m)
    where = build_where(fields, filters)
    page = max(1, min(PAGE, int(m.get("maxRecordCount") or PAGE)))
    oid = m.get("objectIdField") or next((f["name"] for f in m["fields"] if f["type"] == "esriFieldTypeOID"), None)

    def fetch():
        feats: list = []
        offset, truncated, pages = 0, False, 0
        while True:
            params = {"where": where, "outFields": "*", "returnGeometry": "true", "outSR": 4326, "geometryPrecision": 5, "f": "geojson",
                      "resultOffset": offset, "resultRecordCount": page}
            if oid:
                params["orderByFields"] = oid                                   # stable order is required for consistent pagination
            if simplify:
                params["maxAllowableOffset"] = simplify                         # degrees (outSR units); ~20 m at the default
            b = _http_get(LAYER + "/query", params)
            if b.get("type") != "FeatureCollection":
                raise GeoError("layer did not return GeoJSON (f=geojson unsupported?)")
            got = b.get("features", [])
            feats.extend(got)
            pages += 1
            more = bool(b.get("exceededTransferLimit")) or (len(got) == page)
            if len(feats) >= MAX_FEATURES:
                truncated = more or len(feats) > MAX_FEATURES
                feats = feats[:MAX_FEATURES]
                break
            if not got or not more:
                break
            offset += len(got)
        return {"type": "FeatureCollection", "features": feats, "_pages": pages, "_truncated": truncated}
    fc, c = cached_fetch(_key("geojson", LAYER, where, simplify, MAX_FEATURES), TTL["geojson"], fetch, CACHE_DIR)
    n_null = sum(1 for f in fc["features"] if not f.get("geometry"))
    return {"type": "FeatureCollection", "features": fc["features"],
            "dghs": {"source": "DGHS Bangladesh GIS", "attribution": ATTRIBUTION, "license": LICENSE, "id_mapping": ID_MAPPING, "filters": {k: v for k, v in filters.items() if v},
                     "where": where, "count": len(fc["features"]), "pages": fc["_pages"], "truncated": fc["_truncated"], "max_features": MAX_FEATURES,
                     "features_without_geometry": n_null, "simplified_degrees": simplify or None, "cache": c, "detected_fields": fields}}
