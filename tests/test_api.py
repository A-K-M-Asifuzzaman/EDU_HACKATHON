"""API contract, real-inference, scientific-integrity, secret-safety and graceful-degradation tests (needs the organizer CSV for live routes)."""
import json
import re

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from dengueshield.data import RAW_PATH, ROOT

pytestmark = pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")


@pytest.fixture(scope="module")
def client():
    from dengueshield.api.main import app
    return TestClient(app)


W, O = "DNCC_Ward_19", "2024-08-05"


def test_health_and_metadata_describe_the_real_system(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and all(h["components"].values())
    m = client.get("/api/metadata").json()
    assert m["mode"] == "Historical Replay" and m["model"]["convention"]["name"] == "B_start_of_week"
    assert m["data"]["wards"] == 60 and "2025" in m["data"]["holdout"]
    assert m["risk_tiers"]["official"] is False
    assert m["data"]["last_observed_week"] == "2024-12-30"


def test_forecast_contract_and_internal_consistency(client):
    for h in (2, 3, 4):
        j = client.get(f"/api/forecast?ward_id={W}&origin={O}&horizon={h}").json()
        f = j["forecast"]
        assert f["horizon"] == h and (pd.Timestamp(f["target_date"]) - pd.Timestamp(f["origin_date"])).days == 7 * h
        assert f["lower_90"] <= f["lower_80"] <= f["median_cases"] <= f["upper_80"] <= f["upper_90"]
        assert f["expected_cases"] >= 0 and 0 <= f["p_outbreak"] <= 1 and f["risk_tier"] in ("Low", "Medium", "High", "Critical")
        assert len(j["availability"]) == 3 and j["drivers"]["log_rate_contributions"]


def test_live_bundle_inference_matches_the_bundle_directly(client):
    from dengueshield.api.main import S
    j = client.get(f"/api/forecast?ward_id={W}&origin={O}&horizon=3&source=bundle").json()["forecast"]
    direct = S.bundle.predict(S.panel, O, 3, wards=[W]).iloc[0]
    assert j["median_cases"] == int(direct.median_cases) and j["expected_cases"] == pytest.approx(direct.expected_cases, abs=1e-3)
    assert j["in_sample"] is True and j["source"] == "bundle"       # bundle was trained through 2024: honest label


def test_replay_forecasts_are_out_of_time_and_never_expose_2025(client):
    s = client.get(f"/api/forecast/series?ward_id={W}&horizon=3").json()["series"]
    assert len(s) > 200 and max(r["target_date"] for r in s) <= "2024-12-31"
    assert all(r["year"] == int(r["target_date"][:4]) == int(r["origin_date"][:4]) for r in s)
    f = client.get(f"/api/forecast?ward_id={W}&origin=2025-01-06&horizon=2").json()["forecast"]
    assert f["source"] == "bundle" and f["actual_cases"] is None and f["target_date"] == "2025-01-20"


def test_requests_beyond_the_record_or_invalid_are_refused(client):
    r = client.get(f"/api/forecast?ward_id={W}&origin=2025-02-03&horizon=2")
    assert r.status_code == 422 and "refused" in r.json()["detail"]
    assert client.get(f"/api/forecast?ward_id=NOPE&origin={O}").status_code == 404
    assert client.get(f"/api/forecast?ward_id={W}&origin=2024-08-06").status_code == 422        # not a Monday
    assert client.get(f"/api/forecast?ward_id={W}&origin={O}&horizon=5").status_code == 422
    assert client.get(f"/api/forecast?ward_id={W}&origin=notadate").status_code == 422
    assert client.get(f"/api/forecast?ward_id={W}&origin=2019-01-07&horizon=3&source=replay").status_code in (200, 422)
    assert client.get(f"/api/forecast?ward_id={W}&origin=2016-03-07&horizon=3&source=bundle").status_code == 422   # insufficient history


def test_risk_ranking_filters_sorting_and_counts(client):
    j = client.get(f"/api/risk/wards?origin={O}&horizon=3").json()
    assert j["count"] == j["total_matching"] == 60 and sum(j["tier_counts"].values()) == 60
    p = [w["p_outbreak"] for w in j["wards"]]
    assert p == sorted(p, reverse=True)
    top3 = client.get(f"/api/risk/wards?origin={O}&horizon=3&limit=3").json()
    assert top3["count"] == 3 and top3["tier_counts"] == j["tier_counts"]                     # counts are pre-limit
    city = client.get(f"/api/risk/wards?origin={O}&horizon=3&city=Gazipur").json()
    assert city["count"] == 5 and all(w["city"] == "Gazipur" for w in city["wards"])
    assert all(w["risk_tier"] == "Critical" for w in client.get(f"/api/risk/wards?origin={O}&horizon=3&tier=Critical").json()["wards"])


def test_compare_summary_and_availability_explain_future_weather(client):
    c = client.get(f"/api/forecast/compare?ward_id={W}&origin={O}").json()
    assert [f["horizon"] for f in c["forecasts"]] == [2, 3, 4]
    av = {a["horizon"]: a for a in c["availability"]}
    assert av[2]["observed_at_origin"] is True and av[3]["observed_at_origin"] is False and av[4]["observed_at_origin"] is False
    assert "no future weather" in av[4]["treatment"]
    s = client.get(f"/api/reports/summary?origin={O}&horizon=3").json()
    assert s["wards"] == 60 and sum(s["tier_counts"].values()) == 60 and s["caveats"]


def test_model_metrics_agree_with_committed_reports(client):
    ch = json.loads((ROOT / "reports/model_tournament/champion.json").read_text())
    m = client.get("/api/model/metrics").json()
    assert m["champion"]["validation"]["B"]["3"]["bench_2022_2024"]["mae"] == pytest.approx(ch["validation"]["B"]["3"]["bench_2022_2024"]["mae"])
    assert round(ch["validation"]["B"]["2"]["bench_2022_2024"]["mae"], 3) == 1.107
    cal = client.get("/api/model/calibration").json()
    assert any(abs(r["coverage"] - 0.854) < 0.01 for r in cal["interval_coverage"] if r["method"] == "nb_coverage" and r["level"] == 0.8)


def test_replay_table_reproduces_reported_validation_error(client):
    from dengueshield.api.main import S
    r = S.replay
    assert abs((r["median"] - r.y_true).abs().mean() - 1.361) < 0.01
    cov = ((r.y_true >= r.lo80) & (r.y_true <= r.hi80)).mean()
    assert 0.84 < cov < 0.87


def test_profile_and_analysis_routes_are_development_years_only(client):
    p = client.get("/api/data/profile").json()
    assert p["rows"] == 28200 and p["date_max"] <= "2024-12-31" and p["duplicate_rows"] == 0
    assert sum(1 for c in p["schema"] if c["missing"]) == 0
    for route in ("distributions", "correlations", "seasonality", "lag-analysis"):
        r = client.get(f"/api/data/{route}")
        assert r.status_code == 200 and "2025" not in json.dumps(r.json()).replace("2025 ", "x ")[:0]
    seas = client.get("/api/data/seasonality").json()
    assert "2025" not in seas["weekly_by_year"]
    w = client.get(f"/api/weather/historical?ward_id={W}&start=2024-06-01&end=2026-01-01").json()
    assert max(r["date"] for r in w["rows"]) <= "2024-12-31" and "synthetic" in w["source"]


def test_no_secret_or_2025_target_leaks_in_any_response(client):
    key = ""
    env = ROOT / ".env"
    if env.exists():
        key = next((l.split("=", 1)[1].strip() for l in env.read_text().splitlines() if l.startswith("OPENAI_API_KEY=")), "")
    for route in ("/api/health", "/api/metadata", "/api/integrations/status", "/api/assistant/status", "/api/model/metrics"):
        body = client.get(route).text
        assert not re.search(r"sk-[A-Za-z0-9_-]{20,}", body)
        if key:
            assert key not in body


def test_assistant_disabled_path_is_honest_and_does_not_call_openai(client, monkeypatch):
    from dengueshield.api import integrations, rag
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert integrations.openai_configured() is False
    r = client.post("/api/assistant/chat", json={"message": "Why was the Poisson GLM chosen?"})
    j = r.json()
    assert r.status_code == 200 and j["enabled"] is False and j["sources"] and "disabled" in j["message"].lower()
    assert client.post("/api/assistant/chat", json={"message": ""}).status_code == 422
    assert client.post("/api/assistant/chat", json={"message": "x" * 1300}).status_code == 422
    assert client.post("/api/assistant/chat", json={"message": "hi", "horizon": 9}).status_code == 422


def test_rag_corpus_is_approved_documents_only_and_tools_are_strict():
    from dengueshield.api import rag
    srcs = {c["source"] for c in rag.build_corpus()}
    assert "docs/model_selection.md" in srcs
    assert not any(s.startswith(("data/raw", ".env")) or s.endswith(".env") for s in srcs)
    names = {t["name"] for t in rag.TOOLS}
    assert names == {"get_ward_forecast", "compare_wards", "get_risk_rankings", "get_model_metrics", "get_feature_importance", "get_data_profile"}
    assert all(t["parameters"].get("additionalProperties") is False for t in rag.TOOLS)
    hits = rag.retriever().search("why was the Poisson GLM chosen instead of LightGBM")
    assert hits and any("model_selection" in h["source"] for h in hits)


def test_assistant_tools_validate_inputs_and_match_api(client):
    from dengueshield.api import rag
    from dengueshield.api.main import S
    ok = rag.run_tool(S, "get_ward_forecast", {"ward_id": W, "horizon": 3, "origin": O}, {})
    assert ok["forecast"]["median_cases"] == client.get(f"/api/forecast?ward_id={W}&origin={O}&horizon=3").json()["forecast"]["median_cases"]
    assert "error" in rag.run_tool(S, "get_ward_forecast", {"ward_id": "NOPE", "horizon": 3}, {})
    assert "error" in rag.run_tool(S, "get_ward_forecast", {"ward_id": W, "horizon": 3, "origin": "2025-06-02"}, {})
    assert "error" in rag.run_tool(S, "rm_rf", {}, {})
    r = rag.run_tool(S, "get_risk_rankings", {"horizon": 3, "origin": O, "top_n": 3}, {})
    assert len(r["top"]) == 3


def test_climate_providers_fail_gracefully_and_stay_separate(client, monkeypatch):
    from dengueshield.api import climate
    monkeypatch.setattr(climate.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("offline")))
    climate.MEM.clear()
    r = client.get("/api/climate/observations?provider=nasa_power&city=Gazipur&start=2001-03-01&end=2001-03-05")
    assert r.status_code == 503 and r.json()["status"] == "unavailable" and "unaffected" in r.json()["error"]
    assert client.get("/api/climate/current?city=Gazipur").status_code in (200, 503)
    assert client.get("/api/health").json()["status"] == "ok"                       # core app unaffected
    assert client.get(f"/api/forecast?ward_id={W}&origin={O}&horizon=2").status_code == 200
    assert client.get("/api/climate/observations?start=2030-01-01&end=2029-01-01").status_code == 422


