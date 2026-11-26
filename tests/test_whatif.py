"""Rainfall what-if (V3): real model-input changes, correct lag treatment, determinism, bounds, no shared-state mutation."""
import pytest
from fastapi.testclient import TestClient

from dengueshield import whatif
from dengueshield.api.main import S, app

client = TestClient(app)
W, O = "DNCC_Ward_19", "2024-07-15"


def run(**kw):
    return client.get("/api/forecast/rainfall-what-if", params={"ward_id": W, "origin": O, **kw})


@pytest.mark.parametrize("mode", ["observed", "upcoming"])
@pytest.mark.parametrize("h", [2, 3, 4])
def test_zero_change_reproduces_the_baseline_through_the_real_path(mode, h):
    j = whatif.rainfall_what_if(S.bundle, S.panel, O, h, W, "Dhaka North", 0, mode)
    assert j["scenario"] == j["baseline"] and j["changed_inputs"] == [] and j["no_effect"]


def test_observed_mode_only_touches_inputs_the_model_reads():
    h2 = run(horizon=2, change_pct=30, mode="observed").json()
    assert {x["feature"] for x in h2["changed_inputs"]} == {"rain_tl3", "rain_tl4", "rain_win", "rain_anom_now"}
    h4 = run(horizon=4, change_pct=30, mode="observed").json()
    assert {x["feature"] for x in h4["changed_inputs"]} == {"rain_anom_now"}            # at 4 weeks observed rain barely enters
    assert abs(h4["scenario"]["expected_cases"] - h4["baseline"]["expected_cases"]) < 0.05 * h4["baseline"]["expected_cases"]
    assert h2["weeks_changed"] == ["2024-07-01", "2024-07-08"]                         # the two latest observed weeks only


def test_upcoming_mode_changes_projected_rain_and_responds_at_four_weeks():
    j = run(horizon=4, change_pct=30, mode="upcoming").json()
    feats = {x["feature"] for x in j["changed_inputs"]}
    assert feats and all(f.startswith("rain_") for f in feats) and "rain_anom_now" not in feats   # observed history untouched
    assert j["scenario"]["expected_cases"] > j["baseline"]["expected_cases"]
    dry = run(horizon=4, change_pct=-30, mode="upcoming").json()
    assert dry["scenario"]["expected_cases"] < dry["baseline"]["expected_cases"]


def test_deterministic_bounded_and_honestly_labelled():
    a, b = run(horizon=3, change_pct=20).json(), run(horizon=3, change_pct=20).json()
    assert a == b
    assert "not a causal effect" in a["note"].lower()
    assert run(horizon=3, change_pct=31).status_code == 422 and run(horizon=3, change_pct=10, mode="future").status_code == 422
    assert isinstance(a["any_clipped"], bool)


def test_shared_bundle_is_not_mutated():
    before = S.bundle.pipeline
    whatif.rainfall_what_if(S.bundle, S.panel, O, 4, W, "Dhaka North", 30, "upcoming")
    assert S.bundle.pipeline is before and getattr(before, "proj_scale", 1.0) == 1.0
