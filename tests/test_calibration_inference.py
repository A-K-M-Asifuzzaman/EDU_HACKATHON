"""Stage 3 calibration, risk and deployable-bundle invariants (nested calibration, interval ordering, origin safety)."""
import numpy as np
import pandas as pd
import pytest

from dengueshield.calibration import intervals as I
from dengueshield.calibration import peaks as P
from dengueshield.calibration.risk import TIERS, revision_flips, tier_index
from dengueshield.inference import ForecastBundle, build_bundle
from dengueshield.models import seasons as S
from synth import corrupt_future, synthetic_panel
from test_models import COLS, _fake_preds


@pytest.fixture(scope="module")
def panel():
    return synthetic_panel(wards=(("A_1", "X"), ("A_2", "X"), ("B_1", "Y"), ("B_2", "Y")))


def test_interval_calibration_uses_inner_seasons_only():
    a = _fake_preds(3)
    inner = a[(a.horizon == 2) & a.year.isin(S.inner_seasons(2024))]
    p1 = I.fit_params(inner, 0.8)
    b = a.copy()
    b.loc[b.year == 2024, "y_true"] = 500
    p2 = I.fit_params(b[(b.horizon == 2) & b.year.isin(S.inner_seasons(2024))], 0.8)
    assert p1 == p2
    cov, prm = I.evaluate(a)
    assert ((cov.coverage >= 0) & (cov.coverage <= 1)).all() and set(prm.year) == set(S.OUTER)
    for meth in ("poisson", "nb_moment", "nb_coverage", "conformal"):
        lo, hi = I.intervals(a.head(50), p1, 0.8)[meth]
        assert (lo <= hi).all() and (lo >= 0).all()


def test_peak_methods_learn_on_inner_seasons_only():
    a = _fake_preds(4)
    r1 = P.evaluate(a, years=(2023,))
    c = a.copy()
    c.loc[c.year == 2023, "y_true"] = 0                # outer labels change -> only the scores change, not learned params
    r3 = P.evaluate(c, years=(2023,))
    assert r3.loc[r3.method.str.startswith("alert"), "param"].tolist() == r1.loc[r1.method.str.startswith("alert"), "param"].tolist()


# ---------------------------------------------------------------- risk tiers
def test_risk_tiers_are_monotone_and_match_thresholds():
    v = np.array([0, 0.99, 1, 4.9, 5, 12.9, 13, 40])
    t = tier_index(v, 1, 5, 13)
    assert t.tolist() == [0, 0, 1, 1, 2, 2, 3, 3] and (np.diff(t) >= 0).all()
    assert np.asarray(TIERS)[t].tolist()[-1] == "Critical"


def test_revision_flip_rate_is_a_share():
    a = _fake_preds(5)
    a["target_date"] = a.origin_date + pd.to_timedelta(a.horizon * 7, "D")
    r = revision_flips(a, a.mu.to_numpy())
    assert np.isnan(r) or 0 <= r <= 1


# ---------------------------------------------------------------- deployable bundle
@pytest.fixture(scope="module")
def bundle(panel):
    specs = {h: ("glm_poisson", {}, COLS) for h in (2, 3, 4)}
    cal = {h: {0.8: {"method": "nb_coverage", "alpha": 0.2}, 0.9: {"method": "nb_coverage", "alpha": 0.25}} for h in (2, 3, 4)}
    return build_bundle(panel, "B_start_of_week", 1, 1, specs, cal, {h: 0.4 for h in (2, 3, 4)}, {})


def test_bundle_predictions_are_valid_and_ordered(bundle, panel):
    out = bundle.predict(panel, "2024-06-03", 3)
    assert len(out) == panel.ward_id.nunique()
    assert (out.expected_cases >= 0).all() and (out.median_cases >= 0).all()
    assert (out.lower_90 <= out.lower_80).all() and (out.lower_80 <= out.upper_80).all() and (out.upper_80 <= out.upper_90).all()
    assert set(out.risk_tier) <= set(TIERS) and ((out.p_outbreak >= 0) & (out.p_outbreak <= 1)).all()
    assert (out.target_date - out.origin_date == pd.Timedelta(weeks=3)).all()


def test_bundle_save_load_parity_and_determinism(bundle, panel, tmp_path):
    a = bundle.predict(panel, "2024-06-03", 4)
    path = tmp_path / "b.joblib"
    bundle.save(path)
    b = ForecastBundle.load(path).predict(panel, "2024-06-03", 4)
    pd.testing.assert_frame_equal(a, b)
    pd.testing.assert_frame_equal(a, bundle.predict(panel, "2024-06-03", 4))


def test_bundle_is_origin_safe(bundle, panel):
    """Corrupting every observation not yet available at the origin (convention B: week t and later) changes nothing."""
    o = "2024-06-03"
    base = bundle.predict(panel, o, 2)
    bad = bundle.predict(corrupt_future(panel, o, 1, 1), o, 2)
    pd.testing.assert_frame_equal(base, bad)


def test_bundle_rejects_invalid_requests(bundle, panel):
    with pytest.raises(ValueError):
        bundle.predict(panel, "2024-06-03", 5)
    with pytest.raises(ValueError):
        bundle.predict(panel, "2024-06-03", 3, wards=["NOT_A_WARD"])
    with pytest.raises(ValueError):
        bundle.predict(panel, "2024-06-05", 3)                    # not on the weekly grid
    with pytest.raises(ValueError):
        bundle.predict(panel, "2026-11-23", 3)                    # beyond the observed record: refused, not extrapolated
    with pytest.raises(ValueError):
        bundle.predict(panel, "2016-03-07", 3)                    # insufficient history
    with pytest.raises(ValueError):
        bundle.predict(panel.drop(columns=["sanitation_score"]), "2024-06-03", 3)


def test_bundle_allows_the_first_origin_after_the_record_under_start_of_week(bundle, panel):
    last = panel.date.max()
    out = bundle.predict(panel, last + pd.Timedelta(weeks=1), 2)   # B: needs week t-1 = last observed week
    assert len(out) == panel.ward_id.nunique()
    with pytest.raises(ValueError):
        bundle.predict(panel, last + pd.Timedelta(weeks=2), 2)


def test_bundle_reporting_delay_ignores_unreported_cases(bundle, panel):
    o = pd.Timestamp("2024-06-03")
    alt = panel.copy()
    alt.loc[alt.date == o, "dengue_cases"] = 500                   # week t cases are not reported at a Monday origin
    pd.testing.assert_frame_equal(bundle.predict(panel, o, 3), bundle.predict(alt, o, 3))


def test_bundle_schema_and_manifest(bundle):
    for hm in bundle.horizons.values():
        assert set(hm.cols) <= set(bundle.manifest.feature)
        assert hm.thresholds["tier_edges"] == sorted(hm.thresholds["tier_edges"])
    assert bundle.convention == {"name": "B_start_of_week", "wlag": 1, "clag": 1}
    assert bundle.train_cutoff == "2024-12-31"


def test_bundle_explain_sums_to_the_log_rate(bundle, panel):
    e = bundle.explain(panel, "2024-06-03", 3)
    out = bundle.predict(panel, "2024-06-03", 3)
    fam = [c for c in e.columns if c not in ("ward_id", "baseline_log_rate")]
    assert np.allclose(np.exp(e[fam].sum(axis=1) + e.baseline_log_rate), out.expected_cases, rtol=1e-6)
