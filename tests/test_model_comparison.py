"""Unified model comparison (reports/MODEL_COMPARISON.csv) and the V3 classical benchmarks: provenance, comparability, no 2025."""
import hashlib
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
CMP = ROOT / "reports" / "MODEL_COMPARISON.csv"
pytestmark = pytest.mark.skipif(not CMP.exists(), reason="comparison not built")


@pytest.fixture(scope="module")
def cmp():
    return pd.read_csv(CMP)


def test_champion_rows_reproduce_the_published_leaderboard(cmp):
    lb = pd.read_csv(ROOT / "reports/model_tournament/leaderboard_all.csv")
    lb["tag"] = lb["tag"].fillna("")
    for win, lbw in (("2022-2024", "bench_2022_2024"), ("2019-2024", "outer_2019_2024")):
        ref = lb[(lb.model == "glm_poisson") & (lb.fs == "F8") & (lb.conv == "B") & (lb.tag == "") & (lb.years == lbw)].iloc[0]
        ch = cmp[(cmp.model == "glm_poisson") & cmp.feature_set.str.startswith("F8") & (cmp.convention == "B") & (cmp.window == win)].set_index("horizon")
        assert ch.loc["2-4 mean", "mae"] == pytest.approx(ref.mae_avg, abs=1e-4)
        for h in (2, 3, 4):
            assert ch.loc[str(h), "mae"] == pytest.approx(ref[f"mae_h{h}"], abs=1e-4)
        assert ch.loc["2-4 mean", "selection_status"] == "DEPLOYED CHAMPION"


def test_every_leaderboard_row_is_present_and_tuned_models_stay_out_of_the_six_season_window(cmp):
    lb = pd.read_csv(ROOT / "reports/model_tournament/leaderboard_all.csv")
    t3 = cmp[(cmp.source.str.startswith("Stage 3")) & (cmp.horizon == "2-4 mean")]
    assert len(t3) == len(lb) == 134
    assert not ((t3.window == "2019-2024") & (t3.variant_tag == "tuned")).any()


def test_r2_only_where_saved_predictions_exist(cmp):
    ens = cmp[cmp.variant_tag == "ensemble"]
    assert ens.r2.isna().all()                                            # ensembles were never cached: no R² is invented
    others = cmp[(cmp.variant_tag != "ensemble") & (cmp.horizon != "2-4 mean")]
    assert others.r2.notna().all() and (others.r2 <= 1).all()


def test_new_benchmarks_use_exactly_the_champions_evaluation_rows(cmp):
    for win in ("2022-2024", "2019-2024"):
        x = cmp[(cmp.window == win) & (cmp.convention == "B") & (cmp.horizon != "2-4 mean")]
        ch = x[(x.model == "glm_poisson") & x.feature_set.str.startswith("F8")].set_index("horizon").n_rows
        for m in ("rf", "extra_trees", "ridge_ls", "knn", "mlp", "seasonal_avg"):
            got = x[x.model == m].groupby("horizon").n_rows.first()
            assert (got == ch.loc[got.index]).all(), m


def test_no_2025_anywhere():
    for f in ("reports/model_comparison/benchmark_cells.csv", "reports/model_comparison/by_season_convention_B.csv", "reports/model_comparison/r2_cells_from_cache.csv"):
        assert pd.read_csv(ROOT / f).year.max() <= 2024, f


def test_rebuild_is_byte_identical():
    before = hashlib.sha256(CMP.read_bytes()).hexdigest()
    subprocess.run([sys.executable, str(ROOT / "scripts/model_comparison/build_model_comparison.py")], check=True, capture_output=True, cwd=ROOT)
    assert hashlib.sha256(CMP.read_bytes()).hexdigest() == before


def test_classical_regressors_clip_negatives_and_report_them():
    from dengueshield.models.classical import ClassicalRegressor
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(400, 3)), columns=list("abc"))
    y = np.maximum(0, 2 * X.a.to_numpy() + rng.normal(size=400))              # many zeros: least squares will go negative
    years = np.repeat([2019, 2020, 2021, 2022], 100)
    m = ClassicalRegressor("ridge_ls").fit(X, y, years=years)
    p = m.predict_params(X)
    assert (p["q50"] >= 0).all() and (p["raw"] < 0).any() and np.allclose(p["q50"], np.maximum(p["raw"], 0))
    assert m.hp_ in (0.1, 1.0, 10.0, 100.0, 1000.0)
    with pytest.raises(ValueError):
        ClassicalRegressor("knn").fit(X, y)                                  # the hold-out needs the training years


def test_comparison_api_serves_convention_b_only_and_the_csv():
    from fastapi.testclient import TestClient
    from dengueshield.api.main import app
    with TestClient(app) as c:
        d = c.get("/api/model/comparison").json()
        r = c.get("/api/model/comparison.csv")
    assert d["rows"] and all(x["window"] in ("2019-2024", "2022-2024") for x in d["rows"])
    assert any(x["model"] == "glm_poisson" and x["feature_set"] == "F8" for x in d["rows"])
    assert max(x["year"] for x in d["by_season"]) <= 2024
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]


def test_pooled_mae_reproduces_the_canonical_metrics_and_r2_is_identity_attributed(cmp):
    import json
    can = json.loads((ROOT / "app_data/metrics_canonical.json").read_text())["regimes"]["selection_window_2022_2024"]["by_horizon"]
    ch = cmp[(cmp.model == "glm_poisson") & cmp.feature_set.str.startswith("F8") & (cmp.convention == "B") & (cmp.window == "2022-2024")].set_index("horizon")
    for h in ("2", "3", "4"):
        assert round(ch.loc[h, "mae_pooled"], 3) == pytest.approx(can[h]["mae"], abs=1e-9)          # pooled = canonical definition
        assert ch.loc[h, "mae"] != ch.loc[h, "mae_pooled"]                                         # season-mean is reported separately
    t3 = cmp[cmp.source.str.startswith("Stage 3")]
    assert set(t3.r2_attribution.unique()) <= {"exact cache key + in-file metadata", "none: ensemble never cached"}
    assert t3[t3.r2_attribution != "exact cache key + in-file metadata"].r2.isna().all()
    assert (cmp.window_role[cmp.window == "2022-2024"] == "development validation used in model selection (not a blind test)").all()
    assert not cmp.selection_status.str.contains("no predictive distribution, so no intervals").any()   # 'as configured', not 'cannot'
