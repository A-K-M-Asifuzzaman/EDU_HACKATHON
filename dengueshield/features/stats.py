"""Fold-fitted scalar statistics. Fitted only from rows inside the training boundary (`cutoff`)."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from dengueshield.features.grid import Grid


def otsu_threshold(x: np.ndarray, bins: int = 128) -> float:
    """Otsu split of a 1-D sample (maximises between-class variance)."""
    x = x[~np.isnan(x)]
    hist, edges = np.histogram(x, bins=bins)
    p = hist / hist.sum()
    mid = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(p)
    m0 = np.cumsum(p * mid)
    with np.errstate(all="ignore"):
        between = (m0[-1] * w0 - m0) ** 2 / (w0 * (1 - w0))
    return float(mid[np.nanargmax(between)])


@dataclass(frozen=True)
class FittedStats:
    """Thresholds estimated on training weeks only. Serialisable; carries its own fit boundary."""
    fit_end: str
    n_weeks: int
    wet_thr: float      # weekly rain (mm) separating the dry and monsoon regimes (Otsu on log1p rain)
    rain_hi_thr: float  # 75th percentile of weekly rain among wet-regime weeks
    rh_hi_thr: float    # 75th percentile of weekly humidity
    case_hi_thr: float  # 90th percentile of reported weekly cases (outbreak level)

    @classmethod
    def fit(cls, grid: Grid, cutoff: pd.Timestamp, case_lag: int = 0) -> "FittedStats":
        """Use weather weeks dated <= cutoff and case weeks reported by the cutoff."""
        t = (grid.dates <= cutoff) & (np.arange(len(grid.dates)) < grid.n_obs)
        rain = grid.arr["rainfall_mm"][:, t]
        wet = float(np.expm1(otsu_threshold(np.log1p(rain.ravel()))))
        tc = grid.dates <= cutoff - pd.Timedelta(weeks=case_lag)
        tc &= np.arange(len(grid.dates)) < grid.n_obs
        cases = grid.arr["dengue_cases"][:, tc]
        return cls(fit_end=str(cutoff.date()), n_weeks=int(t.sum()), wet_thr=wet,
                   rain_hi_thr=float(np.nanquantile(rain[rain > wet], 0.75)),
                   rh_hi_thr=float(np.nanquantile(grid.arr["relative_humidity_pct"][:, t], 0.75)),
                   case_hi_thr=float(np.nanquantile(cases, 0.90)))

    def as_dict(self) -> dict:
        return asdict(self)
