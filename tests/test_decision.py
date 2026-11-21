"""Decision-support integrity: alert-policy explorer and resource sandbox reproduce saved results and never look ahead."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from dengueshield import decision as D
from dengueshield.data import RAW_PATH, ROOT

pytestmark = pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")


@pytest.fixture(scope="module")
def R():
    return pd.read_csv(ROOT / "app_data" / "replay.csv.gz")


@pytest.fixture(scope="module")
def panel():
    from dengueshield.data import load_development_panel
    return load_development_panel()


@pytest.fixture(scope="module")
def client():
    from dengueshield.api.main import app
    return TestClient(app)


def test_replay_never_contains_the_locked_2025_targets(R):
    assert pd.to_datetime(R.target_date).dt.year.max() <= 2024 and R.year.max() <= 2024


@pytest.mark.parametrize("h", [2, 3, 4])
def test_deployed_rule_reproduces_published_diagnostics(R, client, h):
    c = D.alert_curve(R, h)
    pub = client.get("/api/model/diagnostics", params={"horizon": h}).json()["alert"]
    for k in ("recall", "precision", "false_alert_rate"):
        assert c["deployed"][k] == pytest.approx(pub[k], abs=6e-4)                      # same rows, same rule, same numbers


def test_curve_is_monotone_in_the_threshold(R):
    cur = D.alert_curve(R, 3)["curve"]
    flagged = [r["flagged"] for r in cur]; recall = [r["recall"] for r in cur]
    assert flagged == sorted(flagged, reverse=True) and recall == sorted(recall, reverse=True)
    for r in cur:
        assert r["tp"] + r["fn"] == cur[0]["tp"] + cur[0]["fn"]                          # event count is threshold-independent


def test_nested_threshold_uses_only_earlier_seasons(R):
    c = D.alert_curve(R, 3)
    assert [s["year"] for s in c["nested"]["seasons"]] == [2021, 2022, 2023, 2024]     # 2019-2020 lack two prior replay seasons
    assert c["best_in_sample"]["f1"] >= c["nested"]["f1"]                                # in-sample choice is optimistic, and labelled so
    assert "optimistic" in c["best_in_sample"]["warning"]


def test_historical_risk_ignores_data_after_the_origin(panel):
    origin = "2022-06-06"
    base = D.historical_risk(panel, origin)
    tampered = panel.copy(); tampered.loc[tampered.date >= pd.Timestamp(origin), "dengue_cases"] = 10_000
    pd.testing.assert_series_equal(base, D.historical_risk(tampered, origin))


def test_allocation_is_deterministic_bounded_and_consistent(R, panel):
    a = D.allocate(R, panel, "2023-08-07", 3, 12)
    b = D.allocate(R, panel, "2023-08-07", 3, 12)
    assert a == b and a["wards"] == 60
    for s in a["strategies"].values():
        assert len(s["wards"]) == 12 and len({w["ward_id"] for w in s["wards"]}) == 12
        assert s["outbreak_wards_covered"] <= a["actual_outbreak_wards"]
    probs = [w["p_outbreak"] for w in a["strategies"]["forecast"]["wards"]]
    assert probs == sorted(probs, reverse=True)
    with pytest.raises(ValueError):
        D.allocate(R, panel, "2025-01-06", 3, 5)                                          # forward origin: no retrospective outcome exists


def test_decision_api_validates_and_serves(client):
    r = client.get("/api/decision/alert-curve", params={"horizon": 3, "years": "2023,2024"}).json()
    assert r["years"] == [2023, 2024] and len(r["curve"]) == 49 and "retrospective" in r["status"]
    assert client.get("/api/decision/alert-curve", params={"years": "2025"}).status_code == 422
    assert client.get("/api/decision/allocate", params={"origin": "2024-08-05", "teams": 0}).status_code == 422
    assert client.get("/api/decision/allocate", params={"origin": "2030-01-07"}).status_code == 422
    s = client.get("/api/decision/allocation-season", params={"year": 2024, "horizon": 3, "teams": 10}).json()
    assert s["origins"] > 40 and set(s["strategies"]) == {"equal", "historical", "forecast"}
