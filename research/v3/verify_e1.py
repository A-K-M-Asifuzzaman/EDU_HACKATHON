#!/usr/bin/env python3
"""Independent verification of experiment E1 (research/v3/PREREGISTRATION.md). Read-only: uses the saved out-of-time replay
predictions 2019–2024, never the 2025 holdout, never modifies production artefacts.

    .venv/bin/python research/v3/verify_e1.py      # writes research/v3/results/e1_verification.json

Checks: (1) the saved results reproduce exactly from the experiment code; (2) an independent re-implementation of the NB quantiles
(regularised incomplete beta, not scipy.stats.nbinom.ppf) gives the same calibration choices and metrics; (3) baseline and candidate are
scored on identical rows; (4) calibration rows always precede the evaluated season; plus sample sizes, season-to-season spread, pooled
versus season-mean figures, a ward-cluster bootstrap interval and the audit's per-bin criterion (coverage within 5 points of nominal).
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.special import betainc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("e1e4", HERE / "e1_e4_calibration.py")
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)


def nb_quantile(mu, alpha, q, kmax=400):
    """Smallest k with P(X <= k) >= q for NB(mean mu, dispersion alpha): P(X <= k) = I_p(n, k + 1), n = 1/alpha, p = n / (n + mu)."""
    mu = np.maximum(np.asarray(mu, float), 1e-9); alpha = np.broadcast_to(np.asarray(alpha, float), mu.shape)
    n = 1.0 / alpha; p = n / (n + mu)
    k = np.arange(kmax + 1)[:, None]
    cdf = betainc(n[None, :], k + 1.0, p[None, :])
    return np.argmax(cdf >= q - 1e-12, axis=0).astype(float)


def interval(mu, alpha, level):
    return nb_quantile(mu, alpha, (1 - level) / 2), nb_quantile(mu, alpha, (1 + level) / 2)


def bin_alphas(cal, level):
    out = []
    for a_lo, a_hi in zip(E.BINS[:-1], E.BINS[1:]):
        d = cal[(cal["mean"] >= a_lo) & (cal["mean"] < a_hi)]
        if not len(d):
            out.append(float(E.GRID[0])); continue
        pick = float(E.GRID[-1])
        for a in E.GRID:
            lo, hi = interval(d["mean"].values, a, level)
            if np.mean((d.y_true.values >= lo) & (d.y_true.values <= hi)) >= level:
                pick = float(a); break
        out.append(pick)
    return out


def main():
    r = pd.read_csv(ROOT / "app_data" / "replay.csv.gz")
    assert int(r.year.max()) <= 2024 and (pd.to_datetime(r.target_date).dt.year == r.year).all()
    saved = json.loads((HERE / "results" / "e1_intervals.json").read_text())
    rerun1, rerun2 = E.e1(r), E.e1(r)
    rep = {"replay_sha256": hashlib.sha256((ROOT / "app_data" / "replay.csv.gz").read_bytes()).hexdigest(),
           "reproduces_saved_results_exactly": json.loads(json.dumps(rerun1)) == saved, "deterministic_across_runs": rerun1 == rerun2,
           "by_horizon": {}}
    rng = np.random.default_rng(20261125)
    for h in (2, 3, 4):
        rh = r[r.horizon == h]
        seasons, rows = [], []
        for Y in E.SEASONS:
            cal, ev = rh[rh.year.isin([Y - 2, Y - 1])], rh[rh.year == Y]
            assert pd.to_datetime(cal.target_date).max() < pd.to_datetime(ev.origin_date).min()          # every calibration outcome precedes the season
            al = bin_alphas(cal, 0.8)
            lo_c, hi_c = interval(ev["mean"].values, np.asarray(al)[np.clip(np.searchsorted(E.BINS, ev["mean"].values, side="right") - 1, 0, 4)], 0.8)
            s80 = next(s for s in saved["by_horizon"][str(h)]["seasons"] if s["season"] == Y)["80"]
            peak = (ev.y_true >= ev.thr_q90).values
            bins = np.clip(np.searchsorted(E.BINS, ev["mean"].values, side="right") - 1, 0, 4)
            cbins = np.clip(np.searchsorted(E.BINS, cal["mean"].values, side="right") - 1, 0, 4)
            y = ev.y_true.values
            cov_c, cov_b = (y >= lo_c) & (y <= hi_c), (y >= ev.lo80.values) & (y <= ev.hi80.values)
            seasons.append({"season": Y, "used_for_original_selection": Y >= 2022,
                            "alphas_match_saved": [round(a, 4) for a in al] == s80["alphas_by_bin"],
                            "independent_peak80": {"baseline": round(float(cov_b[peak].mean()), 3), "candidate": round(float(cov_c[peak].mean()), 3)},
                            "saved_peak80": {"baseline": s80["baseline"]["peaks"], "candidate": s80["candidate"]["peaks"]},
                            "independent_interval_score": {"baseline": round(E.winkler(y, ev.lo80.values, ev.hi80.values, 0.8), 3), "candidate": round(E.winkler(y, lo_c, hi_c, 0.8), 3)},
                            "n_eval_rows": int(len(ev)), "n_eval_peak_weeks": int(peak.sum()), "n_eval_positive_weeks": int((y > 0).sum()),
                            "n_calibration_rows_by_bin": [int((cbins == b).sum()) for b in range(5)],
                            "n_calibration_peaks_by_bin": [int(((cbins == b) & (cal.y_true >= cal.thr_q90).values).sum()) for b in range(5)],
                            "candidate_80_coverage_by_mu_bin": [round(float(cov_c[bins == b].mean()), 3) if (bins == b).any() else None for b in range(5)],
                            "baseline_80_coverage_by_mu_bin": [round(float(cov_b[bins == b].mean()), 3) if (bins == b).any() else None for b in range(5)],
                            "n_eval_rows_by_mu_bin": [int((bins == b).sum()) for b in range(5)]})
            rows.append(pd.DataFrame({"ward": ev.ward_id.values, "season": Y, "peak": peak, "pos": y > 0, "cb": cov_b, "cc": cov_c,
                                      "wb": ev.hi80.values - ev.lo80.values, "wc": hi_c - lo_c}))
        d = pd.concat(rows)
        pk = d[d.peak]
        # ward-cluster bootstrap of the pooled peak-coverage gain (wards resampled with replacement, all their peak weeks kept)
        wards = pk.ward.unique(); g = pk.groupby("ward")[["cb", "cc"]].agg(["sum", "count"])
        diffs = []
        for _ in range(2000):
            s = g.loc[rng.choice(wards, len(wards))]
            diffs.append(s[("cc", "sum")].sum() / s[("cc", "count")].sum() - s[("cb", "sum")].sum() / s[("cb", "count")].sum())
        sm = lambda k: [x[k] for x in seasons]
        rep["by_horizon"][str(h)] = {
            "seasons": seasons,
            "peak80_season_mean": {"baseline": round(float(np.mean([s["saved_peak80"]["baseline"] for s in seasons])), 3), "candidate": round(float(np.mean([s["saved_peak80"]["candidate"] for s in seasons])), 3)},
            "peak80_pooled_rows_2021_2024": {"baseline": round(float(pk.cb.mean()), 3), "candidate": round(float(pk.cc.mean()), 3), "n_peak_weeks": int(len(pk))},
            "peak80_gain_by_season": [round(s["saved_peak80"]["candidate"] - s["saved_peak80"]["baseline"], 3) for s in seasons],
            "peak80_gain_pooled_ward_bootstrap_95ci": [round(float(np.quantile(diffs, 0.025)), 3), round(float(np.quantile(diffs, 0.975)), 3)],
            "positive80_pooled": {"baseline": round(float(d[d.pos].cb.mean()), 3), "candidate": round(float(d[d.pos].cc.mean()), 3)},
            "all80_pooled": {"baseline": round(float(d.cb.mean()), 3), "candidate": round(float(d.cc.mean()), 3)},
            "width80_pooled": {"baseline": round(float(d.wb.mean()), 2), "candidate": round(float(d.wc.mean()), 2)},
            "independent_matches_saved": all(s["alphas_match_saved"] and s["independent_peak80"] == s["saved_peak80"] for s in seasons),
            "audit_rule_per_bin_within_5pts": all(c is None or abs(c - 0.8) <= 0.05 for s in seasons for c in s["candidate_80_coverage_by_mu_bin"]),
        }
    (HERE / "results" / "e1_verification.json").write_text(json.dumps(rep, indent=1))
    print("reproduces saved:", rep["reproduces_saved_results_exactly"], "| deterministic:", rep["deterministic_across_runs"])
    for h, x in rep["by_horizon"].items():
        print(f"h{h}: independent==saved {x['independent_matches_saved']} | peak80 season-mean {x['peak80_season_mean']} | pooled {x['peak80_pooled_rows_2021_2024']}"
              f" | gain by season {x['peak80_gain_by_season']} | bootstrap 95% {x['peak80_gain_pooled_ward_bootstrap_95ci']}")
        print(f"     positive {x['positive80_pooled']} all {x['all80_pooled']} width {x['width80_pooled']} | audit per-bin rule {x['audit_rule_per_bin_within_5pts']}")
        for s in x["seasons"]:
            print(f"     {s['season']}: cal n/bin {s['n_calibration_rows_by_bin']} cal peaks/bin {s['n_calibration_peaks_by_bin']} | eval peaks {s['n_eval_peak_weeks']}"
                  f" | cand cov/bin {s['candidate_80_coverage_by_mu_bin']} | IS {s['independent_interval_score']}")


if __name__ == "__main__":
    main()
