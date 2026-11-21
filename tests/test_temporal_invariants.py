"""Temporal, grouping and leakage invariants.

Runs on a synthetic panel shaped like the organizer data, so it needs no raw
file; the last test also checks the real file when it is present.
"""
import numpy as np
import pandas as pd
import pytest

from dengueshield import baselines, data, metrics
from dengueshield.data import COLUMNS, RAW_PATH, WEEK, assert_regular_panel, load_development_panel
from dengueshield.validation import HORIZONS, TEST_YEAR, folds, forecast_frame, split


def synthetic_panel(seed=0, wards=(("A_1", "X"), ("A_2", "X"), ("B_1", "Y"))):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2016-01-04", "2025-12-29", freq="7D")
    parts = []
    for i, (w, c) in enumerate(wards):
        n = len(dates)
        parts.append(pd.DataFrame({
            "date": dates, "city": c, "ward_id": w, "population_density_sqkm": 30000 + 1000 * i,
            "water_logging_risk_index": 0.3 + 0.1 * i, "sanitation_score": 0.5,
            "avg_temp_c": rng.normal(27, 4, n), "max_temp_c": 0.0, "min_temp_c": 0.0,
            "rainfall_mm": rng.gamma(1, 30, n), "relative_humidity_pct": rng.uniform(50, 95, n),
            # distinct per-ward scale so cross-ward leaks change values detectably
            "dengue_cases": rng.poisson(1 + 10 * i, n)}))
    df = pd.concat(parts, ignore_index=True)[COLUMNS]
    df["max_temp_c"], df["min_temp_c"] = df.avg_temp_c + 5, df.avg_temp_c - 5
    return df.sort_values(["ward_id", "date"], ignore_index=True)


@pytest.fixture(scope="module")
def panel():
    return synthetic_panel()


def test_target_alignment_is_by_calendar_date_within_ward(panel):
    frame = forecast_frame(panel)
    lookup = panel.set_index(["ward_id", "date"])["dengue_cases"]
    assert set(frame.horizon) == set(HORIZONS)
    assert ((frame.target_date - frame.origin_date) == frame.horizon * WEEK).all()
    assert (frame.y_true.to_numpy() == lookup.loc[list(zip(frame.ward_id, frame.target_date))].to_numpy()).all()
    # the last h origins per ward have no observable target and must be absent
    last = panel.date.max()
    for h in HORIZONS:
        assert frame[frame.horizon == h].origin_date.max() == last - h * WEEK


def test_forecast_frame_has_no_duplicates(panel):
    assert not forecast_frame(panel).duplicated(["ward_id", "origin_date", "horizon"]).any()


@pytest.mark.parametrize("report_lag", [0, 1])
def test_folds_are_chronological_and_disjoint(panel, report_lag):
    frame = forecast_frame(panel)
    for fold in folds():
        tr, ev = split(frame, fold, report_lag)
        assert len(tr) and len(ev)
        # every training label was reported by the cutoff, which precedes every eval origin
        assert (tr.target_date + report_lag * WEEK <= fold.cutoff).all()
        assert tr.target_date.max() < ev.origin_date.min()
        assert (ev.origin_date.dt.year == fold.eval_year).all() and (ev.target_date.dt.year == fold.eval_year).all()
        key = ["ward_id", "origin_date", "horizon"]
        assert tr.merge(ev, on=key).empty
        assert not set(zip(tr.ward_id, tr.target_date)) & set(zip(ev.ward_id, ev.target_date))


def test_locked_test_year_is_opt_in(panel):
    frame = forecast_frame(panel)
    assert TEST_YEAR not in [f.eval_year for f in folds()]
    for fold in folds():
        tr, ev = split(frame, fold)
        assert (tr.target_date.dt.year < TEST_YEAR).all() and (ev.target_date.dt.year < TEST_YEAR).all()
    assert folds(include_test=True)[-1].eval_year == TEST_YEAR


def test_lags_never_cross_ward_boundaries(panel):
    f = baselines.origin_features(panel)
    first = f.groupby("ward_id").head(1)
    assert first[["last", "rain_o1", "rain_o3", "ma4"]].iloc[:, 1:].isna().all().all()
    # second ward's lag-1 rain equals its own previous week, not the other ward's last week
    b = panel[panel.ward_id == "B_1"]
    fb = f[f.ward_id == "B_1"]
    assert np.allclose(fb.rain_o1.iloc[1:].to_numpy(), b.rainfall_mm.iloc[:-1].to_numpy())


