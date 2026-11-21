"""Forecast-problem definition and chronological validation folds.

Target(w, t, h) = dengue_cases(w, t + h weeks), h in {2, 3, 4}.

Rules enforced here (see docs/validation_protocol.md):
* targets are aligned by calendar date per ward (merge, not positional shift);
* a fold is fitted at `cutoff` with only training rows whose label was
  reported by the cutoff (target_date + report_lag weeks <= cutoff);
* evaluation rows have BOTH origin and target inside the evaluation year, so
  every evaluation origin is strictly after every label used for fitting and
  no evaluation row reads a label from the following year;
* the locked 2025 test fold is only produced when explicitly requested.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from dengueshield.data import TARGET, WEEK

HORIZONS = (2, 3, 4)
TRAIN_START_YEAR = 2016
VALIDATION_YEARS = (2022, 2023, 2024)
TEST_YEAR = 2025


def forecast_frame(panel: pd.DataFrame, horizons=HORIZONS) -> pd.DataFrame:
    """One row per (ward, origin, horizon) with y_true = cases at origin + h weeks."""
    base = panel[["ward_id", "city", "date"]].rename(columns={"date": "origin_date"})
    labels = panel[["ward_id", "date", TARGET]].rename(columns={"date": "target_date", TARGET: "y_true"})
    parts = []
    for h in horizons:
        f = base.assign(horizon=h, target_date=base["origin_date"] + h * WEEK)
        parts.append(f.merge(labels, on=["ward_id", "target_date"], how="inner", validate="one_to_one"))
    return pd.concat(parts, ignore_index=True)


@dataclass(frozen=True)
class Fold:
    name: str
    cutoff: pd.Timestamp  # last calendar day whose reported labels may be used for fitting
    eval_year: int


def folds(include_test: bool = False) -> list[Fold]:
    """Expanding-window folds: train from 2016 to the end of the year before eval_year."""
    years = list(VALIDATION_YEARS) + ([TEST_YEAR] if include_test else [])
    return [Fold(f"{'test' if y == TEST_YEAR else 'val'}_{y}", pd.Timestamp(f"{y - 1}-12-31"), y)
            for y in years]


def split(frame: pd.DataFrame, fold: Fold, report_lag: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (train, eval) rows of a forecast frame for one fold."""
    reported = frame["target_date"] + report_lag * WEEK
    train = frame[(reported <= fold.cutoff) & (frame["origin_date"].dt.year >= TRAIN_START_YEAR)]
    ev = frame[(frame["origin_date"].dt.year == fold.eval_year) & (frame["target_date"].dt.year == fold.eval_year)]
    return train, ev


def fold_sizes(frame: pd.DataFrame, report_lag: int = 0, include_test: bool = False) -> pd.DataFrame:
    rows = []
    for fold in folds(include_test):
        tr, ev = split(frame, fold, report_lag)
        for h in sorted(frame["horizon"].unique()):
            t, e = tr[tr.horizon == h], ev[ev.horizon == h]
            rows.append({"fold": fold.name, "horizon": h, "cutoff": fold.cutoff.date(),
                         "n_train": len(t), "n_eval": len(e),
                         "train_target_last": t.target_date.max().date(),
                         "eval_origin_first": e.origin_date.min().date(),
                         "eval_target_first": e.target_date.min().date(),
                         "eval_target_last": e.target_date.max().date()})
    return pd.DataFrame(rows)
