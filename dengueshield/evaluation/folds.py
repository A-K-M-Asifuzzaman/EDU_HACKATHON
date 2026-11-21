"""Fold datasets for feature experiments: fold-fitted pipeline -> train/eval matrices. Development years only."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from dengueshield.data import DEV_LAST_YEAR, WEEK
from dengueshield.features import FeaturePipeline
from dengueshield.validation import Fold, folds

CONVENTIONS = {"A_end_of_week": (0, 0), "B_start_of_week": (1, 1), "C_case_delay": (0, 1)}


@dataclass
class FoldData:
    fold: Fold
    h: int
    X: pd.DataFrame
    meta: pd.DataFrame
    manifest: pd.DataFrame
    train: pd.Series   # boolean masks aligned with X
    ev: pd.Series
    stats: dict
    build_seconds: float

    def xy(self, cols):
        tr, ev = self.train.to_numpy(), self.ev.to_numpy()
        return (self.X.loc[tr, cols], self.meta.y_true[tr].to_numpy(), self.X.loc[ev, cols], self.meta.y_true[ev].to_numpy(), self.meta[ev])


_CACHE: dict = {}


def fold_data(panel: pd.DataFrame, conv: str, fold: Fold, h: int, rain_est: str = "regime") -> FoldData:
    """Training rows: label of the target week reported by the cutoff. Evaluation rows: origin AND target in the evaluation year."""
    if fold.eval_year > DEV_LAST_YEAR:
        raise PermissionError("the locked test year cannot be used in feature development")
    key = (conv, fold.name, h, rain_est, len(panel))
    if key not in _CACHE:
        w, c = CONVENTIONS[conv]
        pipe = FeaturePipeline(w, c, rain_est).fit(panel, fold.cutoff)
        fm = pipe.transform(panel, h)
        m = fm.meta
        train = (m.target_date + c * WEEK) <= fold.cutoff
        ev = (m.origin_date.dt.year == fold.eval_year) & (m.target_date.dt.year == fold.eval_year)
        assert not (train & ev).any() and m.origin_date[train].max() < m.origin_date[ev].min()
        _CACHE[key] = FoldData(fold, h, fm.X, m, fm.manifest, train, ev, pipe.stats.as_dict(), fm.seconds)
    return _CACHE[key]


def dev_folds():
    fs = folds(include_test=False)
    assert all(f.eval_year <= DEV_LAST_YEAR for f in fs)
    return fs
