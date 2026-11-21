"""Season-level out-of-time predictions: for each season s, train on labels reported by 31 Dec s-1, predict season s.

Every later decision (ensemble weights, interval calibration, peak correction, risk thresholds) for an outer year Y uses
only seasons < Y, so evaluation is nested by construction. Development seasons only (<= 2024); 2025 is never built.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

from dengueshield import metrics
from dengueshield.data import DEV_LAST_YEAR, ROOT
from dengueshield.evaluation import ablation as ab
from dengueshield.evaluation import folds as fmod
from dengueshield.models.distributions import CountDist
from dengueshield.models.zoo import make
from dengueshield.validation import Fold

SEASONS = tuple(range(2018, DEV_LAST_YEAR + 1))   # out-of-time seasons with >= 2 training years
OUTER = tuple(range(2019, DEV_LAST_YEAR + 1))     # reported outer folds (earlier robustness: 2019-2021)
BENCH = (2022, 2023, 2024)                        # Stage 1/2 benchmark years
TUNE = (2019, 2020, 2021)                         # Optuna objective seasons (all < 2022: nested w.r.t. the benchmark)
RAIN_EST = "clim"
CONVS = {"B": "B_start_of_week", "A": "A_end_of_week", "C": "C_case_delay"}
CACHE = ROOT / ".cache" / "models"
VERSION = "s3.1"
PARAM_COLS = ["mu", "alpha", "p", "lam", "q50"]


def season_fold(year: int) -> Fold:
    if year > DEV_LAST_YEAR:
        raise PermissionError("the locked test year cannot be used in development")
    return Fold(f"s{year}", pd.Timestamp(f"{year - 1}-12-31"), year)


def inner_seasons(year: int, k: int = 2) -> list[int]:
    """Seasons strictly before `year` used for nested selection/calibration of the outer year."""
    return [s for s in range(year - k, year) if s in SEASONS]


def feature_sets(panel) -> dict:
    fd = fmod.fold_data(panel, "A_end_of_week", season_fold(2022), 3, RAIN_EST)
    lib = ab.library(fd.manifest)
    f8 = pd.read_csv(ROOT / "reports/features/selection/F8_features.csv").feature.tolist()
    return {"F3": ab.configs(lib)["F3_aligned_rain"], "F8": f8}


@dataclass
class SeasonData:
    Xtr: pd.DataFrame
    ytr: np.ndarray
    years: np.ndarray
    Xev: pd.DataFrame
    yev: np.ndarray
    meta: pd.DataFrame
    thr: dict


_MAT: dict = {}


def season_data(panel, conv: str, year: int, h: int, cols: list[str]) -> SeasonData:
    key = (CONVS[conv], year, h, len(panel))
    if key not in _MAT:
        fd = fmod.fold_data(panel, CONVS[conv], season_fold(year), h, RAIN_EST)
        allcols = sorted(set(cols) | set(fd.X.columns[fd.X.columns.str.startswith(("cal_", "rain_", "regime_", "monsoon", "weeks_since", "pop_", "log_pop", "waterlogging", "sanitation"))]))
        tr, ev = fd.train.to_numpy(), fd.ev.to_numpy()
        _MAT[key] = SeasonData(fd.X.loc[tr, allcols].reset_index(drop=True), fd.meta.y_true[tr].to_numpy(),
                               fd.meta.origin_date[tr].dt.year.to_numpy(), fd.X.loc[ev, allcols].reset_index(drop=True),
                               fd.meta.y_true[ev].to_numpy(), fd.meta[ev].reset_index(drop=True),
                               metrics.thresholds(fd.meta.y_true[tr]))
        fmod._CACHE.pop((CONVS[conv], f"s{year}", h, RAIN_EST, len(panel)), None)   # keep memory bounded
    sd = _MAT[key]
    missing = set(cols) - set(sd.Xtr.columns)
    if missing:
        raise KeyError(f"columns not cached: {sorted(missing)[:5]}")
    return sd


def _key(*parts) -> str:
    return hashlib.md5(repr(parts).encode()).hexdigest()[:20]


def predict_season(panel, conv, fs_name, cols, model, params, h, year, tag="") -> pd.DataFrame:
    """Fit `model` on the season's training rows and return evaluation rows with distribution parameters. Cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{_key(VERSION, conv, fs_name, tuple(cols), model, sorted(params.items()), h, year, RAIN_EST, tag)}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    sd = season_data(panel, conv, year, h, cols)
    t0 = time.perf_counter()
    m = make(model, **params).fit(sd.Xtr[cols], sd.ytr, years=sd.years)
    fit_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    prm = m.predict_params(sd.Xev[cols])
    pred_s = time.perf_counter() - t0
    d = m.dist(prm)
    out = sd.meta[["ward_id", "city", "origin_date", "target_date", "horizon", "y_true"]].copy()
    out["year"], out["conv"], out["fs"], out["model"], out["tag"] = year, conv, fs_name, model, tag
    out["dist_kind"] = d.kind
    for c in PARAM_COLS:
        v = getattr(d, c, None) if c != "mu" else (d.mu if d.mu is not None else prm.get("mu"))
        out[c] = np.broadcast_to(np.asarray(v, float), len(out)) if v is not None else np.nan
    out["thr_q90"], out["tier_e1"], out["tier_e2"], out["tier_e3"] = sd.thr["outbreak"], *sd.thr["tier_edges"]
    out["fit_s"], out["predict_s"], out["n_train"] = fit_s, pred_s, len(sd.ytr)
    out["ridge_alpha"] = getattr(m, "alpha_", np.nan)
    out["n_trees"] = getattr(m, "n_estimators_", np.nan)
    pd.to_pickle(out, path)
    return out


