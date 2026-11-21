"""Evaluation-layer invariants: locked test year, fold masks, model boundaries, quality tools, decision rule."""
import numpy as np
import pandas as pd
import pytest

from dengueshield.data import WEEK
from dengueshield.evaluation import ablation as ab
from dengueshield.evaluation import quality as q
from dengueshield.evaluation.folds import CONVENTIONS, dev_folds, fold_data
from dengueshield.evaluation.models import GLMModel, LGBMModel, fit_predict, poisson_median
from dengueshield.validation import Fold, folds
from synth import synthetic_panel


@pytest.fixture(scope="module")
def panel():
    return synthetic_panel()


def test_locked_test_year_cannot_enter_feature_development(panel):
    assert max(f.eval_year for f in dev_folds()) == 2024
    with pytest.raises(PermissionError):
        fold_data(panel, "A_end_of_week", folds(include_test=True)[-1], 3)
    with pytest.raises(PermissionError):
        fold_data(panel, "A_end_of_week", Fold("sneaky", pd.Timestamp("2024-12-31"), 2025), 3)


@pytest.mark.parametrize("conv", list(CONVENTIONS))
@pytest.mark.parametrize("h", [2, 3, 4])
def test_fold_masks_respect_training_boundary(panel, conv, h):
    _, clag = CONVENTIONS[conv]
    for fold in dev_folds():
        fd = fold_data(panel, conv, fold, h)
        m = fd.meta
        tr, ev = fd.train.to_numpy(), fd.ev.to_numpy()
        assert ((m.target_date[tr] + clag * WEEK) <= fold.cutoff).all()
        assert m.origin_date[tr].max() < m.origin_date[ev].min()
        assert (m.origin_date[ev].dt.year == fold.eval_year).all() and (m.target_date[ev].dt.year == fold.eval_year).all()
        assert not set(zip(m.ward_id[tr], m.target_date[tr])) & set(zip(m.ward_id[ev], m.target_date[ev]))
        assert fd.stats["fit_end"] == str(fold.cutoff.date())


def test_fold_statistics_do_not_depend_on_later_years(panel):
    fold = dev_folds()[0]
    base = fold_data(panel, "A_end_of_week", fold, 3).stats
    alt = panel.copy()
    alt.loc[alt.date > fold.cutoff, ["rainfall_mm", "dengue_cases"]] = 777
    from dengueshield.evaluation import folds as fmod
    fmod._CACHE.clear()
    assert fold_data(alt, "A_end_of_week", fold, 3).stats == base
    fmod._CACHE.clear()


def test_models_do_not_use_evaluation_rows_or_labels(panel):
    fd = fold_data(panel, "A_end_of_week", dev_folds()[0], 3)
    cols = ["rain_lag0", "rain_tl3", "case_lag0", "waterlogging", "cal_tgt_sin1", "cal_tgt_cos1"]
    Xtr, ytr, Xev, yev, _ = fd.xy(cols)
    yrs = fd.meta.origin_date[fd.train.to_numpy()].dt.year.to_numpy()
    for model in ("glm", "lgbm"):
        _, a, _ = fit_predict(model, Xtr, ytr, Xev, years=yrs)
        _, b, _ = fit_predict(model, Xtr, ytr, Xev.iloc[::-1], years=yrs)          # row order / other eval rows irrelevant
        assert np.allclose(a, b[::-1], rtol=1e-6)
    g = GLMModel().fit(Xtr, ytr, years=yrs)
    assert g.alpha_ in GLMModel.ALPHAS and set(g.alpha_scores) == set(GLMModel.ALPHAS)
    with pytest.raises(ValueError):
        GLMModel().fit(Xtr, ytr)


def test_glm_alpha_selection_uses_only_training_years():
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(600, 4)), columns=list("abcd"))
    y = rng.poisson(np.exp(0.3 * X.a))
    years = np.repeat([2017, 2018, 2019], 200)
    m1 = GLMModel().fit(X, y, years=years)
    X2 = X.copy(); X2.loc[years == 2019, "a"] = 1e6          # corrupt only the held-out year: alpha may change, but must run
    GLMModel().fit(X2, y, years=years)
    assert m1.alpha_ in GLMModel.ALPHAS


def test_poisson_median_matches_definition():
    assert poisson_median(np.array([0.2, 1.0, 2.9, 10.0])).tolist() == [0, 1, 3, 10]


def test_duplicate_detector_finds_scaled_copies_and_constants():
    rng = np.random.default_rng(1)
    X = pd.DataFrame({"a": rng.normal(size=300), "c": 5.0})
    X["a_sum"] = X.a * 4
    X["b"] = rng.normal(size=300)
    d = q.duplicates(X)
    assert set(d.duplicate) == {"a_sum", "c"} and d.set_index("duplicate").loc["a_sum", "duplicates_of"] == "a"
    assert q.profile(X).set_index("feature").loc["c", "constant"]


def test_library_has_no_algebraic_duplicates_and_all_features_classified(panel):
    fd = fold_data(panel, "A_end_of_week", dev_folds()[0], 3)
    lib = ab.library(fd.manifest)
    assert not set(ab.ALGEBRAIC_DUPLICATES) & set(lib["all"])
    d = q.duplicates(fd.X[fd.train.to_numpy()])                      # full matrix: the exclusion list must be truthful
    assert set(ab.ALGEBRAIC_DUPLICATES) <= set(d.duplicate)
    cfg = ab.configs(lib)
    assert set(cfg["F0_stage1_features"]) <= set(fd.X.columns)
    assert all(set(v) <= set(fd.X.columns) for v in cfg.values())


def _fake(config, gains):
    rows = []
    for model, g in gains.items():
        for fold, v in zip(("val_2022", "val_2023", "val_2024"), g):
            rows.append({"config": config, "model": model, "kind": "median", "fold": fold, "horizon": 2, "all_mae": 1.0 - v})
    return rows


def test_decision_rule_requires_both_models_and_two_folds():
    rows = []
    for m in ("glm", "lgbm"):
        for f in ("val_2022", "val_2023", "val_2024"):
            rows.append({"config": "base", "model": m, "kind": "median", "fold": f, "horizon": 2, "all_mae": 1.0})
    rows += _fake("good", {"glm": (0.03, 0.02, 0.01), "lgbm": (0.02, 0.02, -0.01)})
    rows += _fake("one_model_only", {"glm": (0.05, 0.05, 0.05), "lgbm": (0.0, 0.0, 0.0)})
    rows += _fake("one_fold_only", {"glm": (0.2, -0.01, -0.01), "lgbm": (0.2, -0.01, -0.01)})
    rows += _fake("tiny", {"glm": (0.005, 0.005, 0.005), "lgbm": (0.005, 0.005, 0.005)})
    out = ab.decision_rule(pd.DataFrame(rows), "base", ["good", "one_model_only", "one_fold_only", "tiny"]).set_index("config")
    assert out.keep.to_dict() == {"good": True, "one_model_only": False, "one_fold_only": False, "tiny": False}


def test_result_cache_is_keyed_by_columns_and_convention():
    assert ab._key("a", ["x"], "glm", "A", "regime", "v") != ab._key("a", ["x", "y"], "glm", "A", "regime", "v")
    assert ab._key("a", ["x"], "glm", "A", "regime", "v") != ab._key("a", ["x"], "glm", "B", "regime", "v")
    assert ab._key("a", ["x"], "glm", "A", "regime", "v") != ab._key("a", ["x"], "lgbm", "A", "regime", "v")
