#!/usr/bin/env python3
"""V3 experiments E1 (magnitude-dependent intervals) and E4 (outbreak-probability calibration), as pre-registered in
research/v3/PREREGISTRATION.md. Uses only saved out-of-time replay predictions (2019–2024); never reads the 2025 holdout;
never modifies production artefacts.

    python research/v3/e1_e4_calibration.py      # writes research/v3/results/e1_intervals.json, e4_alert.json
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import nbinom
from sklearn.isotonic import IsotonicRegression

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "results"
SEASONS = [2021, 2022, 2023, 2024]
BINS = [0, 0.5, 2, 5, 10, np.inf]
GRID = np.concatenate([[1e-3], np.logspace(-2.5, 1, 60)])


def nb_interval(mu, alpha, level):
    mu = np.maximum(np.asarray(mu, float), 1e-9)
    n = 1.0 / alpha
    p = n / (n + mu)
    return nbinom.ppf((1 - level) / 2, n, p), nbinom.ppf((1 + level) / 2, n, p)


def coverage(y, lo, hi):
    return float(np.mean((y >= lo) & (y <= hi))) if len(y) else float("nan")


def winkler(y, lo, hi, level):
    a = 1 - level
    w = hi - lo
    return float(np.mean(w + (2 / a) * (lo - y) * (y < lo) + (2 / a) * (y - hi) * (y > hi)))


def fit_bin_alphas(cal: pd.DataFrame, level: float) -> list[float]:
    """Smallest alpha per mu-bin whose NB central interval reaches the nominal coverage on the calibration rows."""
    alphas = []
    for lo_b, hi_b in zip(BINS[:-1], BINS[1:]):
        d = cal[(cal["mean"] >= lo_b) & (cal["mean"] < hi_b)]
        chosen = GRID[-1]
        if len(d) == 0:
            chosen = GRID[0]
        else:
            for a in GRID:
                lo, hi = nb_interval(d["mean"], a, level)
                if coverage(d.y_true.values, lo, hi) >= level:
                    chosen = a
                    break
        alphas.append(float(chosen))
    return alphas


def mondrian_interval(d: pd.DataFrame, alphas: list[float], level: float):
    idx = np.clip(np.searchsorted(BINS, d["mean"].values, side="right") - 1, 0, len(alphas) - 1)
    a = np.asarray(alphas)[idx]
    return nb_interval(d["mean"].values, a, level)


def masks(d):
    peak = d.y_true >= d.thr_q90
    return {"all": np.ones(len(d), bool), "zero_weeks": (d.y_true == 0).values, "positive_below_peak": ((d.y_true > 0) & ~peak).values,
            "peaks": peak.values, "weeks_ge_20": (d.y_true >= 20).values}


def e1(r: pd.DataFrame) -> dict:
    res = {"protocol": "PREREGISTRATION.md E1", "bins_mu": [str(b) for b in BINS], "seasons": SEASONS, "by_horizon": {}}
    for h in (2, 3, 4):
        rh = r[r.horizon == h]
        seasons, passes = [], 0
        for Y in SEASONS:
            cal, ev = rh[rh.year.isin([Y - 2, Y - 1])], rh[rh.year == Y]
            row = {"season": Y, "used_for_original_selection": Y >= 2022}
            for level, key in ((0.8, "80"), (0.9, "90")):
                al = fit_bin_alphas(cal, level)
                lo_c, hi_c = mondrian_interval(ev, al, level)
                lo_b, hi_b = (ev.lo80.values, ev.hi80.values) if key == "80" else (ev.lo90.values, ev.hi90.values)
                y = ev.y_true.values
                m = masks(ev)
                row[key] = {"alphas_by_bin": [round(a, 4) for a in al],
                            "baseline": {k: round(coverage(y[v], lo_b[v], hi_b[v]), 3) for k, v in m.items()} | {"width": round(float(np.mean(hi_b - lo_b)), 2), "interval_score": round(winkler(y, lo_b, hi_b, level), 3)},
                            "candidate": {k: round(coverage(y[v], lo_c[v], hi_c[v]), 3) for k, v in m.items()} | {"width": round(float(np.mean(hi_c - lo_c)), 2), "interval_score": round(winkler(y, lo_c, hi_c, level), 3)}}
            b, c = row["80"]["baseline"], row["80"]["candidate"]
            ok = (c["peaks"] - b["peaks"] >= 0.05) and (c["positive_below_peak"] >= 0.75) and (c["interval_score"] <= b["interval_score"])
            row["passes_rule"] = bool(ok)
            passes += ok
            seasons.append(row)
        res["by_horizon"][str(h)] = {"seasons": seasons, "seasons_passing": passes, "verdict": "PASS" if passes >= 3 else "FAIL",
                                     "rule": "peak80 +0.05, positive80 >= 0.75, interval score not worse, in >= 3 of 4 seasons"}
    return res


def ece(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    return float(sum(abs(p[idx == b].mean() - y[idx == b].mean()) * (idx == b).mean() for b in range(bins) if (idx == b).any()))


def e4(r: pd.DataFrame) -> dict:
    res = {"protocol": "PREREGISTRATION.md E4", "seasons": SEASONS, "by_horizon": {}}
    r = r.assign(peak=(r.y_true >= r.thr_q90).astype(int), alert=r.alert.astype(str).str.lower().isin(["true", "1"]))
    for h in (2, 3, 4):
        rh = r[r.horizon == h]
        seasons, brier_wins, pooled = [], 0, {"base_tp": 0, "base_fp": 0, "cand_tp": 0, "cand_fp": 0, "pos": 0, "neg": 0}
        for Y in SEASONS:
            cal, ev = rh[rh.year.isin([Y - 2, Y - 1])], rh[rh.year == Y]
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(cal.p_outbreak, cal.peak)
            pc, pe, y = iso.predict(cal.p_outbreak), iso.predict(ev.p_outbreak), ev.peak.values
            target_far = float(((cal.alert) & (cal.peak == 0)).sum() / max(1, (cal.peak == 0).sum()))
            thr = float(np.quantile(pc[cal.peak.values == 0], 1 - target_far)) if target_far > 0 else 1.0
            cand_alert = pe > thr
            b_brier, c_brier = float(np.mean((ev.p_outbreak - y) ** 2)), float(np.mean((pe - y) ** 2))
            brier_wins += c_brier < b_brier
            for k, a in (("base", ev.alert.values), ("cand", cand_alert)):
                pooled[f"{k}_tp"] += int((a & (y == 1)).sum()); pooled[f"{k}_fp"] += int((a & (y == 0)).sum())
            pooled["pos"] += int((y == 1).sum()); pooled["neg"] += int((y == 0).sum())
            seasons.append({"season": Y, "brier_base": round(b_brier, 4), "brier_cand": round(c_brier, 4), "ece_base": round(ece(ev.p_outbreak.values, y), 4),
                            "ece_cand": round(ece(pe, y), 4), "recall_base": round(float((ev.alert.values & (y == 1)).sum() / max(1, (y == 1).sum())), 3),
                            "recall_cand": round(float((cand_alert & (y == 1)).sum() / max(1, (y == 1).sum())), 3),
                            "far_base": round(float((ev.alert.values & (y == 0)).sum() / max(1, (y == 0).sum())), 4),
                            "far_cand": round(float((cand_alert & (y == 0)).sum() / max(1, (y == 0).sum())), 4)})
        rec_b, rec_c = pooled["base_tp"] / max(1, pooled["pos"]), pooled["cand_tp"] / max(1, pooled["pos"])
        far_b, far_c = pooled["base_fp"] / max(1, pooled["neg"]), pooled["cand_fp"] / max(1, pooled["neg"])
        ok = brier_wins >= 3 and rec_c >= rec_b and abs(far_c - far_b) <= 0.01
        res["by_horizon"][str(h)] = {"seasons": seasons, "brier_wins": int(brier_wins), "pooled": {"recall_base": round(rec_b, 3), "recall_cand": round(rec_c, 3),
                                     "far_base": round(far_b, 4), "far_cand": round(far_c, 4)}, "verdict": "PASS" if ok else "FAIL",
                                     "rule": "Brier lower in >= 3 of 4 seasons AND pooled recall not lower at FAR within +/-0.01"}
    return res


if __name__ == "__main__":
    r = pd.read_csv(ROOT / "app_data" / "replay.csv.gz")
    assert int(r.year.max()) <= 2024
    OUT.mkdir(parents=True, exist_ok=True)
    a, b = e1(r), e4(r)
    (OUT / "e1_intervals.json").write_text(json.dumps(a, indent=1))
    (OUT / "e4_alert.json").write_text(json.dumps(b, indent=1))
    for h in ("2", "3", "4"):
        x = a["by_horizon"][h]
        cov = [(s["season"], s["80"]["baseline"]["peaks"], s["80"]["candidate"]["peaks"], s["80"]["baseline"]["positive_below_peak"], s["80"]["candidate"]["positive_below_peak"],
                s["80"]["baseline"]["interval_score"], s["80"]["candidate"]["interval_score"], s["80"]["baseline"]["width"], s["80"]["candidate"]["width"]) for s in x["seasons"]]
        print(f"E1 h{h}: {x['verdict']} ({x['seasons_passing']}/4)  (season, peak80 base->cand, pos80 base->cand, IS base->cand, width base->cand)")
        for c in cov: print("    ", c)
        y = b["by_horizon"][h]
        print(f"E4 h{h}: {y['verdict']} brier wins {y['brier_wins']}/4 pooled {y['pooled']}")