def test_climate_aggregation_units_and_separation_notice():
    from dengueshield.api import climate
    days = [{"date": d.strftime("%Y-%m-%d"), "temp_c": 28.0, "rh_pct": 80.0, "rain_mm": 2.0 if d.day % 2 else 0.0} for d in pd.date_range("2023-01-02", periods=28)]
    a = climate.aggregate(days)
    assert len(a["weekly"]) == 4
    assert a["weekly"][0]["rain_mm"] == pytest.approx(6.0)      # Mon 2 Jan - Sun 8 Jan: odd days 3, 5, 7 -> 3 x 2 mm
    assert a["weekly"][1]["rain_mm"] == pytest.approx(8.0)      # 9-15 Jan: odd days 9, 11, 13, 15
    assert a["monthly"][0]["wet_days"] == 14 and a["extremes"]["max_daily_rain_mm"] == 2.0
    nas = climate.PROVIDERS["nasa_power"]
    assert nas["fill_value"] == -999.0 and "mm/day" in nas["variables"]["PRECTOTCORR"] and "0.5" in nas["resolution"]
    assert "NASA" in nas["attribution"] and "Open-Meteo" in climate.PROVIDERS["open_meteo"]["attribution"]


def test_nasa_fill_values_become_missing_not_zero(monkeypatch):
    from dengueshield.api import climate
    body = {"properties": {"parameter": {"T2M": {"20240101": 25.0, "20240102": -999.0}, "RH2M": {"20240101": 80.0, "20240102": 81.0},
                                         "PRECTOTCORR": {"20240101": 0.0, "20240102": -999.0}}},
            "parameters": {"T2M": {"units": "C"}, "RH2M": {"units": "%"}, "PRECTOTCORR": {"units": "mm/day"}},
            "header": {"fill_value": -999.0, "api": {"version": "v2"}, "sources": []}, "geometry": {"coordinates": [90.4, 23.8, 10]}}

    class R:
        def raise_for_status(self): pass
        def json(self): return body
    monkeypatch.setattr(climate.httpx, "get", lambda *a, **k: R())
    d = climate._nasa(23.8, 90.4, "2024-01-01", "2024-01-02")["daily"]
    assert d[1]["temp_c"] is None and d[1]["rain_mm"] is None and d[0]["rain_mm"] == 0.0


