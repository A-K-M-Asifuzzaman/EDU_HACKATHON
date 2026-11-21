"""Feature availability, alignment and leakage invariants for the Stage 2 pipeline."""
import joblib
import numpy as np
import pandas as pd
import pytest

from dengueshield.data import RAW_PATH, load_development_panel
from dengueshield.features import PROHIBITED, FeaturePipeline, FittedStats
from dengueshield.features import families, ops
from dengueshield.features.grid import Grid
from synth import corrupt_future, synthetic_panel

CUT = "2021-12-31"
CONVENTIONS = [(0, 0), (1, 1), (0, 1)]
ORIGINS = ["2022-01-03", "2022-01-10", "2022-06-27", "2022-09-26", "2023-01-02", "2023-12-25"]  # includes year boundaries


@pytest.fixture(scope="module")
def panel():
    return synthetic_panel()


def pipe_for(panel, w=0, c=0, **kw):
    return FeaturePipeline(w, c, **kw).fit(panel, CUT)


def row(fm, ward="A_1", origin=None):
    sel = (fm.meta.ward_id == ward) & ((fm.meta.origin_date == pd.Timestamp(origin)) if origin else True)
    return fm.X[sel.to_numpy()]


def assert_origin_invariant(panel, w, c, h, origin, pipe=None, tol=0.0):
    """Features at `origin` must not change when everything unobservable at the origin is replaced by extremes."""
    pipe = pipe or pipe_for(panel, w, c)
    base = pipe.transform(panel, h, origins=[origin]).X
    bad = pipe.transform(corrupt_future(panel, origin, w, c), h, origins=[origin]).X
    diff = [k for k in base.columns if not np.allclose(base[k].to_numpy(float), bad[k].to_numpy(float), equal_nan=True, atol=tol)]
    return diff


# 5/6/7. no future weather, no future labels, no future-derived climatology
@pytest.mark.parametrize("w,c", CONVENTIONS)
@pytest.mark.parametrize("h", [2, 3, 4])
@pytest.mark.parametrize("origin", ORIGINS)
def test_features_ignore_everything_unobservable_at_origin(panel, w, c, h, origin):
    assert assert_origin_invariant(panel, w, c, h, origin) == []


def test_invariance_check_detects_planted_leaks(panel, monkeypatch):
    """The checker above must fail when a leak is planted: with a 1-week availability delay, a lag that ignores it."""
    real = ops.lag
    monkeypatch.setattr(families.ops, "lag", lambda a, k: real(a, max(k - 1, 0)))   # every lag reads one week too recent
    assert assert_origin_invariant(panel, 1, 1, 3, "2022-06-27") != []


