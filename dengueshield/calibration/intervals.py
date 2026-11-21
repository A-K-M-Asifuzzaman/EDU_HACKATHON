"""Predictive intervals. Every calibration parameter for outer year Y is estimated on inner seasons (< Y) only."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import nbinom, poisson

from dengueshield.models import seasons as S
from dengueshield.models.distributions import moment_alpha

LEVELS = (0.8, 0.9)


def _nb_int(mu, a, level):
    lo_q, hi_q = (1 - level) / 2, (1 + level) / 2
    n, pr = 1 / a, 1 / (1 + a * np.maximum(mu, 1e-9))
    return nbinom.ppf(lo_q, n, pr), nbinom.ppf(hi_q, n, pr)


def _pois_int(mu, level):
    return poisson.ppf((1 - level) / 2, np.maximum(mu, 1e-9)), poisson.ppf((1 + level) / 2, np.maximum(mu, 1e-9))


def _coverage(y, lo, hi):
    return float(np.mean((y >= lo) & (y <= hi)))


def fit_params(inner: pd.DataFrame, level: float) -> dict:
    """All interval parameters learnable from inner-season predictions (y, mu)."""
    y, mu = inner.y_true.to_numpy(float), inner.mu.to_numpy(float)
    a_mom = moment_alpha(y, mu)
    grid = np.exp(np.linspace(np.log(1e-3), np.log(3.0), 60))
    cov = np.array([_coverage(y, *_nb_int(mu, a, level)) for a in grid])
    ok = np.where(cov >= level)[0]
    a_cov = float(grid[ok[0]]) if len(ok) else float(grid[-1])          # smallest alpha reaching nominal coverage
    s = np.abs(y - mu) / np.sqrt(mu + 1)
    n = len(s)
    q = float(np.quantile(s, min(1.0, np.ceil((n + 1) * level) / n), method="higher"))
    return {"alpha_moment": a_mom, "alpha_cov": a_cov, "conformal_q": q, "n_inner": n}


def intervals(df: pd.DataFrame, prm: dict, level: float) -> dict:
    mu = df.mu.to_numpy(float)
    c = prm["conformal_q"] * np.sqrt(mu + 1)
    return {"poisson": _pois_int(mu, level),
            "nb_moment": _nb_int(mu, prm["alpha_moment"], level),
            "nb_coverage": _nb_int(mu, prm["alpha_cov"], level),
            "conformal": (np.floor(np.maximum(mu - c, 0)), np.ceil(mu + c))}


def evaluate(preds: pd.DataFrame, years=S.OUTER, levels=LEVELS) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Coverage and width per method/level/year/horizon, nested on inner seasons. `preds` = one model's season predictions."""
    rows, params = [], []
    for level in levels:
        for h in sorted(preds.horizon.unique()):
            for yr in years:
                inner = preds[(preds.horizon == h) & preds.year.isin(S.inner_seasons(yr))]
                outer = preds[(preds.horizon == h) & (preds.year == yr)]
                prm = fit_params(inner, level)
                params.append({"level": level, "horizon": h, "year": yr, **prm})
                y = outer.y_true.to_numpy(float)
                hi_rows = y >= outer.thr_q90.to_numpy()
                for meth, (lo, hi) in intervals(outer, prm, level).items():
                    inside = (y >= lo) & (y <= hi)
                    rows.append({"method": meth, "level": level, "horizon": h, "year": yr, "coverage": inside.mean(),
                                 "coverage_high": inside[hi_rows].mean() if hi_rows.any() else np.nan,
                                 "coverage_zero": inside[y == 0].mean(), "width": float(np.mean(hi - lo)),
                                 "width_high": float(np.mean((hi - lo)[hi_rows])) if hi_rows.any() else np.nan,
                                 "below": float(np.mean(y < lo)), "above": float(np.mean(y > hi))})
    return pd.DataFrame(rows), pd.DataFrame(params)