def test_irregular_panel_is_rejected(panel):
    with pytest.raises(ValueError):
        assert_regular_panel(panel.drop(index=5))
    with pytest.raises(ValueError):
        assert_regular_panel(pd.concat([panel, panel.iloc[[0]]]))


@pytest.mark.parametrize("report_lag", [0, 1])
def test_predictions_ignore_everything_after_origin(panel, report_lag):
    """Scrambling unreported cases and post-origin weather must not change forecasts made at that origin."""
    origin = pd.Timestamp("2023-06-05")
    fold = next(f for f in folds() if f.eval_year == origin.year)
    future = panel.date > origin
    unreported = panel.date > origin - report_lag * WEEK
    scrambled = panel.copy()
    rng = np.random.default_rng(1)
    scrambled.loc[unreported, "dengue_cases"] = rng.poisson(50, unreported.sum())
    for c in ["rainfall_mm", "relative_humidity_pct", "avg_temp_c"]:
        scrambled.loc[future, c] = rng.uniform(0, 300, future.sum())

    def forecasts(p):
        t = baselines.build_table(p, report_lag)
        tr, ev = split(t, fold, report_lag)
        out = {}
        for h in HORIZONS:
            e = ev[(ev.horizon == h) & (ev.origin_date == origin)]
            for m in baselines.MODELS:
                out[(h, m)] = baselines.predict(tr[tr.horizon == h], e, m)
        return out

    a, b = forecasts(panel), forecasts(scrambled)
    for k in a:
        assert np.allclose(a[k], b[k]), k


def test_report_lag_hides_latest_count(panel):
    f0, f1 = baselines.origin_features(panel, 0), baselines.origin_features(panel, 1)
    w = panel.ward_id == "A_2"
    assert np.array_equal(f0.loc[w, "last"].to_numpy()[:-1], f1.loc[w, "last"].to_numpy()[1:])


def test_metrics_known_values():
    y, p = np.array([0, 2, 4]), np.array([1, 2, 1])
    m = metrics.point_metrics(y, p)
    assert m["mae"] == pytest.approx(4 / 3)
    assert m["rmse"] == pytest.approx(np.sqrt(10 / 3))
    assert m["bias"] == pytest.approx(-2 / 3)
    assert m["under_rate"] == pytest.approx(1 / 3)
    assert metrics.poisson_deviance([3], [3]) == pytest.approx(0)
    assert metrics.poisson_deviance([0], [2]) == pytest.approx(4)


def test_thresholds_and_tiers_use_training_values_only():
    thr = metrics.thresholds(pd.Series(np.arange(101)))
    assert thr["outbreak"] == pytest.approx(90)
    assert thr["tier_edges"] == pytest.approx([60, 80, 95])
    assert list(metrics.risk_tier([0, 60, 80, 95, 200], thr["tier_edges"])) == ["Low", "Medium", "High", "Critical", "Critical"]
    ev = metrics.evaluate([0, 100, 100], [0, 100, 0], thr)
    assert ev["outbreak"]["precision"] == 1 and ev["outbreak"]["recall"] == 0.5


def test_development_loader_discards_holdout_before_csv_parsing(tmp_path, monkeypatch):
    panel = synthetic_panel().query("date >= '2024-12-23' and date <= '2025-01-06'")
    panel["dengue_cases"] = panel["dengue_cases"].where(panel.date.dt.year == 2024, -987654)
    path = tmp_path / "panel.csv"
    panel.to_csv(path, index=False)
    monkeypatch.setattr(data, "EXPECTED_SHA256", data.sha256(path))
    read_csv = pd.read_csv

    def check_csv(source):
        assert b"2025-01-06" not in source.getvalue()
        assert b"-987654" not in source.getvalue()
        return read_csv(source)

    monkeypatch.setattr(pd, "read_csv", check_csv)
    assert len(load_development_panel(path)) == 6


@pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")
def test_real_development_dataset_matches_audited_shape():
    df = load_development_panel()
    assert df.shape == (28200, 12)
    assert df.ward_id.nunique() == 60 and df.city.nunique() == 5