def test_invariance_check_detects_future_roll(panel, monkeypatch):
    real = ops.roll
    def leaky(a, n, how):                       # trailing window shifted to be centred: reads the future
        return real(np.concatenate([a[:, n // 2:], np.full((a.shape[0], n // 2), np.nan)], axis=1), n, how)
    monkeypatch.setattr(families.ops, "roll", leaky)
    assert assert_origin_invariant(panel, 0, 0, 2, "2022-06-27") != []


def test_invariance_check_detects_future_climatology(panel, monkeypatch):
    real = ops.past_stats
    def leaky(a, s, thr=None, hw=2, years=10):  # climatology that includes the current year
        out = real(a, s, thr, hw, years)
        out["mean"] = np.nanmean(np.stack([out["mean"], np.roll(a, -1, axis=1)]), axis=0)   # mixes in next week's value
        return out
    monkeypatch.setattr(families.ops, "past_stats", leaky)
    assert assert_origin_invariant(panel, 0, 0, 4, "2022-06-27") != []


# 1. ward isolation
def test_ward_isolation_across_cities(panel):
    p = pipe_for(panel)
    base = p.transform(panel, 3)
    alt = panel.copy()
    m = alt.ward_id == "B_1"
    alt.loc[m, ["rainfall_mm", "avg_temp_c", "dengue_cases"]] *= 7
    new = p.transform(alt, 3)
    for ward in ("A_1", "A_2"):
        a, b = base.X[(base.meta.ward_id == ward).to_numpy()], new.X[(new.meta.ward_id == ward).to_numpy()]
        assert np.allclose(a.to_numpy(float), b.to_numpy(float), equal_nan=True), ward
    assert not np.allclose(row(base, "B_1").to_numpy(float), row(new, "B_1").to_numpy(float), equal_nan=True)


def test_own_series_features_ignore_other_wards_in_same_city(panel):
    p = pipe_for(panel)
    base = p.transform(panel, 3)
    alt = panel.copy()
    alt.loc[alt.ward_id == "A_1", ["rainfall_mm", "dengue_cases"]] *= 9
    new = p.transform(alt, 3)
    own = [c for c in base.X.columns if c.startswith(("rain_lag", "rain_sum", "rain_max", "case_lag", "case_sum", "case_ewm"))]
    a, b = row(base, "A_2"), row(new, "A_2")
    assert np.allclose(a[own].to_numpy(float), b[own].to_numpy(float), equal_nan=True)


# 2. exact target / date alignment
@pytest.mark.parametrize("h", [2, 3, 4])
def test_target_alignment(panel, h):
    fm = pipe_for(panel).transform(panel, h)
    look = panel.set_index(["ward_id", "date"])["dengue_cases"]
    assert ((fm.meta.target_date - fm.meta.origin_date).dt.days == 7 * h).all()
    assert (fm.meta.y_true.to_numpy() == look.loc[list(zip(fm.meta.ward_id, fm.meta.target_date))].to_numpy()).all()
    assert fm.meta.origin_date.max() == panel.date.max() - pd.Timedelta(weeks=h)


# 3. origin availability boundaries (week label = week start; wlag/clag delay usability)
@pytest.mark.parametrize("w,c", CONVENTIONS)
def test_origin_availability_boundaries(panel, w, c):
    fm = pipe_for(panel, w, c).transform(panel, 3)
    look = panel.set_index(["ward_id", "date"])
    o = pd.Timestamp("2023-07-03")
    r = row(fm, "A_2", o).iloc[0]
    assert r["rain_lag0"] == pytest.approx(look.loc[("A_2", o - pd.Timedelta(weeks=w)), "rainfall_mm"])
    assert r["rain_lag4"] == pytest.approx(look.loc[("A_2", o - pd.Timedelta(weeks=w + 4)), "rainfall_mm"])
    assert r["case_lag0"] == look.loc[("A_2", o - pd.Timedelta(weeks=c)), "dengue_cases"]
    assert r["case_lag3"] == look.loc[("A_2", o - pd.Timedelta(weeks=c + 3)), "dengue_cases"]


# 4. horizon-specific rainfall alignment
@pytest.mark.parametrize("w", [0, 1])
@pytest.mark.parametrize("h", [2, 3, 4])
def test_horizon_aligned_rain(panel, w, h):
    fm = pipe_for(panel, w, w).transform(panel, h)
    look = panel.set_index(["ward_id", "date"])["rainfall_mm"]
    for ward in ("A_1", "B_1"):
        for k in (2, 3, 4, 5):
            for o in (pd.Timestamp("2023-06-12"), pd.Timestamp("2022-08-01")):
                r = row(fm, ward, o).iloc[0]
                observed = (k - h - w) >= 0
                assert r[f"rain_tl{k}_obs"] == float(observed)
                if observed:   # the value must be the recorded rain of week target - k
                    assert r[f"rain_tl{k}"] == pytest.approx(look.loc[(ward, o + pd.Timedelta(weeks=h - k))])


def test_projected_rain_is_flagged_and_not_the_future_value(panel):
    fm = pipe_for(panel, 0, 0).transform(panel, 4)       # target-lag 3 falls one week after the origin
    look = panel.set_index(["ward_id", "date"])["rainfall_mm"]
    r = fm.X[(fm.meta.ward_id == "A_1").to_numpy()]
    assert (r["rain_tl3_obs"] == 0).all() and (r["rain_tl4_obs"] == 1).all()
    o = fm.meta[(fm.meta.ward_id == "A_1")].origin_date
    truth = look.loc[[("A_1", d + pd.Timedelta(weeks=1)) for d in o]].to_numpy()
    assert not np.allclose(r["rain_tl3"].to_numpy(), truth, equal_nan=True)


@pytest.mark.parametrize("mode", ["regime", "clim", "zero"])
def test_every_rain_estimate_mode_is_origin_safe(panel, mode):
    pipe = pipe_for(panel, 0, 0, rain_est=mode)
    assert assert_origin_invariant(panel, 0, 0, 4, "2022-06-27", pipe=pipe) == []
    if mode == "zero":
        fm = pipe.transform(panel, 4)
        assert (fm.X.loc[fm.X.rain_tl3_obs == 0, "rain_tl3"] == 0).all()


# 8. rolling window and shift direction
def test_rolling_and_lag_direction(panel):
    fm = pipe_for(panel).transform(panel, 2)
    s = panel[panel.ward_id == "A_1"].set_index("date")["rainfall_mm"]
    o = pd.Timestamp("2022-07-18")
    r = row(fm, "A_1", o).iloc[0]
    assert r["rain_sum4"] == pytest.approx(s.loc[o - pd.Timedelta(weeks=3):o].sum())
    assert r["rain_max8"] == pytest.approx(s.loc[o - pd.Timedelta(weeks=7):o].max())
    assert r["rain_lag2"] == pytest.approx(s.loc[o - pd.Timedelta(weeks=2)])
    e = s.ewm(alpha=1 / 4, adjust=False).mean()   # mean age 3 weeks => alpha 1/4
    assert r["rain_ewm3"] == pytest.approx(e.loc[o], rel=1e-6)
    pd.testing.assert_series_equal(pd.Series(ops.lag(np.arange(6.0)[None, :], 2)[0]), pd.Series([np.nan, np.nan, 0, 1, 2, 3.0]))
    with pytest.raises(ValueError):
        ops.lag(np.zeros((1, 5)), -1)


def test_run_length_and_weeks_since():
    a = np.array([[0, 1, 1, 0, 1, 1, 1]], float)
    assert ops.run_length(a)[0].tolist() == [0, 1, 2, 0, 1, 2, 3]
    assert ops.weeks_since(a)[0].tolist() == [1, 0, 0, 1, 0, 0, 0]


# 9. fitted statistics respect the training boundary (no cross-fold leakage)
def test_fitted_stats_depend_only_on_training_window(panel):
    base = FeaturePipeline().fit(panel, CUT).stats
    alt = panel.copy()
    late = alt.date > pd.Timestamp(CUT)
    alt.loc[late, ["rainfall_mm", "relative_humidity_pct"]] = 5000
    alt.loc[late, "dengue_cases"] = 500
    assert FeaturePipeline().fit(alt, CUT).stats == base
    assert FeaturePipeline().fit(panel, "2020-12-31").stats != base
    assert base.fit_end == CUT


def test_different_folds_have_independent_stats(panel):
    a, b = (FeaturePipeline().fit(panel, c).stats for c in ("2020-12-31", "2021-12-31"))
    assert a.n_weeks < b.n_weeks


# 10. boundary contamination across years handled by the origin-invariance tests above (ORIGINS includes Jan 3/10, Dec 25)

# 12. insufficient history at the start
def test_earliest_origins_have_missing_long_history_not_errors(panel):
    fm = pipe_for(panel).transform(panel, 2)
    first = row(fm, "A_1", "2016-01-04").iloc[0]
    assert np.isnan(first["rain_lag1"]) and np.isnan(first["rain_sum4"]) and np.isnan(first["case_lag3"])
    assert np.isnan(first["hist_case_mean_tgt"]) and np.isnan(first["rain_clim_tl3"])   # no previous years yet
    assert first["rain_lag0"] == panel[(panel.ward_id == "A_1")].iloc[0]["rainfall_mm"]
    twelve = row(fm, "A_1", "2016-03-28").iloc[0]                                         # 12 weeks in: lag12 exists
    assert not np.isnan(twelve["rain_lag12"]) and np.isnan(row(fm, "A_1", "2016-03-21").iloc[0]["rain_lag12"])


# 13. missing ward-week
def test_missing_ward_week_becomes_nan_not_misaligned(panel):
    gap = pd.Timestamp("2022-05-02")
    p = panel[~((panel.ward_id == "A_1") & (panel.date == gap))]
    pipe = pipe_for(panel)
    fm, ref = pipe.transform(p, 3), pipe.transform(panel, 3)
    assert len(fm.meta[fm.meta.ward_id == "A_1"]) == len(ref.meta[ref.meta.ward_id == "A_1"]) - 1
    after = row(fm, "A_1", gap + pd.Timedelta(weeks=1)).iloc[0]
    assert np.isnan(after["rain_lag1"]) and not np.isnan(after["rain_lag0"])
    far = row(fm, "A_1", gap + pd.Timedelta(weeks=20)).iloc[0]
    far_ref = row(ref, "A_1", gap + pd.Timedelta(weeks=20)).iloc[0]
    assert far["rain_lag2"] == far_ref["rain_lag2"]
    own = [c for c in ref.X.columns if c.startswith(("rain_lag", "rain_sum", "rain_max", "case_lag", "case_sum", "temp_lag", "rh_lag"))]
    for w in ("A_2", "B_1"):   # other wards untouched (own-series features; city-level ones legitimately see the gap)
        a, b = row(fm, w), row(ref, w)
        assert np.allclose(a[own].to_numpy(float), b[own].to_numpy(float), equal_nan=True)


# 14/15. determinism and serialisation
def test_transform_is_deterministic_and_serialisable(panel, tmp_path):
    pipe = pipe_for(panel, 0, 1)
    a, b = pipe.transform(panel, 4), pipe.transform(panel, 4)
    pd.testing.assert_frame_equal(a.X, b.X)
    path = tmp_path / "pipe.joblib"
    pipe.save(path)
    loaded = FeaturePipeline.load(path)
    assert loaded.stats == pipe.stats and (loaded.wlag, loaded.clag, loaded.rain_est) == (0, 1, "regime")
    pd.testing.assert_frame_equal(loaded.transform(panel, 4).X, a.X)
    pd.testing.assert_frame_equal(loaded.transform(panel, 4).meta, a.meta)


# 11. reporting delay and the manifest
def test_case_delay_is_applied_independently_of_weather(panel):
    f0, f1 = (pipe_for(panel, 0, c).transform(panel, 3) for c in (0, 1))
    w = (f0.meta.ward_id == "A_2").to_numpy()
    assert np.array_equal(f0.X.loc[w, "case_lag0"].to_numpy()[:-1], f1.X.loc[w, "case_lag0"].to_numpy()[1:], equal_nan=True)
    assert np.array_equal(f0.X.loc[w, "rain_lag0"].to_numpy(), f1.X.loc[w, "rain_lag0"].to_numpy())
    with pytest.raises(ValueError):
        FeaturePipeline(wlag=1, clag=0)


def test_manifest_matches_matrix_and_classifies_every_feature(panel):
    fm = pipe_for(panel).transform(panel, 4)
    assert list(fm.manifest.feature) == list(fm.X.columns)
    assert fm.manifest.availability_class.isin([1, 2, 3, 4]).all()
    assert not set(PROHIBITED) & set(fm.X.columns)
    assert fm.manifest.feature.is_unique
    obs = fm.manifest.set_index("feature")
    assert obs.loc["rain_tl3", "availability_class"] == 4                 # projected at h=4, wlag 0
    assert obs.loc["rain_tl4", "availability_class"] == 1                 # rain at the origin week
    assert pipe_for(panel).transform(panel, 2).manifest.set_index("feature").loc["rain_tl3", "availability_class"] == 2


def test_operational_origin_without_known_target(panel):
    last = panel.date.max()
    fm = pipe_for(panel).transform(panel, 4, origins=[last])
    assert fm.meta.y_true.isna().all() and fm.meta.target_date.iloc[0] == last + pd.Timedelta(weeks=4)
    assert not fm.X[["rain_lag0", "case_lag0", "cal_tgt_sin1"]].isna().any().any()


# locked test year
def test_development_loader_excludes_locked_test_year():
    if not RAW_PATH.exists():
        pytest.skip("organizer CSV not placed in data/raw/")
    assert load_development_panel().date.dt.year.max() == 2024


@pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")
@pytest.mark.parametrize("w,c", [(0, 0), (1, 1)])
@pytest.mark.parametrize("h", [2, 3, 4])
def test_real_data_origin_invariance(w, c, h):
    panel = load_development_panel()
    pipe = FeaturePipeline(w, c).fit(panel, "2021-12-31")
    for origin in ("2022-01-03", "2022-07-04", "2023-09-25", "2024-06-03"):
        assert assert_origin_invariant(panel, w, c, h, origin, pipe=pipe) == []