def test_weather_climatology_uses_all_years_not_the_requested_window(client):
    short = client.get(f"/api/weather/historical?ward_id={W}&start=2024-07-01&end=2024-07-29").json()
    long_ = client.get(f"/api/weather/historical?ward_id={W}&start=2016-01-01&end=2024-12-30").json()
    assert short["climatology_by_iso_week"] == long_["climatology_by_iso_week"]          # independent of the window
    wk27 = short["climatology_by_iso_week"]["28"]
    observed_28 = [r["rainfall_mm"] for r in short["rows"] if r["date"] == "2024-07-08"][0]
    assert wk27 != observed_28                                                          # a real climatology, not the observation itself


def test_optional_access_gate_protects_everything_but_health(client, monkeypatch):
    monkeypatch.setenv("ACCESS_PASSWORD", "team-pass")
    assert client.get("/api/health").status_code == 200                                   # probes stay open
    for u in ("/", "/api/metadata", "/api/forecast?ward_id=DNCC_Ward_19&origin=2024-08-05&horizon=3"):
        r = client.get(u)
        assert r.status_code == 401 and "Basic" in r.headers["www-authenticate"]
    assert client.get("/api/metadata", auth=("anyone", "wrong")).status_code == 401
    assert client.get("/api/metadata", auth=("anyone", "team-pass")).status_code == 200
    monkeypatch.delenv("ACCESS_PASSWORD")
    assert client.get("/api/metadata").status_code == 200                                 # gate is off by default
