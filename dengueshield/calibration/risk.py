"""Low / Medium / High / Critical tiers from training-quantile cut points (q60, q80, q95 of training weekly cases).
These are statistical categories for this dataset, NOT official public-health warning levels."""
from __future__ import annotations

import numpy as np
import pandas as pd

TIERS = ("Low", "Medium", "High", "Critical")


def tier_index(values, e1, e2, e3) -> np.ndarray:
    v = np.asarray(values, float)
    return (v >= e1).astype(int) + (v >= e2).astype(int) + (v >= e3).astype(int)


def evaluate(df: pd.DataFrame, point: np.ndarray, name: str) -> tuple[dict, pd.DataFrame]:
    e = [df[c].to_numpy() for c in ("tier_e1", "tier_e2", "tier_e3")]
    pt, at = tier_index(point, *e), tier_index(df.y_true.to_numpy(), *e)
    cm = pd.crosstab(pd.Categorical(np.asarray(TIERS)[at], TIERS), pd.Categorical(np.asarray(TIERS)[pt], TIERS),
                     rownames=["actual"], colnames=["predicted"], dropna=False)
    sig_a, sig_p = at >= 2, pt >= 2          # "significant risk" = High or Critical
    tp = int((sig_a & sig_p).sum())
    summ = {"scheme": name, "accuracy": float(np.mean(pt == at)), "within_one_tier": float(np.mean(np.abs(pt - at) <= 1)),
            "sig_recall": tp / max(sig_a.sum(), 1), "sig_precision": tp / max(sig_p.sum(), 1),
            "sig_false_alert_rate": float((sig_p & ~sig_a).sum() / max((~sig_a).sum(), 1)),
            **{f"pred_share_{t}": float(np.mean(pt == i)) for i, t in enumerate(TIERS)},
            **{f"actual_share_{t}": float(np.mean(at == i)) for i, t in enumerate(TIERS)}}
    return summ, cm


def revision_flips(df: pd.DataFrame, point: np.ndarray) -> float:
    """Share of (ward, target week) whose tier changes between the h=4, h=3 and h=2 forecasts."""
    d = df.assign(tier=tier_index(point, df.tier_e1, df.tier_e2, df.tier_e3))
    g = d.groupby(["ward_id", "target_date"]).tier.nunique()
    g = g[d.groupby(["ward_id", "target_date"]).horizon.nunique() == 3]
    return float(np.mean(g > 1)) if len(g) else np.nan