def dist_of(df: pd.DataFrame) -> CountDist:
    kinds = df.dist_kind.unique()
    if len(kinds) != 1:
        raise ValueError("mixed distribution kinds")
    k = kinds[0]
    g = lambda c: df[c].to_numpy(float)
    if k == "poisson":
        return CountDist("poisson", mu=g("mu"))
    if k == "nb":
        return CountDist("nb", mu=g("mu"), alpha=g("alpha"))
    if k == "hurdle":
        return CountDist("hurdle", p=g("p"), lam=g("lam"))
    return CountDist("point", q50=g("q50"))


def score(df: pd.DataFrame) -> dict:
    """Metrics for one block of predictions (one model, convention, season, horizon)."""
    d = dist_of(df)
    y = df.y_true.to_numpy(float)
    med, mean = d.median(), d.mean()
    thr = float(df.thr_q90.iloc[0])
    hi = y >= thr
    alert = med >= thr
    out = {"n": len(y), "mae": float(np.mean(np.abs(med - y))), "rmse": float(np.sqrt(np.mean((med - y) ** 2))),
           "bias": float(np.mean(med - y)), "mae_mean": float(np.nanmean(np.abs(mean - y))) if np.isfinite(mean).any() else np.nan,
           "rmse_mean": float(np.sqrt(np.nanmean((mean - y) ** 2))) if np.isfinite(mean).any() else np.nan,
           "bias_mean": float(np.nanmean(mean - y)) if np.isfinite(mean).any() else np.nan,
           "poisson_dev": metrics.poisson_deviance(y, mean) if np.isfinite(mean).all() else np.nan,
           "high_n": int(hi.sum()), "high_mae": float(np.mean(np.abs(med[hi] - y[hi]))) if hi.any() else np.nan,
           "high_bias": float(np.mean(med[hi] - y[hi])) if hi.any() else np.nan,
           "high_under": float(np.mean(med[hi] < y[hi])) if hi.any() else np.nan,
           "high_bias_mean": float(np.nanmean(mean[hi] - y[hi])) if hi.any() and np.isfinite(mean).any() else np.nan,
           "recall": float(np.mean(alert[hi])) if hi.any() else np.nan,
           "precision": float(np.mean(hi[alert])) if alert.any() else np.nan,
           "false_alert_rate": float(np.mean(alert[~hi])) if (~hi).any() else np.nan,
           "zero_mae": float(np.mean(np.abs(med[y == 0]))) if (y == 0).any() else np.nan,
           "fit_s": float(df.fit_s.iloc[0]), "predict_ms_per_1k": float(df.predict_s.iloc[0] / len(df) * 1e6)}
    return out


def score_table(preds: pd.DataFrame, by=("model", "fs", "conv", "tag", "year", "horizon")) -> pd.DataFrame:
    rows = []
    for k, g in preds.groupby(list(by), sort=False):
        rows.append({**dict(zip(by, k)), **score(g)})
    return pd.DataFrame(rows)
