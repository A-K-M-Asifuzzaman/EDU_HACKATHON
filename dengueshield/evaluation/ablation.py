"""Feature-family ablation tournament on the chronological validation folds (2022-2024). 2025 is never touched."""
from __future__ import annotations

import hashlib
import resource
import time
from pathlib import Path

import numpy as np
import pandas as pd

from dengueshield import metrics
from dengueshield.data import ROOT
from dengueshield.evaluation.folds import dev_folds, fold_data
from dengueshield.evaluation.models import fit_predict, poisson_median

CACHE = ROOT / ".cache" / "features"
STAGE1_COLS = ["case_log_last", "case_log_mean4", "rain_lag0", "rain_lag1", "rain_lag2", "rain_lag3", "rh_lag0", "rh_lag1",
               "temp_mean4", "pop_density", "waterlogging", "sanitation",
               "cal_tgt_sin1", "cal_tgt_cos1", "cal_tgt_sin2", "cal_tgt_cos2"]
FAMILIES = ["calendar", "static", "rain_lag", "rain_roll", "rain_align", "temp", "humidity", "climate_int", "breeding",
            "vuln", "case", "hist", "zero_infl"]


# Exact algebraic copies (verified by dengueshield.evaluation.quality.duplicates): sum/n; vuln_wl_x_ewm3 = breed_no_temp;
# breed_rain_only = rain_ewm3; breed_no_wl = int_ewm3_x_temp.
ALGEBRAIC_DUPLICATES = [f"rain_mean{n}" for n in (2, 3, 4, 6, 8)] + ["vuln_wl_x_ewm3", "breed_rain_only", "breed_no_wl"]


def library(manifest: pd.DataFrame, duplicates=ALGEBRAIC_DUPLICATES) -> dict:
    """Name lists by family/subfamily. `duplicates` are excluded from families and the combined set; the breeding
    sub-families keep every variant because they are component-test controls."""
    m = manifest[~manifest.feature.isin(duplicates)]
    fam = {f: list(m.feature[m.family == f]) for f in FAMILIES}
    sub = {}
    for r in manifest.itertuples():
        sub.setdefault((r.family, r.subfamily), []).append(r.feature)
    return {"fam": fam, "sub": sub, "all": list(m.feature)}


def configs(lib: dict) -> dict:
    """Ordered {name: columns}. F0-F7 are the requested families; the rest are incremental and removal ablations."""
    f, s, base = lib["fam"], lib["sub"], lib["fam"]["calendar"] + lib["fam"]["static"]
    rain_obs = f["rain_lag"] + f["rain_roll"]
    out = {"F0_stage1_features": STAGE1_COLS, "F1_calendar_static": base,
           "F2_rain_memory": base + rain_obs, "F3_aligned_rain": base + f["rain_align"],
           "F4_climate_interactions": base + f["temp"] + f["humidity"] + f["climate_int"] + f["breeding"] + f["vuln"],
           "F5_case_history": base + f["case"], "F6_hist_seasonal": base + f["hist"], "F7_combined": lib["all"]}
    for fam in ["rain_lag", "rain_roll", "temp", "humidity", "climate_int", "breeding", "vuln", "zero_infl"]:
        out[f"inc_{fam}"] = base + f[fam]
    out["inc_temp_no_maxmin"] = base + [c for c in f["temp"] if c not in s.get(("temp", "maxmin"), [])]
    out["inc_maxmin_only"] = base + s.get(("temp", "maxmin"), [])
    for fam in FAMILIES:
        out[f"rm_{fam}"] = [c for c in lib["all"] if c not in f[fam]]
    w = base + rain_obs
    for b in [k[1] for k in s if k[0] == "breeding"]:
        out[f"breed_{b}"] = w + s[("breeding", b)]
    unc = {"rain_win_nobs", "rain_clim_sd_tl3"} | {c for c in f["rain_align"] if c.endswith("_obs")}
    out["F3_no_uncertainty_flags"] = base + [c for c in f["rain_align"] if c not in unc]
    return out


def _key(name, cols, model, conv, rain_est, tag):
    return hashlib.md5(repr((name, tuple(cols), model, conv, rain_est, tag)).encode()).hexdigest()[:16]


