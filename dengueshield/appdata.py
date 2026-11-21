"""Precomputed application artifacts (app_data/). Development years 2016-2024 only; 2025 is never read.

    python -m dengueshield.appdata        # rebuilds everything the API serves; ~1 minute, no model training beyond cached fits
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import nbinom, poisson
from sklearn.feature_selection import mutual_info_regression

from dengueshield.calibration import intervals as I
from dengueshield.calibration import peaks as PK
from dengueshield.calibration.risk import TIERS, tier_index
from dengueshield.data import ROOT, load_development_panel
from dengueshield.models import seasons as S

OUT = ROOT / "app_data"
REP = ROOT / "reports"
NUM = ["population_density_sqkm", "water_logging_risk_index", "sanitation_score", "avg_temp_c", "max_temp_c", "min_temp_c",
       "rainfall_mm", "relative_humidity_pct", "dengue_cases"]


def _clean(o):
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 6)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp,)):
        return str(o.date())
    return o


def dump(name: str, obj) -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(_clean(obj), separators=(",", ":")))


def csv_records(path: Path, **kw) -> list:
    return _clean(pd.read_csv(path, **kw).replace({np.nan: None}).to_dict("records"))


# ------------------------------------------------------------------ data profile
def build_profile(df: pd.DataFrame) -> dict:
    cols = []
    for c in df.columns:
        s = df[c]
        cols.append({"name": c, "dtype": str(s.dtype), "kind": "numeric" if c in NUM else ("datetime" if c == "date" else "categorical"),
                     "missing": int(s.isna().sum()), "missing_pct": float(s.isna().mean() * 100), "unique": int(s.nunique())})
    desc = {}
    for c in NUM:
        s = df[c].astype(float)
        q = s.quantile([0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])
        desc[c] = {"mean": s.mean(), "median": s.median(), "std": s.std(), "min": s.min(), "max": s.max(),
                   "p01": q[0.01], "p05": q[0.05], "p25": q[0.25], "p50": q[0.5], "p75": q[0.75], "p95": q[0.95], "p99": q[0.99],
                   "skew": stats.skew(s), "kurtosis": stats.kurtosis(s), "zeros_pct": float((s == 0).mean() * 100)}
    y = df.dengue_cases
    comp = df.assign(year=df.date.dt.year).groupby("year")[list(df.columns)].agg(lambda s: 100 * (1 - s.isna().mean()))
    return {"rows": len(df), "columns": df.shape[1], "date_min": df.date.min(), "date_max": df.date.max(), "weeks": int(df.date.nunique()),
            "wards": int(df.ward_id.nunique()), "cities": df.groupby("city").ward_id.nunique().to_dict(),
            "duplicate_rows": int(df.duplicated().sum()), "duplicate_ward_week": int(df.duplicated(["ward_id", "date"]).sum()),
            "schema": cols, "describe": desc,
            "target": {"zero_share": float((y == 0).mean()), "mean": y.mean(), "variance": y.var(), "dispersion_index": y.var() / y.mean(),
                       "max": int(y.max()), "total": int(y.sum())},
            "completeness_by_year": {str(k): {c: round(float(v), 2) for c, v in r.items()} for k, r in comp.iterrows()},
            "holdout_note": "Rows dated 2025 are withheld from every analysis in this application (locked final test).",
            "source": "organizer dataset, development years 2016-2024"}


def build_distributions(df: pd.DataFrame) -> dict:
    out = {"histograms": {}, "boxplots": {}, "cases_pmf": {}, "zero_by_month": {}, "outliers": {}}
    for c in NUM:
        s = df[c].astype(float)
        cnt, edges = np.histogram(s, bins=30 if c != "dengue_cases" else int(s.max()) + 1, range=None if c != "dengue_cases" else (-0.5, s.max() + 0.5))
        out["histograms"][c] = {"edges": edges, "counts": cnt}
        q1, med, q3 = s.quantile([0.25, 0.5, 0.75])
        iqr = q3 - q1
        lo, hi = s[s >= q1 - 1.5 * iqr].min(), s[s <= q3 + 1.5 * iqr].max()
        out["boxplots"][c] = {"min": lo, "q1": q1, "median": med, "q3": q3, "max": hi, "n_outliers": int(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum()),
                              "outlier_pct": float(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).mean() * 100)}
    vc = df.dengue_cases.value_counts().sort_index()
    out["cases_pmf"] = {"values": vc.index.tolist(), "counts": vc.tolist()}
    zm = df.assign(month=df.date.dt.month).groupby("month").dengue_cases.agg(zero_share=lambda s: (s == 0).mean(), mean="mean")
    out["zero_by_month"] = zm.reset_index().to_dict("records")
    byc = df.groupby("city").dengue_cases.describe()[["count", "mean", "std", "min", "50%", "max"]].reset_index().to_dict("records")
    out["by_city"] = byc
    out["note"] = "Outliers use the 1.5 x IQR rule on the pooled series; the weekly-rain tail is a monsoon feature of this synthetic dataset, not an error."
    return out


def build_correlations(df: pd.DataFrame) -> dict:
    d = df.sort_values(["ward_id", "date"]).copy()
    d["rain_lag3"] = d.groupby("ward_id").rainfall_mm.shift(3)
    d["humidity_lag2"] = d.groupby("ward_id").relative_humidity_pct.shift(2)
    d["month"] = d.date.dt.month
    cols = NUM + ["rain_lag3", "humidity_lag2"]
    pear = d[cols].corr(method="pearson")
    spear = d[cols].corr(method="spearman")
    feats = [c for c in cols if c != "dengue_cases"] + ["month"]
    dd = d.dropna(subset=["rain_lag3", "humidity_lag2"]).sample(8000, random_state=2026)
    mi = mutual_info_regression(dd[feats].to_numpy(float), dd.dengue_cases.to_numpy(float), n_neighbors=5, random_state=2026)
    redundancy = [{"a": "max_temp_c", "b": "avg_temp_c", "corr": float(d.max_temp_c.corr(d.avg_temp_c))},
                  {"a": "min_temp_c", "b": "avg_temp_c", "corr": float(d.min_temp_c.corr(d.avg_temp_c))},
                  {"a": "max_temp_c", "b": "min_temp_c", "corr": float(d.max_temp_c.corr(d.min_temp_c))}]
    return {"columns": cols, "pearson": pear.to_numpy(), "spearman": spear.to_numpy(),
            "mutual_information": [{"feature": f, "mi": float(m)} for f, m in sorted(zip(feats, mi), key=lambda x: -x[1])],
            "mi_method": "sklearn mutual_info_regression (k-NN estimator, k=5), 8,000-row random sample, seed 2026; raw (unadjusted) dependence, inflated by shared seasonality",
            "redundancy": redundancy,
            "temperature_note": "max/min temperature are highly redundant with average temperature (R2 about 0.94-0.95) but are not exact copies."}


def build_seasonality(df: pd.DataFrame) -> dict:
    d = df.assign(year=df.date.dt.year, month=df.date.dt.month, woy=df.date.dt.isocalendar().week.astype(int).clip(upper=52))
    nat = d.groupby(["year", "woy"])[["dengue_cases", "rainfall_mm", "avg_temp_c", "relative_humidity_pct"]].mean().reset_index()
    weekly = {str(y): {"woy": g.woy.tolist(), "cases": g.dengue_cases.round(3).tolist(), "rain": g.rainfall_mm.round(2).tolist()} for y, g in nat.groupby("year")}
    month = d.groupby("month")[["dengue_cases", "rainfall_mm", "avg_temp_c", "relative_humidity_pct"]].mean().round(3).reset_index().to_dict("records")
    cm = d.groupby(["city", "month"]).dengue_cases.mean().round(3).unstack("city")
    yearly = d.groupby("year").agg(total=("dengue_cases", "sum"), mean=("dengue_cases", "mean"), p90=("dengue_cases", lambda s: s.quantile(0.9)),
                                   rain=("rainfall_mm", "mean"), zero_share=("dengue_cases", lambda s: (s == 0).mean())).round(4).reset_index().to_dict("records")
    ward = d.groupby(["ward_id", "city"]).agg(mean_cases=("dengue_cases", "mean"), total=("dengue_cases", "sum"), p90=("dengue_cases", lambda s: s.quantile(0.9)),
                                              max=("dengue_cases", "max")).round(3).reset_index().to_dict("records")
    rain_cal = d.groupby(["year", "woy"]).rainfall_mm.mean().round(1).unstack("woy")
    anomaly = (nat.assign(clim=nat.groupby("woy").dengue_cases.transform("mean")).assign(anom=lambda x: x.dengue_cases - x.clim)
               .groupby("year").anom.agg(["mean", "max", "min"]).round(3).reset_index().to_dict("records"))
    return {"weekly_by_year": weekly, "monthly": month, "city_month": {"months": cm.index.tolist(), **{c: cm[c].tolist() for c in cm.columns}},
            "yearly": yearly, "wards": ward, "rain_calendar": {"years": rain_cal.index.tolist(), "weeks": rain_cal.columns.tolist(), "values": rain_cal.to_numpy()},
            "anomaly_by_year": anomaly, "monsoon": csv_records(REP / "eda/tables/monsoon_season_by_year.csv")}


def build_lag() -> dict:
    t = REP / "eda/tables"
    return {"cross_correlation": csv_records(t / "cross_correlation_lags_0_8.csv"), "adjusted_glm": csv_records(t / "adjusted_glm_lag_coefficients.csv"),
            "acf": csv_records(t / "acf.csv", nrows=53), "extreme_weather": csv_records(t / "extreme_weather_response.csv"),
            "note": "Computed on 2016-2021 (Stage 1 analysis window). Associations in a synthetic dataset; the adjusted model uses month fixed effects. Not causal."}


# ------------------------------------------------------------------ validation evidence
def build_validation() -> dict:
    mt, ft = REP / "model_tournament", REP / "features"
    champ = json.loads((mt / "champion.json").read_text())
    lb = pd.read_csv(mt / "leaderboard_all.csv")
    keep = ["model", "fs", "tag", "convention", "years", "mae_h2", "mae_h3", "mae_h4", "mae_avg", "year_sd", "rmse", "mae_mean", "rmse_mean", "high_mae",
            "high_bias", "high_under", "recall", "precision", "false_alert_rate", "fit_s"]
    lb = lb[keep].replace({np.nan: None})
    sc = pd.read_csv(mt / "scores_all_cells.csv")
    champ_cells = sc[(sc.model == "glm_poisson") & (sc.fs == "F8") & (sc.tag.isna()) & (sc.conv.isin(["B", "A"]))]
    cells = champ_cells[["conv", "year", "horizon", "mae", "rmse", "mae_mean", "rmse_mean", "high_mae", "high_bias", "recall", "precision", "false_alert_rate", "bias"]]
    out = {"champion": champ, "leaderboard": lb.to_dict("records"),
           "champion_by_season": cells.to_dict("records"),
           "stage2_vs_stage3": csv_records(mt / "stage2_vs_stage3.csv"), "convention_comparison": csv_records(mt / "convention_comparison_outer.csv"),
           "interval_coverage": csv_records(mt / "interval_coverage_summary_B.csv"),
           "interval_coverage_detail": csv_records(mt / "interval_coverage_B.csv"),
           "peak_methods": csv_records(mt / "peak_methods_summary.csv"), "risk_schemes": csv_records(mt / "risk_tier_schemes.csv"),
           "optuna": csv_records(mt / "optuna_summary.csv"), "paired_vs_glm": csv_records(mt / "paired_all_vs_glm_B_bench.csv"),
           "permutation_groups": csv_records(mt / "permutation_importance_groups_B.csv"),
           "permutation_joint": csv_records(mt / "permutation_importance_joint_champion_B.csv"),
           "glm_coefficients": csv_records(mt / "champion_glm_standardised_coefficients_h3.csv", names=["feature", "coef"], header=0),
           "stage1_vs_stage2": csv_records(ft / "tables/stage1_vs_stage2.csv"),
           "feature_leaderboard": csv_records(ft / "leaderboard_full.csv"),
           "ablation_family": csv_records(ft / "tables/ablation_family_deltas.csv"),
           "forward_step": csv_records(ft / "forward_step_decision.csv"),
           "top_features": csv_records(ft / "tables/top20_features.csv"),
           "f8_features": csv_records(ft / "selection/F8_features.csv"),
           "availability": csv_records(ft / "tables/availability_class_counts.csv"),
           "error_by_city": csv_records(ft / "tables/error_by_city.csv"),
           "limits": {"seasons_outer": [2019, 2020, 2021, 2022, 2023, 2024], "benchmark": [2022, 2023, 2024],
                      "paired_ci_note": "With 3-6 seasons, season-level intervals are wide and fragile; differences below 0.05 MAE are tentative."}}
    return out


# ------------------------------------------------------------------ out-of-time replay table (champion, convention B)
def build_replay(panel: pd.DataFrame, champion: dict) -> pd.DataFrame:
    fs = S.feature_sets(panel)
    rows = []
    for h in (2, 3, 4):
        c = champion["per_horizon"][str(h)]
        preds = pd.concat([S.predict_season(panel, "B", c["fs"], fs[c["fs"]], c["model"], c["params"], h, yr) for yr in S.SEASONS], ignore_index=True)
        for yr in S.OUTER:
            inner = preds[preds.year.isin(S.inner_seasons(yr))]
            O = preds[preds.year == yr].copy()
            prm = {lv: I.fit_params(inner, lv) for lv in (0.8, 0.9)}
            a80, a90 = prm[0.8]["alpha_cov"], prm[0.9]["alpha_cov"]
            mu = O.mu.to_numpy()
            O["mean"] = mu
            O["median"] = poisson.median(np.maximum(mu, 1e-9))
            for lv, a in ((0.8, a80), (0.9, a90)):
                lo, hi = I._nb_int(mu, a, lv)
                O[f"lo{int(lv*100)}"], O[f"hi{int(lv*100)}"] = lo, hi
            thr = O.thr_q90.to_numpy()
            nbp = lambda d, a: nbinom.sf(np.ceil(d.thr_q90) - 1, 1 / a, 1 / (1 + a * np.maximum(d.mu, 1e-9)))
            tau = PK._best_f1_threshold(nbp(inner, a80), inner.y_true.to_numpy(float), inner.thr_q90.to_numpy(float))
            O["p_outbreak"] = nbp(O, a80)
            O["alert"] = O.p_outbreak >= tau
            O["tier"] = np.asarray(TIERS)[tier_index(O["median"], O.tier_e1, O.tier_e2, O.tier_e3)]
            rows.append(O[["ward_id", "city", "origin_date", "target_date", "horizon", "year", "y_true", "mean", "median", "lo80", "hi80", "lo90", "hi90",
                           "p_outbreak", "alert", "tier", "thr_q90"]])
    r = pd.concat(rows, ignore_index=True)
    r["origin_date"], r["target_date"] = r.origin_date.dt.strftime("%Y-%m-%d"), r.target_date.dt.strftime("%Y-%m-%d")
    for c in ("mean", "p_outbreak"):
        r[c] = r[c].round(4)
    r[["median", "lo80", "hi80", "lo90", "hi90"]] = r[["median", "lo80", "hi80", "lo90", "hi90"]].astype(int)
    return r


def main():
    df = load_development_panel()
    assert df.date.dt.year.max() == 2024
    dump("profile.json", build_profile(df))
    dump("distributions.json", build_distributions(df))
    dump("correlations.json", build_correlations(df))
    dump("seasonality.json", build_seasonality(df))
    dump("lag_analysis.json", build_lag())
    val = build_validation()
    dump("validation.json", val)
    rep = build_replay(df, val["champion"])
    assert pd.to_datetime(rep.target_date).dt.year.max() <= 2024
    with gzip.open(OUT / "replay.csv.gz", "wt") as f:
        rep.to_csv(f, index=False)
    print({p.name: p.stat().st_size // 1024 for p in OUT.iterdir()}, "KB; replay rows", len(rep))


if __name__ == "__main__":
    main()
