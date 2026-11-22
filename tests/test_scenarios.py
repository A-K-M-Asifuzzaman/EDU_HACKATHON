"""Exploratory multi-year scenario engine: holdout isolation, leakage, determinism, bounds and mode separation."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from dengueshield import scenarios as SC
from dengueshield.api.main import _sc_engine, app
from dengueshield.data import load_development_panel


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def dev():
    return SC.prepare(load_development_panel())


def test_engine_sees_development_years_only_and_rejects_2025(dev):
    assert dev.year.max() == 2024 and _sc_engine().years == list(range(2016, 2025))
    leaked = load_development_panel().head(3).assign(date=pd.Timestamp("2025-01-06"))
    with pytest.raises(ValueError):
        SC.prepare(pd.concat([load_development_panel(), leaked]))


def test_backtest_year_is_untouched_by_its_own_observations(dev):
    """Inflating the target year's cases and weather must not change the simulation for that year."""
    target = 2022
    poisoned = dev.copy()
    m = poisoned.year >= target
    poisoned.loc[m, "dengue_cases"] *= 10; poisoned.loc[m, "rain_lag"] *= 3
    a = SC.Engine(dev, range(2016, target)).simulate("m1", 60)
    b = SC.Engine(poisoned, range(2016, target)).simulate("m1", 60)
    assert np.array_equal(a, b)


def test_seeded_runs_are_deterministic_and_distributions_valid(client):
    p = {"scenario": "wetter", "year": 2027, "draws": 200}
    a, b = client.get("/api/scenarios/run", params=p).json(), client.get("/api/scenarios/run", params=p).json()
    assert a["summary"] == b["summary"]
    T = a["summary"]["total"]
    assert 0 <= T["q90"][0] <= T["q80"][0] <= T["q50"][0] <= T["median"] <= T["q50"][1] <= T["q80"][1] <= T["q90"][1]
    assert sum(a["summary"]["peak_week"]) == 200 and len(a["summary"]["weekly_median"]) == SC.NW
    assert set(a["by_year"]) == {"2026", "2027", "2028", "2029", "2030"} and "2025" not in a["history"]


def test_city_totals_add_up_to_the_overall_total():
    e = _sc_engine(); sims = e.simulate("m1", 80, seed=5)
    s = SC.summarize(sims, e.wards, e.city)
    assert abs(sum(c["mean"] for c in s["cities"].values()) - s["total"]["mean"]) < 1e-6


@pytest.mark.parametrize("params,code", [({"rain_mult": 1.5, "scenario": "custom"}, 422), ({"temp_offset": 5, "scenario": "custom"}, 422),
                                         ({"year": 2025}, 422), ({"year": 2031}, 422), ({"draws": 10}, 422), ({"draws": 5000}, 422),
                                         ({"scenario": "apocalypse"}, 422), ({"city": "Paris"}, 404), ({"ward": "DNCC_Ward_99"}, 404)])
def test_scenario_inputs_are_bounded(client, params, code):
    assert client.get("/api/scenarios/run", params=params).status_code == code


def test_paired_comparison_and_ward_selection(client):
    c = client.get("/api/scenarios/compare", params={"a": "typical", "b": "wetter", "draws": 200}).json()
    lo, hi = c["difference"]["q80"]
    assert lo <= c["difference"]["mean"] <= hi and "not a demonstrated causal effect" in c["warning"]
    w = client.get("/api/scenarios/run", params={"ward": "DNCC_Ward_19", "draws": 100}).json()
    assert w["summary"]["total"]["median"] < 1000 and list(w["summary"]["cities"]) == ["Dhaka North"]


def test_long_range_mode_is_separate_from_the_validated_forecast(client):
    r = client.get("/api/scenarios/run", params={"draws": 100}).json()
    assert "Exploratory" in r["note"] and "not forecasts" in r["note"] and r["interval_label"].startswith("simulation ranges")
    assert client.get("/api/forecast", params={"ward_id": "DNCC_Ward_19", "origin": "2028-08-07", "horizon": 3}).status_code >= 400


def test_backtest_covers_every_season_and_reports_the_climatology_baseline(client):
    b = client.get("/api/scenarios/backtest").json()
    years = {r["year"] for r in b["rows"]}
    assert years == set(range(2019, 2025))
    models = {r["model"] for r in b["mean"]}
    assert {"M0 climatology", "M1 weather-resampled", "M1 oracle weather (diagnostic)"} == models
    assert all(r["train_years"] == f"2016-{r['year'] - 1}" for r in b["rows"])
