"""Nested blends of predicted means. For outer year Y and horizon h the weight is chosen on the inner seasons (< Y) only."""
from __future__ import annotations

import numpy as np
import pandas as pd

from dengueshield.models import seasons as S
from dengueshield.models.distributions import CountDist

KEY = ["ward_id", "origin_date", "horizon", "year"]
GRID = np.round(np.linspace(0, 1, 11), 2)


def _mae_blend(a: pd.DataFrame, b: pd.DataFrame, w: float) -> float:
    mu = w * a.mu.to_numpy() + (1 - w) * b.mu.to_numpy()
    return float(np.mean(np.abs(CountDist("poisson", mu=mu).median() - a.y_true.to_numpy())))


def nested_blend(pa: pd.DataFrame, pb: pd.DataFrame, name: str, years=S.OUTER) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Blend two models' season predictions. Returns (outer predictions, weight log). Weight = share of model A."""
    m = pa.merge(pb[KEY + ["mu"]], on=KEY, suffixes=("", "_b"), validate="one_to_one")
    if len(m) != len(pa):
        raise ValueError("prediction sets do not align")
    out, log = [], []
    for h in sorted(m.horizon.unique()):
        for yr in years:
            inner = S.inner_seasons(yr)
            I = m[(m.horizon == h) & m.year.isin(inner)]
            a, b = I, I.assign(mu=I.mu_b)
            scores = {w: _mae_blend(a, b, w) for w in GRID}
            w = min(scores, key=lambda k: (scores[k], abs(k - 0.5)))
            O = m[(m.horizon == h) & (m.year == yr)].copy()
            O["mu"] = w * O.mu + (1 - w) * O.mu_b
            O["dist_kind"], O["alpha"], O["model"] = "poisson", np.nan, name
            out.append(O.drop(columns=["mu_b"]))
            log.append({"ensemble": name, "horizon": h, "year": yr, "inner_seasons": inner, "weight_A": w, "inner_mae": scores[w]})
    return pd.concat(out, ignore_index=True), pd.DataFrame(log)
