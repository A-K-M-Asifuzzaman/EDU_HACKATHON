"""Feature pipeline: fit fold-specific statistics, then transform history into a matrix plus a manifest.

    pipe = FeaturePipeline(wlag=0, clag=0).fit(panel, cutoff)      # only rows inside the training boundary
    fm   = pipe.transform(panel, horizon=3)                         # rows whose target is observed
    fm   = pipe.transform(panel, horizon=3, origins=[date])         # operational use; target may be unknown

Feature construction never touches a model. `transform` uses only data dated at or before the origin (minus the
availability lags), calendar dates, and the fitted scalars; see tests/test_feature_pipeline.py.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd

from dengueshield.data import TARGET
from dengueshield.features.families import PROHIBITED, Ctx, build_all
from dengueshield.features.grid import Grid
from dengueshield.features.stats import FittedStats

VERSION = "2.0"
AVAIL_LABEL = {1: "observed at origin", 2: "derived from observed history", 3: "known in advance",
               4: "estimated from past-year climatology", 5: "prohibited"}


@dataclass
class FeatureMatrix:
    X: pd.DataFrame
    meta: pd.DataFrame           # ward_id, city, origin_date, target_date, horizon, y_true
    manifest: pd.DataFrame
    seconds: float


@dataclass
class FeaturePipeline:
    wlag: int = 0                # weeks of delay before a weather row becomes usable
    clag: int = 0                # weeks of delay before a case row becomes usable (>= wlag)
    rain_est: str = "regime"     # projection of unobserved rain: regime | clim | zero
    stats: FittedStats | None = None
    version: str = VERSION
    _timing: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.clag < self.wlag:
            raise ValueError("cases cannot be available before the weather of the same week")

    def fit(self, panel: pd.DataFrame, cutoff) -> "FeaturePipeline":
        """Estimate thresholds from weeks dated <= cutoff (cases: reported by cutoff). Nothing later is read."""
        grid = Grid.from_panel(panel[panel["date"] <= pd.Timestamp(cutoff)])
        self.stats = FittedStats.fit(grid, pd.Timestamp(cutoff), self.clag)
        return self

    def transform(self, panel: pd.DataFrame, horizon: int, origins=None) -> FeatureMatrix:
        if self.stats is None:
            raise RuntimeError("fit() first")
        if horizon not in (2, 3, 4):
            raise ValueError("horizon must be 2, 3 or 4")
        t0 = time.perf_counter()
        grid = Grid.from_panel(panel)
        feats = build_all(Ctx(grid, horizon, self.wlag, self.clag, self.stats, self.rain_est))
        names = [f.name for f in feats]
        if len(set(names)) != len(names) or set(names) & set(PROHIBITED):
            raise AssertionError("duplicate or prohibited feature name")
        T = len(grid.dates)
        if origins is None:
            idx = np.arange(0, grid.n_obs - horizon)       # target observed
        else:
            idx = np.array([grid.dates.get_loc(pd.Timestamp(o)) for o in origins])
        W = len(grid.wards)
        flat = lambda a: a[:, idx].reshape(-1)
        keep = None if origins is not None else ~np.isnan(flat(np.where(np.isnan(grid.arr[TARGET]), np.nan, 1.0)[:, np.minimum(idx + horizon, T - 1)]))
        X = pd.DataFrame({f.name: flat(f.values) for f in feats})
        tgt_idx = idx + horizon
        y = grid.arr[TARGET][:, np.minimum(tgt_idx, T - 1)]
        y = np.where(tgt_idx[None, :] < grid.n_obs, y, np.nan).reshape(-1)
        dd = pd.date_range(grid.dates[0], periods=T + 8, freq="7D")
        meta = pd.DataFrame({"ward_id": np.repeat(grid.wards, len(idx)), "city": np.repeat(grid.city, len(idx)),
                             "origin_date": np.tile(grid.dates[idx], W), "target_date": np.tile(dd[tgt_idx], W),
                             "horizon": horizon, "y_true": y})
        man = pd.DataFrame([{"feature": f.name, "family": f.family, "subfamily": f.sub, "availability_class": f.cls,
                             "availability": AVAIL_LABEL[f.cls], "horizon": horizon, "description": f.desc} for f in feats])
        if keep is not None:                       # training matrix: a missing label (gap in the data) is not a row
            X, meta = X[keep].reset_index(drop=True), meta[keep].reset_index(drop=True)
        return FeatureMatrix(X, meta, man, time.perf_counter() - t0)

    def save(self, path) -> None:
        joblib.dump(self, path)

    @staticmethod
    def load(path) -> "FeaturePipeline":
        return joblib.load(path)
