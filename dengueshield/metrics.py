"""Forecast metric framework.

Thresholds for "high incidence" / "outbreak" and the Low-Medium-High-Critical
tiers are quantiles of the TRAINING targets of each fold. They are data-derived
operating points for this synthetic dataset, not official epidemiological
cutoffs.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DEVIANCE_FLOOR = 0.01  # predictions are floored here before Poisson deviance (hard zeros are heavily penalised)
OUTBREAK_QUANTILE = 0.90
TIER_QUANTILES = (0.60, 0.80, 0.95)  # Low < q60 <= Medium < q80 <= High < q95 <= Critical
TIERS = ("Low", "Medium", "High", "Critical")


def thresholds(train_y: pd.Series) -> dict:
    """Training-only operating points. Quantiles of the training target distribution."""
    q = np.quantile(train_y, [OUTBREAK_QUANTILE, *TIER_QUANTILES])
    return {"outbreak": float(q[0]), "tier_edges": [float(x) for x in q[1:]]}


def risk_tier(values, tier_edges) -> np.ndarray:
    return np.asarray(TIERS)[np.searchsorted(tier_edges, np.asarray(values, float), side="right")]


def poisson_deviance(y, p) -> float:
    y, p = np.asarray(y, float), np.maximum(np.asarray(p, float), DEVIANCE_FLOOR)
    term = np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / p), 0.0)
    return float(np.mean(2 * (term - (y - p))))


def point_metrics(y, p) -> dict:
    y, p = np.asarray(y, float), np.asarray(p, float)
    if y.size == 0:
        return {"n": 0}
    e = p - y
    return {"n": int(y.size), "mae": float(np.mean(np.abs(e))), "rmse": float(np.sqrt(np.mean(e ** 2))),
            "poisson_dev": poisson_deviance(y, p), "bias": float(np.mean(e)),
            "under_rate": float(np.mean(p < y)), "under_mass": float(np.mean(np.maximum(-e, 0)))}


def evaluate(y, p, thr: dict) -> dict:
    """Overall metrics plus zero / positive / high-incidence slices and outbreak detection."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    out = {"all": point_metrics(y, p), "zero": point_metrics(y[y == 0], p[y == 0]),
           "positive": point_metrics(y[y > 0], p[y > 0])}
    actual, flagged = y >= thr["outbreak"], p >= thr["outbreak"]
    out["high"] = point_metrics(y[actual], p[actual])
    tp = int(np.sum(actual & flagged))
    prec = tp / flagged.sum() if flagged.sum() else float("nan")
    rec = tp / actual.sum() if actual.sum() else float("nan")
    out["outbreak"] = {"threshold": thr["outbreak"], "n_actual": int(actual.sum()), "n_flagged": int(flagged.sum()),
                       "precision": prec, "recall": rec,
                       "f1": 2 * prec * rec / (prec + rec) if prec + rec > 0 else float("nan")}
    out["tier_accuracy"] = float(np.mean(risk_tier(y, thr["tier_edges"]) == risk_tier(p, thr["tier_edges"])))
    return out


def flatten(d: dict, prefix: str = "") -> dict:
    flat = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        flat.update(flatten(v, key + "_") if isinstance(v, dict) else {key: v})
    return flat


def grouped(df: pd.DataFrame, by, y="y_true", p="y_pred") -> pd.DataFrame:
    """Point metrics per group (e.g. city, ward_id, horizon)."""
    return pd.DataFrame({k: point_metrics(g[y], g[p]) for k, g in df.groupby(by)}).T
