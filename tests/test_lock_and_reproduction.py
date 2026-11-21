"""The locked 2025 year stays untouched by Stage 2 code, and saved results reproduce from a fresh fit."""
import json
import re

import numpy as np
import pandas as pd
import pytest

from dengueshield.data import RAW_PATH, ROOT

NOTEBOOKS = ["04_feature_engineering", "05_feature_ablation", "06_feature_selection"]
SOURCES = [f for d in ("features", "evaluation", "models", "optimization", "calibration", "inference") for f in sorted((ROOT / "dengueshield" / d).glob("*.py"))]


def code_of(nb):
    d = json.loads((ROOT / "notebooks" / f"{nb}.ipynb").read_text())
    return "\n".join("".join(c["source"]) for c in d["cells"] if c["cell_type"] == "code")


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_stage2_modules_never_load_the_full_panel_or_unlock_test(path):
    text = path.read_text()
    assert not re.search(r"(?<!development_)load_panel\(", text.replace("def load_panel", "")), path
    assert "include_test=True" not in text and "TEST_YEAR" not in text


@pytest.mark.parametrize("nb", NOTEBOOKS)
def test_stage2_notebooks_never_load_the_full_panel_or_unlock_test(nb):
    src = code_of(nb)
    assert "load_development_panel" in src
    assert not re.search(r"(?<!development_)load_panel\(", src)
    assert "include_test=True" not in src and "TEST_YEAR" not in src


@pytest.mark.parametrize("nb", NOTEBOOKS)
def test_stage2_notebooks_ran_cleanly_on_development_years_only(nb):
    d = json.loads((ROOT / "notebooks" / f"{nb}.ipynb").read_text())
    code = [c for c in d["cells"] if c["cell_type"] == "code"]
    assert all(c.get("execution_count") for c in code)
    assert not [o for c in code for o in c.get("outputs", []) if o.get("output_type") == "error"]


def test_saved_predictions_and_tables_contain_no_2025_dates():
    for f in (ROOT / "reports" / "features").rglob("*.csv"):
        head = pd.read_csv(f, nrows=3)
        for col in head.columns:
            if "date" in col:
                assert pd.read_csv(f, usecols=[col])[col].astype(str).max() < "2025", f


@pytest.mark.skipif(not RAW_PATH.exists(), reason="organizer CSV not placed in data/raw/")
def test_saved_leaderboard_value_reproduces_from_a_fresh_fit():
    from dengueshield.data import load_development_panel
    from dengueshield.evaluation import ablation as ab
    from dengueshield.evaluation.folds import dev_folds, fold_data
    from dengueshield.evaluation.models import fit_predict, poisson_median
    panel = load_development_panel()
    fold = dev_folds()[1]
    fd = fold_data(panel, "A_end_of_week", fold, 3)
    cols = ab.configs(ab.library(fd.manifest))["F3_aligned_rain"]
    Xtr, ytr, Xev, yev, _ = fd.xy(cols)
    yrs = fd.meta.origin_date[fd.train.to_numpy()].dt.year.to_numpy()
    _, mu, _ = fit_predict("glm", Xtr, ytr, Xev, years=yrs)
    fresh = float(np.mean(np.abs(poisson_median(mu) - yev)))
    saved = pd.read_csv(ROOT / "reports/features/tables/final_mae_by_year_and_horizon.csv")
    saved = saved[(saved.config == "F3_aligned_rain") & (saved.model == "glm") & (saved.horizon == 3)].val_2023.iloc[0]
    assert fresh == pytest.approx(saved, abs=6e-4)