def run_config(panel, name, cols, model, conv="A_end_of_week", rain_est="regime", horizons=(2, 3, 4), keep_preds=False, tag="v2"):
    """9 fits (3 folds x 3 horizons). Returns (rows, preds|None). Results are cached on (config, columns, model, convention)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{_key(name, cols, model, conv, rain_est, tag)}_{int(keep_preds)}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    rows, preds = [], []
    for fold in dev_folds():
        for h in horizons:
            fd = fold_data(panel, conv, fold, h, rain_est)
            Xtr, ytr, Xev, yev, mev = fd.xy(list(cols))
            thr = metrics.thresholds(ytr)
            yrs = fd.meta.origin_date[fd.train.to_numpy()].dt.year.to_numpy()
            m, mu, tm = fit_predict(model, Xtr, ytr, Xev, years=yrs)
            for kind, p in (("mean", mu), ("median", poisson_median(mu))):
                rows.append({"config": name, "model": model, "kind": kind, "conv": conv, "fold": fold.name, "horizon": h,
                             "n_features": len(cols), "n_train": len(ytr), "n_eval": len(yev), **tm, "alpha": getattr(m, "alpha_", np.nan),
                             "build_s": fd.build_seconds, **metrics.flatten(metrics.evaluate(yev, p, thr))})
                if keep_preds:
                    preds.append(mev.assign(config=name, model=model, kind=kind, conv=conv, fold=fold.name, y_pred=p))
    out = (pd.DataFrame(rows), pd.concat(preds, ignore_index=True) if keep_preds else None)
    pd.to_pickle(out, path)
    return out


def tournament(panel, cfgs: dict, models=("glm", "lgbm"), conv="A_end_of_week", rain_est="regime", keep=(), log=print):
    rows, preds = [], []
    for name, cols in cfgs.items():
        for model in models:
            t = time.perf_counter()
            r, p = run_config(panel, name, cols, model, conv, rain_est, keep_preds=name in keep)
            rows.append(r)
            if p is not None:
                preds.append(p)
            log(f"{conv} {name:34s} {model:5s} {time.perf_counter() - t:5.1f}s  MAE(median) "
                f"{r[r.kind == 'median'].all_mae.mean():.4f}")
    return pd.concat(rows, ignore_index=True), (pd.concat(preds, ignore_index=True) if preds else None)


def leaderboard(res: pd.DataFrame, kind="median") -> pd.DataFrame:
    """Mean over folds per horizon, plus the 3-horizon average and fold-to-fold SD of the average MAE."""
    r = res[res.kind == kind]
    h = r.groupby(["config", "model", "horizon"]).all_mae.mean().unstack("horizon").add_prefix("mae_h")
    per_fold = r.groupby(["config", "model", "fold"]).all_mae.mean().unstack("fold")
    out = h.copy()
    out["mae_avg"] = h.mean(axis=1)
    out["fold_sd"] = per_fold.std(axis=1)
    for c, n in (("all_rmse", "rmse"), ("high_mae", "high_mae"), ("high_bias", "high_bias"), ("all_bias", "bias"),
                 ("all_under_rate", "under_rate"), ("outbreak_recall", "recall"), ("outbreak_precision", "precision"),
                 ("predict_s", "predict_s"), ("fit_s", "fit_s"), ("n_features", "n_features")):
        out[n] = r.groupby(["config", "model"])[c].mean()
    for fold in per_fold.columns:
        out[f"mae_{fold}"] = per_fold[fold]
    return out.reset_index()


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6  # macOS reports bytes


def forward_configs(lib: dict) -> dict:
    """Family-level forward step over the best single family: F3 base + one other family at a time."""
    f = lib["fam"]
    base = f["calendar"] + f["static"] + f["rain_align"]
    return {f"F3plus_{fam}": base + f[fam] for fam in ["rain_lag", "rain_roll", "temp", "humidity", "climate_int",
                                                      "breeding", "vuln", "case", "hist", "zero_infl"]}


def decision_rule(res: pd.DataFrame, base: str, cand: pd.DataFrame, min_gain: float = 0.01) -> pd.DataFrame:
    """Pre-registered rule: keep a family if, for BOTH models, mean (3 horizons x 3 folds) MAE improves by >= min_gain
    and improves in at least 2 of the 3 validation folds. Evaluated on Poisson-median MAE."""
    r = res[res.kind == "median"]
    rows = []
    for name in cand:
        rec = {"config": name}
        ok = True
        for model in ("glm", "lgbm"):
            b = r[(r.config == base) & (r.model == model)].groupby("fold").all_mae.mean()
            x = r[(r.config == name) & (r.model == model)].groupby("fold").all_mae.mean()
            d = (b - x)
            rec[f"{model}_gain"] = d.mean()
            rec[f"{model}_folds_improved"] = int((d > 0).sum())
            ok &= d.mean() >= min_gain and (d > 0).sum() >= 2
        rec["keep"] = bool(ok)
        rows.append(rec)
    return pd.DataFrame(rows)
