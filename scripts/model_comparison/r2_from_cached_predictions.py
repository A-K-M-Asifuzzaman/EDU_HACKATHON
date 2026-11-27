#!/usr/bin/env python3
"""R² for the Stage 3 tournament, attributed by EXACT artifact identity, from its cached out-of-time season predictions.

The tournament (notebooks/07_model_tournament.ipynb) cached each fit in `.cache/models/<key>.pkl`, where
key = md5(VERSION, convention, feature-set name, exact feature columns, model, sorted parameters, horizon, season, rain projection, tag)
(`dengueshield/models/seasons.py::predict_season`). For every scored cell in reports/model_tournament/scores_all_cells.csv this script
rebuilds that key from the cell's own metadata, opens only that file, and accepts it only if the metadata stored inside the file
(model, features, convention, tag, season, horizon, row count) matches the cell. MAE agreement is recorded as a secondary check, never used
to choose a file. Tuned models use the exact best parameters read from the original Optuna study databases (+ early_stopping=True, as in
the notebook). Ensembles were combined on the fly and never cached, so they get no R². A cell without an identifiable file gets no R².

Read-only: cache files are opened for reading; Optuna databases are copied to a temporary folder before opening.
Development seasons only; 2025 is not in the cache.

    .venv/bin/python scripts/model_comparison/r2_from_cached_predictions.py [TOURNAMENT_ROOT]
TOURNAMENT_ROOT holds .cache/models and .cache/optuna (default: this repository). Writes reports/model_comparison/r2_cells_from_cache.csv
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from dengueshield.data import load_development_panel  # noqa: E402
from dengueshield.models import seasons as S  # noqa: E402


def tuned_params(optuna_dir: Path) -> dict:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        for db in sorted(optuna_dir.glob("*.db")):
            copy = Path(tmp) / db.name
            shutil.copy2(db, copy)                                       # never open the original database
            url = f"sqlite:///{copy}"
            for summ in optuna.study.get_all_study_summaries(url):
                st = optuna.load_study(study_name=summ.study_name, storage=url)
                model = db.name.split("_F3_")[0]
                out[model] = {**st.best_params, "early_stopping": True}   # exactly as notebooks/07 cell 9
    return out


def main(src: Path):
    cache, optuna_dir = src / ".cache" / "models", src / ".cache" / "optuna"
    panel = load_development_panel()
    fss = S.feature_sets(panel)
    tuned = tuned_params(optuna_dir)
    cells = pd.read_csv(ROOT / "reports/model_tournament/scores_all_cells.csv")
    cells["tag"] = cells["tag"].fillna("")
    rows = []
    for c in cells.itertuples(index=False):
        rec = {"model": c.model, "fs": c.fs, "conv": c.conv, "tag": c.tag, "year": int(c.year), "horizon": int(c.horizon)}
        if c.tag == "ensemble":
            rows.append({**rec, "attribution": "none: ensemble never cached"}); continue
        params = tuned.get(c.model, None) if c.tag == "tuned" else {}
        if params is None:
            rows.append({**rec, "attribution": "none: tuned parameters not found"}); continue
        key = S._key(S.VERSION, c.conv, c.fs, tuple(fss[c.fs]), c.model, sorted(params.items()), int(c.horizon), int(c.year), S.RAIN_EST, c.tag)
        f = cache / f"{key}.pkl"
        if not f.exists():
            rows.append({**rec, "cache_key": key, "attribution": "none: no file with the exact key"}); continue
        df = pd.read_pickle(f)                                           # the tournament's own local cache file (trusted), read-only
        inside = (df.model.iloc[0], df.fs.iloc[0], df.conv.iloc[0], df.tag.iloc[0] or "", int(df.year.iloc[0]), int(df.horizon.iloc[0]), len(df))
        if inside != (c.model, c.fs, c.conv, c.tag, int(c.year), int(c.horizon), int(c.n)) or int(df.year.max()) > 2024:
            rows.append({**rec, "cache_key": key, "attribution": "none: file metadata does not match the cell"}); continue
        d = S.dist_of(df)
        y = df.y_true.to_numpy(float)
        med, mean = d.median(), d.mean()
        point = mean if np.isfinite(mean).all() else med
        rows.append({**rec, "cache_key": key, "attribution": "exact cache key + in-file metadata", "n": len(y),
                     "mae_check": float(np.mean(np.abs(med - y))), "mae_matches_cell": bool(abs(np.mean(np.abs(med - y)) - c.mae) < 1e-9),
                     "r2_basis": "mean" if np.isfinite(mean).all() else "point", "sse_expected": float(np.sum((point - y) ** 2)),
                     "sum_y": float(y.sum()), "sum_y2": float((y ** 2).sum())})
    out = pd.DataFrame(rows)
    dst = ROOT / "reports" / "model_comparison"
    dst.mkdir(parents=True, exist_ok=True)
    out.to_csv(dst / "r2_cells_from_cache.csv", index=False)
    print(out.attribution.value_counts().to_string())
    ok = out[out.attribution.str.startswith("exact")]
    print(f"attributed {len(ok)} of {len(out)} cells; MAE agrees for {int(ok.mae_matches_cell.sum())} of them")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT)
