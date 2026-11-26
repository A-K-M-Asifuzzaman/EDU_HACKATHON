#!/usr/bin/env python3
"""Build the canonical, versioned model-metrics file used by every page and document (V3).

    python scripts/build_canonical_metrics.py            # writes app_data/metrics_canonical.json

Source: the saved out-of-time replay table `app_data/replay.csv.gz` (2019–2024; each season predicted by models fitted only on earlier
seasons). Nothing is refitted and the sealed 2025 holdout is never read.

Evaluation regimes are labelled explicitly:
- out_of_time_2019_2024: every replay row (out-of-time per row; seasons 2019–2024).
- selection_window_2022_2024: the seasons also used to choose features, model and alert rule. Validation, NOT a blind test.
- blind_test_2025: sealed; not evaluated.

Peaks are weeks with y_true ≥ thr_q90 (the training-period 90th percentile used as the outbreak threshold). Figures are POOLED over rows;
the legacy "cell mean" figures (unweighted mean over season × horizon cells) are reported separately to reconcile older documents.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPLAY = ROOT / "app_data" / "replay.csv.gz"
OUT = ROOT / "app_data" / "metrics_canonical.json"
SCHEMA = "dengueshield.metrics/1"


def _r(x, n=3):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def block(d: pd.DataFrame) -> dict:
    """Pooled metrics for one subset of replay rows."""
    err = d["median"] - d.y_true
    peak = d.y_true >= d.thr_q90
    pos = (d.y_true > 0) & ~peak
    zero = d.y_true == 0
    big = d.y_true >= 20
    c80 = (d.y_true >= d.lo80) & (d.y_true <= d.hi80)
    c90 = (d.y_true >= d.lo90) & (d.y_true <= d.hi90)
    tp = (d.alert & peak).sum()
    out = {
        "n": int(len(d)),
        "mae": _r(err.abs().mean()), "rmse": _r(np.sqrt((err ** 2).mean())), "bias": _r(err.mean()),
        "share_zero_weeks": _r(zero.mean()),
        "coverage": {},
        "width_mean": {"80": _r((d.hi80 - d.lo80).mean(), 2), "90": _r((d.hi90 - d.lo90).mean(), 2)},
        "peaks": {"n": int(peak.sum()), "definition": "y_true >= training q90 (outbreak threshold)",
                  "mae": _r(err[peak].abs().mean()), "bias": _r(err[peak].mean()),
                  "under_share": _r((err[peak] < 0).mean()),
                  "median_pred_over_actual": _r((d["median"][peak] / d.y_true[peak]).median()),
                  "width80_mean": _r((d.hi80 - d.lo80)[peak].mean(), 2)},
        "weeks_ge_20": {"n": int(big.sum()), "under_share": _r((err[big] < 0).mean()), "bias": _r(err[big].mean()),
                        "coverage80": _r(c80[big].mean())},
        "alert": {"recall": _r(tp / max(1, peak.sum())), "precision": _r(tp / max(1, d.alert.sum())),
                  "false_alert_rate": _r((d.alert & ~peak).sum() / max(1, (~peak).sum())), "alerts": int(d.alert.sum())},
    }
    for name, m in (("all", slice(None)), ("zero_weeks", zero), ("positive_below_peak", pos), ("peaks", peak), ("weeks_ge_20", big)):
        sub80, sub90 = (c80[m], c90[m]) if not isinstance(m, slice) else (c80, c90)
        out["coverage"][name] = {"80": _r(sub80.mean()), "90": _r(sub90.mean())}
    return out


def build() -> dict:
    r = pd.read_csv(REPLAY)
    assert int(r.year.max()) <= 2024, "replay must never contain the sealed 2025 holdout"
    r["alert"] = r.alert.astype(str).str.lower().isin(["true", "1"])
    regimes = {}
    for key, years, label in (("out_of_time_2019_2024", range(2019, 2025), "Out-of-time replay: each season predicted by models fitted only on earlier seasons."),
                              ("selection_window_2022_2024", range(2022, 2025), "Validation seasons ALSO used to choose features, model, interval method and alert rule. Not a blind test.")):
        d = r[r.year.isin(list(years))]
        regimes[key] = {"label": label, "seasons": [int(y) for y in years],
                        "by_horizon": {str(h): block(d[d.horizon == h]) for h in (2, 3, 4)},
                        "pooled_all_horizons": block(d)}
    # legacy reconciliation: unweighted mean over season x horizon cells (how the 0.607/0.740 and 74%/-3.21 figures were computed)
    cells = []
    for (y, h), d in r.groupby(["year", "horizon"]):
        b = block(d)
        cells.append({"year": int(y), "horizon": int(h), "cov80_peaks": b["coverage"]["peaks"]["80"], "cov90_peaks": b["coverage"]["peaks"]["90"],
                      "under_share": b["peaks"]["under_share"], "bias": b["peaks"]["bias"], "mae": b["mae"]})
    cm = pd.DataFrame(cells)
    legacy = {"note": "Unweighted mean over the 18 season x horizon cells (2019–2024 x h2–h4). Earlier documents quoted these; pooled figures above weight every week equally.",
              "cov80_peaks": _r(cm.cov80_peaks.mean()), "cov90_peaks": _r(cm.cov90_peaks.mean()),
              "peak_under_share": _r(cm.under_share.mean()), "peak_bias": _r(cm.bias.mean(), 2), "cells": cells}
    by_season = {str(int(y)): {str(h): {"mae": _r(((d["median"] - d.y_true).abs()).mean()), "n": int(len(d))} for h, d in g.groupby("horizon")}
                 for y, g in r.groupby("year")}
    return {"schema": SCHEMA, "source": {"replay": "app_data/replay.csv.gz", "replay_sha256": hashlib.sha256(REPLAY.read_bytes()).hexdigest(),
                                        "rows": int(len(r)), "seasons": sorted(int(y) for y in r.year.unique())},
            "definitions": {"peak": "y_true >= thr_q90 (training-period 90th percentile; the outbreak threshold)",
                            "pooled": "every replay row (ward-week x horizon) weighted equally",
                            "coverage": "share of weeks whose observed count lies inside the central interval",
                            "alert": "deployed rule: P(outbreak) above the tuned threshold; recall/precision against peaks"},
            "regimes": regimes, "blind_test_2025": {"status": "sealed", "evaluated": False,
                                                     "note": "The 2025 organizer holdout has never been read. It is the only blind test and is evaluated once, after a model is frozen."},
            "by_season_mae": by_season, "legacy_cell_mean": legacy}


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, indent=1, sort_keys=False))
    o = data["regimes"]["out_of_time_2019_2024"]["by_horizon"]
    print(f"wrote {OUT.relative_to(ROOT)}; replay sha {data['source']['replay_sha256'][:12]}")
    for h in ("2", "3", "4"):
        b = o[h]
        print(f" h{h}: MAE {b['mae']} cov80 all {b['coverage']['all']['80']} pos {b['coverage']['positive_below_peak']['80']} "
              f"peaks {b['coverage']['peaks']['80']} | peak under {b['peaks']['under_share']} bias {b['peaks']['bias']} | recall {b['alert']['recall']}")
    sys.exit(0)
