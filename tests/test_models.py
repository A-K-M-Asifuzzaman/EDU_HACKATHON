"""Stage 3 model-tournament invariants: count validity, determinism, training isolation, nested seasons and ensembles."""
import numpy as np
import pandas as pd
import pytest

from dengueshield.models import seasons as S
from dengueshield.models.distributions import CountDist, _hurdle_lambda, moment_alpha
from dengueshield.models.ensemble import nested_blend
from dengueshield.models.zoo import REGISTRY, make
from synth import synthetic_panel

COLS = ["rain_tl2", "rain_tl3", "rain_tl4", "rain_win", "rain_clim_tl3", "regime_wet_now", "waterlogging", "sanitation",
        "pop_density", "cal_tgt_sin1", "cal_tgt_cos1", "cal_tgt_sin2", "cal_tgt_cos2", "cal_org_sin1", "cal_org_cos1", "cal_org_monsoon"]


@pytest.fixture(scope="module")
def panel():
    return synthetic_panel(wards=(("A_1", "X"), ("A_2", "X"), ("B_1", "Y"), ("B_2", "Y")))


@pytest.fixture(scope="module")
def season(panel):
    return S.season_data(panel, "B", 2022, 3, COLS)


# ---------------------------------------------------------------- distributions and count validity
def test_distributions_are_valid_counts():
    mu = np.array([0.0, 0.3, 2.0, 9.0, 30.0])
    for d in (CountDist("poisson", mu=mu), CountDist("nb", mu=mu, alpha=0.4),
              CountDist("hurdle", p=np.array([0.1, 0.3, 0.8, 0.95, 0.99]), lam=_hurdle_lambda(np.array([1.1, 1.5, 3, 10, 30.0])))):
        med = d.median()
        lo80, hi80 = d.interval(0.8)
        lo90, hi90 = d.interval(0.9)
        for a in (med, lo80, hi80, lo90, hi90):
            assert (a >= 0).all() and np.allclose(a, np.round(a))
        assert (lo90 <= lo80).all() and (lo80 <= med).all() and (med <= hi80).all() and (hi80 <= hi90).all()
        assert (d.mean() >= 0).all()
        p = d.prob_ge(5)
        assert ((p >= 0) & (p <= 1)).all()


def test_hurdle_is_a_proper_distribution():
    lam = _hurdle_lambda(np.array([1.3, 4.0, 12.0]))
    d = CountDist("hurdle", p=np.array([0.2, 0.5, 0.9]), lam=lam)
    F = d._cdf_grid(np.arange(400))
    pmf = np.diff(np.c_[np.zeros(3), F], axis=1)
    assert np.allclose(pmf.sum(1), 1) and np.allclose((pmf * np.arange(400)).sum(1), d.mean())
    assert np.allclose(lam / (1 - np.exp(-lam)), [1.3, 4.0, 12.0])


def test_moment_alpha_recovers_overdispersion():
    rng = np.random.default_rng(0)
    mu = rng.uniform(1, 20, 20000)
    y = rng.negative_binomial(1 / 0.3, 1 / (1 + 0.3 * mu))
    assert moment_alpha(y, mu) == pytest.approx(0.3, rel=0.15)
    assert moment_alpha(rng.poisson(mu), mu) < 0.02


@pytest.mark.parametrize("name", [n for n in REGISTRY if n != "severity_clf"])
def test_every_model_gives_non_negative_valid_predictions(season, name):
    m = make(name).fit(season.Xtr[COLS], season.ytr, years=season.years)
    prm = m.predict_params(season.Xev[COLS])
    d = m.dist(prm)
    med = d.median()
    assert np.isfinite(med).all() and (med >= 0).all() and np.allclose(med, np.round(med))
    if d.kind != "point":
        assert (d.mean() >= 0).all()


def test_severity_classifier_outputs_probabilities(season):
    m = make("severity_clf").fit(season.Xtr[COLS], season.ytr)
    p = m.predict_params(season.Xev[COLS])["p"]
    assert ((p >= 0) & (p <= 1)).all() and m.thr == pytest.approx(np.quantile(season.ytr, 0.9))


@pytest.mark.parametrize("name", ["glm_poisson", "lgbm_poisson", "xgb_poisson", "cat_poisson", "hurdle_lgbm"])
def test_fits_are_deterministic(season, name):
    a = make(name).fit(season.Xtr[COLS], season.ytr, years=season.years).predict_params(season.Xev[COLS])
    b = make(name).fit(season.Xtr[COLS], season.ytr, years=season.years).predict_params(season.Xev[COLS])
    for k in a:
        assert np.allclose(a[k], b[k])


def test_model_never_sees_evaluation_rows(season):
    """Fitting uses training rows only: corrupting evaluation features changes only the corrupted predictions."""
    m = make("glm_poisson").fit(season.Xtr[COLS], season.ytr, years=season.years)
    Xe = season.Xev[COLS].copy()
    base = m.predict_params(Xe)["mu"]
    Xe.iloc[0, :] = 1e6
    new = m.predict_params(Xe)["mu"]
    assert np.allclose(base[1:], new[1:])


# ---------------------------------------------------------------- nested selection, calibration, ensembles
def test_season_folds_are_development_only_and_nested():
    assert max(S.SEASONS) == 2024 and max(S.TUNE) < min(S.BENCH)
    with pytest.raises(PermissionError):
        S.season_fold(2025)
    for y in S.OUTER:
        assert all(s < y for s in S.inner_seasons(y)) and S.inner_seasons(y)


def _fake_preds(seed, model="m", years=S.SEASONS, n=400):
    rng = np.random.default_rng(seed)
    rows = []
    for y in years:
        for h in (2, 3):
            mu = rng.uniform(0.1, 15, n)
            rows.append(pd.DataFrame({"ward_id": [f"w{i % 40}" for i in range(n)], "origin_date": pd.Timestamp(f"{y}-01-01") + pd.to_timedelta(np.arange(n) // 40 * 7, "D"),
                                      "horizon": h, "year": y, "y_true": rng.poisson(mu * rng.uniform(0.7, 1.4)), "mu": mu * rng.uniform(0.8, 1.2, n),
                                      "dist_kind": "poisson", "alpha": np.nan, "thr_q90": 9.0, "tier_e1": 1.0, "tier_e2": 5.0, "tier_e3": 13.0,
                                      "model": model}))
    return pd.concat(rows, ignore_index=True)


def test_ensemble_weights_ignore_outer_labels():
    a, b = _fake_preds(1, "a"), _fake_preds(2, "b")
    b["y_true"] = a["y_true"]
    _, w1 = nested_blend(a, b, "ab")
    a2, b2 = a.copy(), b.copy()
    for d in (a2, b2):
        d.loc[d.year == 2024, "y_true"] = 999            # corrupt the outer season's labels
    _, w2 = nested_blend(a2, b2, "ab")
    assert w1[w1.year == 2024].weight_A.tolist() == w2[w2.year == 2024].weight_A.tolist()
    assert w1[w1.year == 2023].weight_A.tolist() == w2[w2.year == 2023].weight_A.tolist()   # 2024 is not inner for 2023
