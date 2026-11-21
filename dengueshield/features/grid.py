"""Ward x week arrays. Shifts on axis 1 can never cross a ward, so ward isolation holds by construction."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from dengueshield.data import STATIC, TARGET, WEATHER

EXTEND = 6  # future weeks appended (all-NaN data) so calendar features exist for origins whose target is unobserved
VARS = [*WEATHER, TARGET]


@dataclass
class Grid:
    wards: np.ndarray
    city: np.ndarray
    dates: pd.DatetimeIndex  # observed weeks followed by EXTEND empty future weeks
    n_obs: int
    arr: dict
    static: dict

    @classmethod
    def from_panel(cls, panel: pd.DataFrame) -> "Grid":
        """Reindex onto the complete weekly grid: a missing ward-week becomes NaN, never a silent misalignment."""
        d0, d1 = panel["date"].min(), panel["date"].max()
        if ((panel["date"] - d0).dt.days % 7 != 0).any():
            raise ValueError("dates are not on a single weekly grid")
        obs = pd.date_range(d0, d1, freq="7D")
        dates = pd.date_range(d0, periods=len(obs) + EXTEND, freq="7D")
        if panel.duplicated(["ward_id", "date"]).any():
            raise ValueError("duplicate (ward_id, date)")
        wards = np.array(sorted(panel["ward_id"].unique()), dtype=object)
        arr = {}
        for v in VARS:
            wide = panel.pivot(index="ward_id", columns="date", values=v).reindex(index=wards, columns=dates)
            arr[v] = wide.to_numpy(float)
        stat = panel.groupby("ward_id")[STATIC].first().reindex(wards)
        if (panel.groupby("ward_id")[STATIC].nunique() > 1).any().any():
            raise ValueError("static attribute varies within a ward")
        return cls(wards, stat["city"].to_numpy(object), dates, len(obs), arr,
                   {c: stat[c].to_numpy(float if c != "city" else object) for c in STATIC})

    @property
    def shape(self):
        return len(self.wards), len(self.dates)

    def city_mean(self, a: np.ndarray) -> np.ndarray:
        """Mean over the wards of each city, broadcast back to every ward."""
        out = np.full_like(a, np.nan)
        for c in np.unique(self.city):
            m = self.city == c
            ok = ~np.isnan(a[m])
            n = ok.sum(0)
            with np.errstate(all="ignore"):
                out[m] = np.where(n > 0, np.where(ok, a[m], 0.0).sum(0) / n, np.nan)
        return out
