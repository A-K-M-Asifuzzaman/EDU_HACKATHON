"""Tournament orchestration and leaderboards over season-level out-of-time predictions."""
from __future__ import annotations

import time

import numpy as np
import pandas as pd

from dengueshield.models import seasons as S

SCREEN_MODELS = ["glm_poisson", "glm_poisson_nbdisp", "glm_spline", "glm_nb", "glm_tweedie", "lgbm_poisson", "lgbm_tweedie",
                 "lgbm_l1", "xgb_poisson", "cat_poisson", "hurdle_lgbm"]


def run_grid(panel, models, fss: dict, convs=("B", "A"), horizons=(2, 3, 4), seasons=S.SEASONS, params=None, tag="", log=None):
    params = params or {}
    out, t0 = [], time.perf_counter()
    for conv in convs:
        for fs_name, cols in fss.items():
            for h in horizons:
                for yr in seasons:
                    for m in models:
                        out.append(S.predict_season(panel, conv, fs_name, cols, m, params.get(m, {}), h, yr, tag))
                if log:
                    log(f"{conv} {fs_name} h={h} done at {time.perf_counter() - t0:.0f}s")
    return pd.concat(out, ignore_index=True)


def leaderboard(scores: pd.DataFrame, years, keys=("model", "fs", "conv", "tag")) -> pd.DataFrame:
    """Mean over `years` per horizon, the 3-horizon average, per-year average MAE and fold SD."""
    s = scores[scores.year.isin(years)]
    keys = list(keys)
    h = s.pivot_table(index=keys, columns="horizon", values="mae", aggfunc="mean")
    h.columns = [f"mae_h{c}" for c in h.columns]
    out = h.copy()
    out["mae_avg"] = h.mean(axis=1)
    yr = s.groupby(keys + ["year"]).mae.mean().unstack("year")
    out["year_sd"] = yr.std(axis=1)
    for c in yr.columns:
        out[f"mae_{c}"] = yr[c]
    for c in ["rmse", "mae_mean", "rmse_mean", "bias", "bias_mean", "high_mae", "high_bias", "high_under", "high_bias_mean",
              "recall", "precision", "false_alert_rate", "poisson_dev", "fit_s", "predict_ms_per_1k"]:
        out[c] = s.groupby(keys)[c].mean()
    return out.reset_index().sort_values("mae_avg")


def paired(scores: pd.DataFrame, ref: dict, years, keys=("model", "fs", "conv", "tag")) -> pd.DataFrame:
    """Paired year x horizon MAE differences vs a reference row (negative = better than reference).
    Season-level CI uses a t interval over seasons (season-averaged differences); with 3-6 seasons it is wide and fragile."""
    from scipy.stats import t as tdist
    s = scores[scores.year.isin(years)]
    keys = list(keys)
    r = s[np.logical_and.reduce([s[k] == v for k, v in ref.items()])].set_index(["year", "horizon"]).mae
    rows = []
    for k, g in s.groupby(keys):
        d = g.set_index(["year", "horizon"]).mae - r
        d = d.dropna()
        per_year = d.groupby(level="year").mean()
        n = len(per_year)
        se = per_year.std(ddof=1) / np.sqrt(n) if n > 1 else np.nan
        q = tdist.ppf(0.975, n - 1) if n > 1 else np.nan
        rows.append({**dict(zip(keys, k)), "mean_diff": d.mean(), "cells_better": int((d < 0).sum()), "cells": int(len(d)),
                     "years_better": int((per_year < 0).sum()), "years": n,
                     "ci95_lo": per_year.mean() - q * se, "ci95_hi": per_year.mean() + q * se})
    return pd.DataFrame(rows).sort_values("mean_diff")
