"""E1 candidate interval algorithm (research/v3/e1_e4_calibration.py): research only, never used by the deployed API."""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from scipy.stats import poisson

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("e1e4", ROOT / "research" / "v3" / "e1_e4_calibration.py")
E = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(E)


def test_tiny_dispersion_reduces_to_poisson_quantiles():
    mu = np.array([0.2, 1.0, 3.0, 8.0, 25.0])
    lo, hi = E.nb_interval(mu, 1e-3, 0.8)
    assert np.allclose(lo, poisson.ppf(0.1, mu), atol=1) and np.allclose(hi, poisson.ppf(0.9, mu), atol=1)


def test_more_dispersion_never_narrows_the_interval_and_it_brackets_the_median():
    mu = np.linspace(0.1, 40, 50)
    lo1, hi1 = E.nb_interval(mu, 0.01, 0.8)
    lo2, hi2 = E.nb_interval(mu, 0.5, 0.8)
    assert (hi2 - lo2 >= hi1 - lo1).all()
    med_lo, med_hi = E.nb_interval(mu, 0.5, 0.0)            # level 0 gives the median twice
    assert (lo2 <= med_lo).all() and (med_hi <= hi2).all()


def test_mu_bins_have_half_open_edges():
    d = pd.DataFrame({"mean": [0.0, 0.49, 0.5, 1.99, 2.0, 5.0, 9.99, 10.0, 1e6]})
    alphas = [0.001, 0.01, 0.1, 1.0, 10.0]                   # one distinct alpha per bin, so the chosen bin is visible in the width
    lo, hi = E.mondrian_interval(d, alphas, 0.8)
    expect = [E.nb_interval(m, alphas[b], 0.8) for m, b in zip(d["mean"], [0, 0, 1, 1, 2, 3, 3, 4, 4])]
    assert np.allclose(lo, [e[0] for e in expect]) and np.allclose(hi, [e[1] for e in expect])


def test_alpha_is_the_smallest_grid_value_that_reaches_nominal_coverage():
    rng = np.random.default_rng(0)
    mu = rng.uniform(5, 10, 4000)                            # all rows in the [5, 10) bin
    a_true = 0.4
    y = rng.negative_binomial(1 / a_true, (1 / a_true) / (1 / a_true + mu))
    cal = pd.DataFrame({"mean": mu, "y_true": y})
    al = E.fit_bin_alphas(cal, 0.8)
    assert al[:3] == [E.GRID[0]] * 3 and al[4] == E.GRID[0]  # empty bins fall back to the smallest alpha (Poisson-like)
    chosen = al[3]
    lo, hi = E.nb_interval(mu, chosen, 0.8)
    assert E.coverage(y, lo, hi) >= 0.8
    prev = E.GRID[np.searchsorted(E.GRID, chosen) - 1]
    lo, hi = E.nb_interval(mu, prev, 0.8)
    assert E.coverage(y, lo, hi) < 0.8                       # the next smaller grid value does not reach it
    assert 0.1 < chosen < 1.0                                # and the fit lands near the true dispersion


def test_winkler_score_by_hand():
    y, lo, hi = np.array([5, 0, 12]), np.array([2, 1, 3]), np.array([8, 4, 10])
    # widths 6, 3, 7; penalties (2/0.2)*(1-0)=10 for the second, (2/0.2)*(12-10)=20 for the third
    assert E.winkler(y, lo, hi, 0.8) == pytest.approx((6 + 3 + 10 + 7 + 20) / 3)


def _toy_replay(seed=1):
    rng = np.random.default_rng(seed)
    rows = []
    for year in range(2019, 2025):
        for h in (2, 3, 4):
            mu = rng.gamma(1.0, 3.0, 300)
            y = rng.negative_binomial(2.0, 2.0 / (2.0 + mu))
            lo, hi = E.nb_interval(mu, 1e-3, 0.8); lo9, hi9 = E.nb_interval(mu, 1e-3, 0.9)
            rows.append(pd.DataFrame({"year": year, "horizon": h, "mean": mu, "y_true": y, "lo80": lo, "hi80": hi, "lo90": lo9, "hi90": hi9, "thr_q90": 8.0}))
    return pd.concat(rows, ignore_index=True)


def test_each_season_is_calibrated_only_on_the_two_preceding_seasons():
    r = _toy_replay()
    base = E.e1(r)
    future = r.copy()
    future.loc[future.year >= 2023, "y_true"] *= 7          # change the evaluated season 2023 and everything after it
    after = E.e1(future)
    for h in ("2", "3", "4"):
        for Y in (2021, 2022, 2023):
            a = next(s for s in base["by_horizon"][h]["seasons"] if s["season"] == Y)["80"]["alphas_by_bin"]
            b = next(s for s in after["by_horizon"][h]["seasons"] if s["season"] == Y)["80"]["alphas_by_bin"]
            assert a == b                                    # calibration for 2021–2023 never sees 2023+ outcomes
        a24 = next(s for s in base["by_horizon"][h]["seasons"] if s["season"] == 2024)["80"]["alphas_by_bin"]
        b24 = next(s for s in after["by_horizon"][h]["seasons"] if s["season"] == 2024)["80"]["alphas_by_bin"]
        assert a24 != b24                                    # ...while 2024 does use 2022–2023 (sanity check of the test itself)


def test_point_forecast_and_evaluated_rows_are_unchanged():
    r = _toy_replay()
    res = E.e1(r)
    for h in ("2", "3", "4"):
        for s in res["by_horizon"][h]["seasons"]:
            n = int(((r.year == s["season"]) & (r.horizon == int(h))).sum())
            assert n == 300                                  # baseline and candidate are scored on the same, complete season
    assert "median" not in json.dumps(res)                   # E1 changes interval endpoints only, never the median


def test_saved_e1_results_reproduce_exactly_from_the_replay():
    r = pd.read_csv(ROOT / "app_data" / "replay.csv.gz")
    assert int(r.year.max()) <= 2024                         # the sealed 2025 holdout is not part of the replay
    saved = json.loads((ROOT / "research" / "v3" / "results" / "e1_intervals.json").read_text())
    assert json.loads(json.dumps(E.e1(r))) == saved


def test_research_endpoint_serves_the_verification_and_keeps_e1_undeployed():
    from fastapi.testclient import TestClient
    from dengueshield.api.main import app
    with TestClient(app) as c:
        d = c.get("/api/research/v3").json()
        fc = c.get("/api/forecast?ward_id=DNCC_Ward_19&origin=2024-08-05&horizon=4").json()["forecast"]
    v = d["e1_verification"]
    assert v["recommendation"].startswith("INSUFFICIENT EVIDENCE") and v["reproduces_saved_results_exactly"] is True
    b = v["coverage_by_mu_bin"]["4"]
    assert len(b["bins"]) == len(b["n"]) == len(b["baseline"]) == len(b["candidate"]) == 5 and sum(b["n"]) == 11580   # 4 seasons × h4 rows
    assert d["status"].startswith("research candidates; not deployed")
    lo, hi = E.nb_interval(fc["expected_cases"], 1e-3, 0.8)                  # the served interval is still the deployed (Poisson-like NB) one
    assert (fc["lower_80"], fc["upper_80"]) == (int(lo), int(hi))
