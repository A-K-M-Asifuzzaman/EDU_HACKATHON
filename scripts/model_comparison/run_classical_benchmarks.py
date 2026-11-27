#!/usr/bin/env python3
"""V3 classical benchmarks on the Stage 3 tournament's exact evaluation design (research only).

Same as the tournament (dengueshield/models/seasons.py):
- season-level out-of-time folds: for season Y, fit on labels reported by 31 Dec Y-1, evaluate rows whose origin AND target are in Y;
- forecast-origin convention B (start of week: weather and cases up to week t-1), the production convention;
- the frozen F8 (24) and F3 (38) feature sets with the `clim` rain projection;
- outbreak threshold = training-label q90 of that fold; metrics from seasons.score (identical code to the leaderboard).
Seasons 2019-2024 (outer) and 2022-2024 (benchmark, also used for the original model selection). 2025 is never built.

Models: rf, extra_trees, ridge_ls, knn, mlp (dengueshield/models/classical.py) plus five simple baselines re-run under convention B
(case history lagged one week): global_mean, ward_mean, seasonal_avg (same ISO week in past years), last_known, moving_avg_4.
Also measures the serialized size of one fitted model per family (season 2024, h=3, convention B, F8).

    .venv/bin/python scripts/model_comparison/run_classical_benchmarks.py
writes reports/model_comparison/benchmark_cells.csv, model_sizes.csv
"""
from __future__ import annotations

import pickle
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from dengueshield import baselines as B  # noqa: E402
from dengueshield.data import load_development_panel  # noqa: E402
from dengueshield.models import seasons as S  # noqa: E402
from dengueshield.models.classical import NEW_MODELS  # noqa: E402
from dengueshield.models.zoo import make  # noqa: E402
from dengueshield.validation import split  # noqa: E402

YEARS = tuple(range(2019, 2025))
CONV = "B"
BASELINES = ("global_mean", "ward_mean", "seasonal_avg", "last_known", "moving_avg_4")
OUT = ROOT / "reports" / "model_comparison"
CACHE = ROOT / ".cache" / "benchmarks"
KEYS = ["ward_id", "origin_date", "horizon"]


def block(sd, pred_q50, raw, fit_s, pred_s, extra) -> dict:
    """Score one (model, features, season, horizon) block with the tournament's own score(), plus diagnostics."""
    df = sd.meta[["ward_id", "city", "origin_date", "target_date", "horizon", "y_true"]].copy()
    df["dist_kind"], df["q50"] = "point", pred_q50
    for c in ("mu", "alpha", "p", "lam"):
        df[c] = np.nan
    df["thr_q90"], df["fit_s"], df["predict_s"] = sd.thr["outbreak"], fit_s, pred_s
    s = S.score(df)
    y = df.y_true.to_numpy(float)
    s.update({"mae_unclipped": float(np.mean(np.abs(raw - y))), "neg_share": float(np.mean(raw < 0)),
              "mae_poisson_median_of_point": float(np.mean(np.abs(poisson.ppf(0.5, np.maximum(pred_q50, 1e-9)) - y))),
              "sse_point": float(np.sum((pred_q50 - y) ** 2)), "sum_y": float(y.sum()), "sum_y2": float((y ** 2).sum()), **extra})
    return s


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    panel = load_development_panel()
    assert panel["date"].dt.year.max() <= 2024, "the development panel must not contain 2025"
    fss = S.feature_sets(panel)
    base_table = B.build_table(panel, report_lag=1)                    # convention B: cases known up to week t-1
    rows, t_all = [], time.perf_counter()
    for year in YEARS:
        for h in (2, 3, 4):
            # --- baselines (feature-free), aligned to the exact evaluation rows of the season harness
            sd0 = S.season_data(panel, CONV, year, h, fss["F8"])
            tr_all, ev_all = split(base_table, S.season_fold(year), report_lag=1)
            tr, ev = tr_all[tr_all.horizon == h], ev_all[ev_all.horizon == h]
            ev = sd0.meta[KEYS].merge(ev, on=KEYS, how="left", validate="one_to_one")
            for m in BASELINES:
                t0 = time.perf_counter(); p = B.predict(tr, ev, m); dt = time.perf_counter() - t0
                if np.isnan(p).any():
                    raise ValueError(f"{m} produced NaN for {year} h={h}")
                rows.append({"model": m, "fs": "none", "conv": CONV, "year": year, "horizon": h, **block(sd0, p, p, dt, 0.0, {"hp": "", "converged": True})})
            # --- classical regressors on both frozen feature sets
            for fs_name, cols in fss.items():
                sd = S.season_data(panel, CONV, year, h, cols)
                for m in NEW_MODELS:
                    path = CACHE / f"{m}_{fs_name}_{CONV}_{year}_h{h}.pkl"
                    if path.exists():                                  # this script's own local cache (trusted): resume after interruption
                        rows.append(pd.read_pickle(path)); continue
                    t0 = time.perf_counter(); mod = make(m).fit(sd.Xtr[cols], sd.ytr, years=sd.years); fit_s = time.perf_counter() - t0
                    t0 = time.perf_counter(); prm = mod.predict_params(sd.Xev[cols]); pred_s = time.perf_counter() - t0
                    r = {"model": m, "fs": fs_name, "conv": CONV, "year": year, "horizon": h,
                         **block(sd, prm["q50"], prm["raw"], fit_s, pred_s, {"hp": "" if mod.hp_ is None else str(mod.hp_), "converged": bool(mod.converged)})}
                    pd.to_pickle(r, path); rows.append(r)
            print(f"{year} h={h} done ({time.perf_counter() - t_all:.0f}s)", flush=True)
    cells = pd.DataFrame(rows)
    cells.to_csv(OUT / "benchmark_cells.csv", index=False)

    # --- serialized model size: one fit per family on season 2024, h=3, convention B, F8 (bytes of a pickle)
    sd = S.season_data(panel, CONV, 2024, 3, fss["F8"])
    sizes = []
    for m in ("glm_poisson", "glm_poisson_nbdisp", "glm_spline", "glm_nb", "glm_tweedie", "lgbm_poisson", "lgbm_tweedie", "lgbm_l1",
              "xgb_poisson", "cat_poisson", "hurdle_lgbm", *NEW_MODELS):
        try:
            mod = make(m).fit(sd.Xtr[fss["F8"]], sd.ytr, years=sd.years)
            try:
                sizes.append({"model": m, "size_bytes": len(pickle.dumps(mod)), "measured_on": "season 2024, h=3, convention B, F8"})
            except TypeError:                                          # the XGBoost wrapper keeps a module reference: measure its fitted estimator
                sizes.append({"model": m, "size_bytes": len(pickle.dumps(mod.m)), "measured_on": "season 2024, h=3, convention B, F8 (fitted estimator inside the wrapper)"})
        except Exception as e:                                         # report, never hide, a failed measurement
            sizes.append({"model": m, "size_bytes": np.nan, "measured_on": f"failed: {type(e).__name__}: {e}"[:200]})
    for m in BASELINES:
        sizes.append({"model": m, "size_bytes": np.nan, "measured_on": "no fitted object (lookup rule)"})
    bundle = ROOT / "models" / "dengueshield_B.joblib"
    sizes.append({"model": "deployed bundle (3 horizons, GLM + calibration)", "size_bytes": bundle.stat().st_size, "measured_on": str(bundle.relative_to(ROOT))})
    pd.DataFrame(sizes).to_csv(OUT / "model_sizes.csv", index=False)
    print(f"done: {len(cells)} cells in {time.perf_counter() - t_all:.0f}s")


if __name__ == "__main__":
    main()
