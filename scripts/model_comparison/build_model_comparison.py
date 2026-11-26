#!/usr/bin/env python3
"""Build the unified model comparison (reports/MODEL_COMPARISON.csv + .md) from saved, reproducible results only.

Inputs (all in the repository):
  reports/model_tournament/scores_all_cells.csv   every Stage 3 model x feature set x convention x season x horizon cell (exactly
                                                  reproduces leaderboard_all.csv, checked below)
  reports/model_tournament/leaderboard_all.csv    which rows are valid in which window (tuned models only on 2022-2024, etc.)
  reports/model_tournament/optuna_summary.csv     hyperparameter-trial summary (trials are NOT models)
  reports/features/leaderboard_full.csv           Stage 2 feature-configuration experiments (NOT models; different folds)
  reports/baselines/metrics_summary.csv           Stage 1 baselines (convention A, Stage 1 pipeline; indicative only)
  reports/model_comparison/r2_cells_from_cache.csv  R² terms from the cached tournament predictions (r2_from_cached_predictions.py)
  reports/model_comparison/benchmark_cells.csv    V3 classical benchmarks + baselines re-run under convention B (run_classical_benchmarks.py)
  reports/model_comparison/model_sizes.csv        serialized size of one fitted model per family

Nothing is estimated or filled in: a metric that was not computed stays empty, and the row says why.

    .venv/bin/python scripts/model_comparison/build_model_comparison.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from dengueshield.models import tournament as T  # noqa: E402

R = ROOT / "reports"
MC = R / "model_comparison"
WINDOWS = {"2022-2024": (2022, 2023, 2024), "2019-2024": tuple(range(2019, 2025))}
LB_WINDOW = {"2022-2024": "bench_2022_2024", "2019-2024": "outer_2019_2024"}
WINDOW_ROLE = {"2022-2024": "development validation used in model selection (not a blind test)",
               "2019-2024": "out-of-time development validation, six seasons (includes the three selection seasons)"}
CHAMP = {"model": "glm_poisson", "fs": "F8", "conv": "B", "tag": ""}
CONVENTION = {"B": "B: start of week (weather and cases to t-1) - production", "A": "A: end of week (weather and cases to t)",
              "C": "C: end of week, cases one week late (sensitivity)"}
FS = {"F8": "F8 (24 features: calendar, ward vulnerability, aligned rain)", "F3": "F3 (38 features)", "none": "none (rule on case history)"}

FAMILY = {
    "glm_poisson": ("Count GLM", "Ridge Poisson GLM, log link"), "glm_poisson_nbdisp": ("Count GLM", "Ridge Poisson mean + NB dispersion by moments"),
    "glm_spline": ("Count GLM", "Ridge Poisson GLM + cyclic seasonal splines"), "glm_nb": ("Count GLM", "Negative-binomial (NB2) IRLS, unpenalised"),
    "glm_tweedie": ("Count GLM", "Ridge Tweedie GLM (power 1.5)"), "lgbm_poisson": ("Gradient-boosted trees", "LightGBM, Poisson loss"),
    "lgbm_tweedie": ("Gradient-boosted trees", "LightGBM, Tweedie loss"), "lgbm_l1": ("Gradient-boosted trees", "LightGBM, L1 loss"),
    "xgb_poisson": ("Gradient-boosted trees", "XGBoost, Poisson loss"), "cat_poisson": ("Gradient-boosted trees", "CatBoost, Poisson loss"),
    "hurdle_lgbm": ("Two-part (hurdle)", "LightGBM P(Y>0) x zero-truncated Poisson for positive weeks"),
    "rf": ("Bagged trees (V3)", "Random Forest regressor: 300 trees, min leaf 5, max features 0.5, squared error"),
    "extra_trees": ("Bagged trees (V3)", "Extra Trees regressor: 300 trees, min leaf 5, max features 0.7, squared error"),
    "ridge_ls": ("Linear least squares (V3)", "Ridge regression on counts (identity link)"),
    "knn": ("Nearest neighbours (V3)", "k-NN regressor on standardised features"),
    "mlp": ("Neural network (V3)", "MLP 32-16 ReLU, L2 1e-3, at most 200 epochs"),
    "global_mean": ("Baseline: mean", "Mean of all training weeks"), "ward_mean": ("Baseline: mean", "Mean of the ward's training weeks"),
    "seasonal_avg": ("Baseline: climatology", "Ward's average for the same calendar week in past years"),
    "last_known": ("Baseline: persistence", "Last reported week's cases"), "moving_avg_4": ("Baseline: persistence", "Mean of the last 4 reported weeks"),
}
NEW = ("rf", "extra_trees", "ridge_ls", "knn", "mlp")
BASE = ("global_mean", "ward_mean", "seasonal_avg", "last_known", "moving_avg_4")
METRICS = ["mae", "rmse", "bias", "zero_mae", "mae_mean", "rmse_mean", "bias_mean", "poisson_dev", "high_mae", "high_bias", "high_under",
           "recall", "precision", "false_alert_rate", "fit_s", "predict_ms_per_1k"]


def family(model: str):
    if model.startswith("ens_"):
        return "Two-model ensemble", f"Weighted GLM + {model[8:].replace('_tuned', ' (tuned)')}, weights from the two preceding seasons"
    return FAMILY[model]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def load_cells() -> pd.DataFrame:
    c = pd.read_csv(R / "model_tournament/scores_all_cells.csv")
    c["tag"] = c["tag"].fillna("")
    lb = pd.read_csv(R / "model_tournament/leaderboard_all.csv")
    lb["tag"] = lb["tag"].fillna("")
    for w, yrs in WINDOWS.items():                                    # provenance: the cells must reproduce the published leaderboard
        chk = T.leaderboard(c, yrs).merge(lb[lb.years == LB_WINDOW[w]], on=["model", "fs", "conv", "tag"], suffixes=("", "_lb"))
        assert len(chk) == (lb.years == LB_WINDOW[w]).sum() and (chk.mae_avg - chk.mae_avg_lb).abs().max() < 1e-9, w
    # R² terms from the cache, attached only where a cached block reproduces the cell's MAE exactly
    r2 = pd.read_csv(MC / "r2_cells_from_cache.csv")
    r2["tag"] = r2["tag"].fillna("")
    k = ["model", "fs", "conv", "tag", "year", "horizon"]
    m = r2[r2.attribution.str.startswith("exact")]                     # identity by exact cache key + in-file metadata, never by MAE
    assert not m.duplicated(k).any()
    c = c.merge(m[k + ["sse_expected", "sum_y", "sum_y2", "r2_basis"]], on=k, how="left")
    c["r2_attribution"] = np.where(c.sse_expected.notna(), "exact cache key + in-file metadata",
                                   np.where(c.tag == "ensemble", "none: ensemble never cached", "none: artifact not identified"))
    c["provenance"] = "reports/model_tournament/scores_all_cells.csv (notebooks/07_model_tournament.ipynb)"
    c["source"] = "Stage 3 tournament (notebooks/07)"
    c["valid_windows"] = [tuple(w for w in WINDOWS if ((lb.years == LB_WINDOW[w]) & (lb.model == r.model) & (lb.fs == r.fs) & (lb.conv == r.conv) & (lb.tag == r.tag)).any())
                          for r in c[["model", "fs", "conv", "tag"]].itertuples()]
    b = pd.read_csv(MC / "benchmark_cells.csv")
    b["tag"], b["source"] = "", np.where(b.model.isin(BASE), "V3 baseline re-run, convention B", "V3 classical benchmark")
    b = b.rename(columns={"sse_point": "sse_expected"})
    b["r2_basis"], b["valid_windows"] = "point", [tuple(WINDOWS)] * len(b)
    b["r2_attribution"] = "computed from this benchmark's own predictions"
    b["provenance"] = "reports/model_comparison/benchmark_cells.csv (scripts/model_comparison/run_classical_benchmarks.py)"
    return pd.concat([c, b], ignore_index=True)


def agg(cells: pd.DataFrame, years) -> pd.DataFrame:
    """Window summary per configuration and horizon (mean over seasons, like the leaderboard) plus a 2-4 week average."""
    s = cells[cells.year.isin(years)]
    keys = ["source", "model", "fs", "conv", "tag"]
    per_h = s.groupby(keys + ["horizon"]).agg({**{m: "mean" for m in METRICS if m in s}, "n": "sum", "year": "nunique"}).reset_index()
    sums = s.groupby(keys + ["horizon"])[["sse_expected", "sum_y", "sum_y2", "n"]].sum(min_count=1).reset_index()
    full = s.groupby(keys + ["horizon"]).sse_expected.apply(lambda x: x.notna().all()).rename("r2_complete").reset_index()
    sums = sums.merge(full, on=keys + ["horizon"])
    sst = sums.sum_y2 - sums.sum_y ** 2 / sums.n
    sums["r2"] = np.where(sums.r2_complete, 1 - sums.sse_expected / sst, np.nan)
    per_h = per_h.merge(sums[keys + ["horizon", "r2"]], on=keys + ["horizon"]).rename(columns={"year": "n_seasons", "n": "n_rows"})
    pw = s.assign(ae=s.mae * s.n, se=s.rmse ** 2 * s.n)                # pooled over all ward-weeks (the canonical-metrics definition)
    pool_h = pw.groupby(keys + ["horizon"])[["ae", "se", "n"]].sum().reset_index()
    pool_h["mae_pooled"], pool_h["rmse_pooled"] = pool_h.ae / pool_h.n, np.sqrt(pool_h.se / pool_h.n)
    pool_a = pw.groupby(keys)[["ae", "se", "n"]].sum().reset_index()
    pool_a["mae_pooled"], pool_a["rmse_pooled"], pool_a["horizon"] = pool_a.ae / pool_a.n, np.sqrt(pool_a.se / pool_a.n), "2-4 mean"
    per_h = per_h.merge(pool_h[keys + ["horizon", "mae_pooled", "rmse_pooled"]], on=keys + ["horizon"])
    attr = s.groupby(keys).r2_attribution.agg(lambda x: x.iloc[0] if x.nunique() == 1 else "mixed").rename("r2_attribution").reset_index()
    prov = s.groupby(keys).provenance.first().reset_index()
    by_year = s.groupby(keys + ["year"]).mae.mean().unstack("year")
    sd = by_year.std(axis=1).rename("season_sd_mae").reset_index()
    worst = by_year.max(axis=1).rename("worst_season_mae").reset_index()
    avg = per_h.groupby(keys).agg({**{m: "mean" for m in METRICS + ["r2"] if m in per_h}, "n_rows": "sum", "n_seasons": "max"}).reset_index()
    avg["horizon"] = "2-4 mean"
    avg = avg.merge(pool_a[keys + ["horizon", "mae_pooled", "rmse_pooled"]], on=keys + ["horizon"])
    out = pd.concat([per_h.astype({"horizon": str}), avg], ignore_index=True)
    return out.merge(sd, on=keys, how="left").merge(worst, on=keys, how="left").merge(attr, on=keys, how="left").merge(prov, on=keys, how="left")


def vs_champion(cells: pd.DataFrame, years) -> pd.DataFrame:
    """Paired MAE difference to the deployed champion over the same season x horizon cells (convention B only)."""
    s = cells[cells.year.isin(years) & (cells.conv == "B")]
    ref = s[(s.model == CHAMP["model"]) & (s.fs == CHAMP["fs"]) & (s.tag == "") & (s.source.str.startswith("Stage 3"))].set_index(["year", "horizon"]).mae
    rows = []
    for k, g in s.groupby(["source", "model", "fs", "conv", "tag"]):
        d = (g.set_index(["year", "horizon"]).mae - ref).dropna()
        py = d.groupby(level="year").mean()
        rows.append({**dict(zip(["source", "model", "fs", "conv", "tag"], k)), "mae_diff_vs_champion": d.mean(),
                     "seasons_better_than_champion": f"{int((py < 0).sum())} of {len(py)}"})
    return pd.DataFrame(rows)


def status(r) -> str:
    if r.model in BASE:
        return "reference baseline"
    if (r.model, r.fs, r.conv, r.tag) == (CHAMP["model"], CHAMP["fs"], CHAMP["conv"], ""):
        return "DEPLOYED CHAMPION"
    if r.model == "glm_poisson" and r.fs == "F8":
        return "champion specification, other convention"
    if r.model == "glm_nb":
        return "disqualified: unpenalised NB fit diverged in short-history seasons"
    if r.model in NEW or r.model == "lgbm_l1":
        return ("not eligible as run: configured here as a point forecaster without an uncertainty method; intervals could be added "
                "(e.g. quantile or conformal methods) but were not built or validated in this benchmark")
    if r.tag == "tuned":
        return "candidate, not selected: tuning gains on 2019-2021 did not transfer to 2022-2024"
    if r.tag == "ensemble":
        return "candidate, not selected: no ensemble beat the rule's 0.05 MAE margin; weights unstable"
    return "candidate, not selected: champion is the simplest model within 0.05 MAE of the best on both windows"


def limitations(r, diag) -> str:
    out = []
    if r.window == "2022-2024":
        out.append("2022-2024 also chose the model")
    if r.conv != "B":
        out.append("compare only within the same convention")
    if pd.isna(r.r2):
        out.append("no R² (ensemble combined on the fly, never cached)" if r.tag == "ensemble" else "R² not available: artifact not identified")
    if r.model in NEW or r.model == "lgbm_l1" or r.model in BASE:
        out.append("MAE of a point forecast, while count models use their distribution median (an advantage on zero weeks)")
    if r.model in diag:
        out.append(diag[r.model])
    if r.tag == "tuned":
        out.append("tuned on 2019-2021, so reported on 2022-2024 only")
    return "; ".join(out)


def _f(v, d=3):
    return "–" if v is None or (isinstance(v, float) and np.isnan(v)) else (f"{v:.{d}f}" if isinstance(v, (float, np.floating)) else str(v))


def _size(b) -> str:
    if b is None or pd.isna(b):
        return "–"
    return f"{b / 1e6:.1f} MB" if b >= 1e6 else f"{b / 1e3:.0f} KB" if b >= 1e3 else f"{int(b)} B"


def _label(r) -> str:
    fs = r.feature_set.split(" ")[0] if isinstance(r.feature_set, str) else ""
    tag = f" ({r.variant_tag})" if isinstance(r.variant_tag, str) and r.variant_tag else ""
    return f"{r.model}{tag}" + (f", {fs}" if fs and fs != "none" else "")


def write_md(out: pd.DataFrame, counts: dict, diag: dict, prov: dict):
    bundle_bytes = pd.read_csv(MC / "model_sizes.csv").set_index("model").size_bytes.filter(like="deployed bundle").iloc[0]
    B = out[(out.convention == "B") & (out.horizon == "2-4 mean")]
    w6, w3 = B[B.window == "2019-2024"].sort_values("mae"), B[B.window == "2022-2024"].sort_values("mae")
    ch6 = w6[w6.selection_status == "DEPLOYED CHAMPION"].iloc[0]
    ch3 = w3[w3.selection_status == "DEPLOYED CHAMPION"].iloc[0]
    new6 = w6[w6.model.isin(NEW)]
    best_new = new6.iloc[0]
    sa6 = w6[w6.model == "seasonal_avg"].iloc[0]
    ch_h = out[(out.convention == "B") & (out.model == "glm_poisson") & out.feature_set.str.startswith("F8") & (out.horizon != "2-4 mean")]
    opt = pd.read_csv(R / "model_tournament/optuna_summary.csv")
    feat = pd.read_csv(R / "features/leaderboard_full.csv")
    s1 = pd.read_csv(R / "baselines/metrics_summary.csv")
    L = []
    a = L.append
    a("# DengueShield AI: model comparison")
    a("")
    a("Generated by `scripts/model_comparison/build_model_comparison.py` from saved results only (no metric is estimated or filled in).")
    a("Machine-readable table: `reports/MODEL_COMPARISON.csv` (one row per configuration × evaluation window × horizon, plus a 2–4 week mean).")
    a("All numbers are **validation** results on the organizers' synthetic data, 2016–2024. **2022–2024 were also used to choose the model, so they are not a blind test.** The 2025 test year is sealed and was never read.")
    a("")
    a("## 1. What was compared (and what each count means)")
    a("")
    a("| Item | Count | Meaning |")
    a("|---|---|---|")
    a(f"| Algorithm libraries in the Stage 3 tournament | {len(counts['stage3_algorithm_libraries'])} | {', '.join(counts['stage3_algorithm_libraries'])} |")
    a(f"| Stage 3 base model variants | {counts['stage3_base_model_variants']} | 5 count GLMs, 5 gradient-boosted tree models, 1 hurdle model |")
    a(f"| Stage 3 tuned variants | {counts['stage3_tuned_variants']} | LightGBM, XGBoost and CatBoost after Optuna tuning |")
    a(f"| Stage 3 ensembles | {counts['stage3_ensembles']} | GLM + one other model, weights learned on the two preceding seasons |")
    a(f"| V3 classical benchmarks (new) | {counts['v3_new_model_variants']} | Random Forest, Extra Trees, ridge least squares, k-nearest neighbours, small neural network (MLP) |")
    a(f"| Baselines re-run under convention B (new) | {counts['v3_baselines_rerun']} | overall mean, ward mean, seasonal average (climatology), last week, 4-week moving average |")
    a(f"| Stage 3 leaderboard rows | {counts['stage3_leaderboard_rows']} | variants × 2 feature sets × 3 conventions × 2 windows; **not** {counts['stage3_leaderboard_rows']} different models |")
    a(f"| Scored season × horizon cells (Stage 3) | {counts['stage3_scored_cells']} | one fitted model per cell; the leaderboard is their mean |")
    a(f"| Hyperparameter trials | {counts['hyperparameter_trials']} | Optuna trials (40 each for {', '.join(counts['hyperparameter_trials_by_model'])}); trials of three models, not models |")
    a(f"| Stage 2 feature configurations | {counts['stage2_feature_configurations']} | {counts['stage2_feature_configurations'] // 2} feature sets × {{GLM, LightGBM}}, convention A; they chose the features, not the model |")
    a("")
    a("Distinct model variants evaluated in total: **" + str(counts['stage3_base_model_variants'] + counts['stage3_tuned_variants'] + counts['stage3_ensembles'] + counts['v3_new_model_variants']) +
      f"** (23 from Stage 3 + {counts['v3_new_model_variants']} new), plus {counts['v3_baselines_rerun']} baselines.")
    a("")
    a("## 2. How every model was evaluated")
    a("")
    a("- **Season-level out-of-time folds.** For season *Y*, a model is fitted on all labels reported by 31 Dec *Y − 1* (expanding window from 2016) and predicts season *Y*; evaluation rows have both the forecast date and the target week in *Y*. Same rows for every model.")
    a("- **Convention B (production):** a forecast issued on the Monday of week *t* uses weather and cases up to week *t − 1*. Conventions A and C are kept in the CSV but never mixed with B.")
    a("- **Windows:** 2019–2024 (six seasons) and 2022–2024 (three seasons, also used for model selection). Tuned models are shown on 2022–2024 only because they were tuned on 2019–2021.")
    a("- **Features:** F8 (24: calendar, ward vulnerability, rain aligned to the target week) and F3 (38), frozen after Stage 2.")
    a("- **Metrics** (identical code for every row, `dengueshield/models/seasons.py::score`): MAE and RMSE of the point forecast (count models use the median of their predictive distribution; point models their forecast), R² of the expected-value forecast, bias, error at peak weeks (actual ≥ the training 90th percentile), outbreak recall, precision and false-alert rate (alert = point forecast ≥ that threshold), fit time and prediction time.")
    a("- **Two averages, both reported:** `mae`/`rmse` are the mean of the season values (the leaderboard definition, used for selection); `mae_pooled`/`rmse_pooled` pool every ward-week (the definition in `app_data/metrics_canonical.json`). They differ in the third decimal (champion, 2 weeks, 2022–2024: 1.107 season-mean vs 1.106 pooled). Tables below use the season mean unless labelled pooled.")
    a(f"- **Provenance check:** the per-cell scores reproduce the published leaderboard exactly (largest difference < 1e-9). R² is attributed by **exact artifact identity**: the tournament's cache key (a hash of model, feature columns, convention, parameters, horizon, season, rain projection and tag; tuned parameters read from the original Optuna databases) is rebuilt for each cell and the file's stored metadata must match the cell ({counts.get('r2_cells', '–')} cells identified; MAE agreement is only a secondary check). Ensembles were never cached, so they have no R². The new benchmarks' R² comes from their own predictions.")
    a("")
    a("## 3. The champion and why it was chosen")
    a("")
    a("The rule was fixed **before** the tuned and ensemble results were seen (`docs/model_selection.md` §7): (1) eligible candidates have a predictive distribution and no failed fits; (2) shortlist everything within 0.05 MAE of the best on 2022–2024 that also holds on 2019–2024; (3) pick the simplest (plain Poisson GLM, then other GLMs, then ensembles, then boosting).")
    a("")
    a(f"**Result: ridge Poisson GLM on F8 (24 features).** Average MAE {_f(ch3.mae)} on 2022–2024 and {_f(ch6.mae)} on 2019–2024 (R² {_f(ch3.r2, 2)} / {_f(ch6.r2, 2)}). "
      f"It is within the rule's 0.05 MAE selection tolerance of the best eligible model on both windows, has the lowest season-to-season variability of the GLM shortlist, the best peak-week error among the GLMs ({_f(ch6.high_mae if 'high_mae' in ch6 else ch6.peak_week_mae, 2)} on 2019–2024), "
      f"a 24-feature design that explains every forecast additively, and a deployed bundle of {_size(bundle_bytes)} for all three horizons.")
    a("")
    a("| Horizon | MAE 2022–24 | MAE 2019–24 | RMSE 2019–24 | R² 2019–24 | Peak-week MAE | Recall | Precision | False-alert rate |")
    a("|---|---|---|---|---|---|---|---|---|")
    for h in ("2", "3", "4"):
        x3 = ch_h[(ch_h.window == "2022-2024") & (ch_h.horizon == h)].iloc[0]
        x6 = ch_h[(ch_h.window == "2019-2024") & (ch_h.horizon == h)].iloc[0]
        a(f"| {h} weeks | {_f(x3.mae)} | {_f(x6.mae)} | {_f(x6.rmse)} | {_f(x6.r2, 2)} | {_f(x6.peak_week_mae, 2)} | {_f(x6.outbreak_recall, 2)} | {_f(x6.outbreak_precision, 2)} | {_f(x6.false_alert_rate, 3)} |")
    a("")
    for title, w in (("2019–2024, six seasons", w6), ("2022–2024, three seasons (development validation used in model selection; not a blind test)", w3)):
        a(f"## {'4' if '2019' in title else '5'}. Leaderboard, convention B, {title}")
        a("")
        a("Average of horizons 2–4, season-mean MAE. Δ = MAE minus the champion's over the same season × horizon cells (negative = better). Models run as point forecasts in this benchmark are marked †. The 0.05 MAE figure used in the selection rule is a pre-set tolerance, not a confidence interval.")
        a("")
        a("| # | Model | Family | MAE | RMSE | R² | Peak-week MAE | Recall | Precision | False alerts | Δ vs champion | Seasons better | Status |")
        a("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for i, r in enumerate(w.itertuples(), 1):
            mark = " †" if r.point_forecast == "point forecast" else ""
            st = r.selection_status.split(":")[0]
            a(f"| {i} | {_label(r)}{mark} | {r.family} | {_f(r.mae)} | {_f(r.rmse, 2)} | {_f(r.r2, 2)} | {_f(r.peak_week_mae, 2)} | {_f(r.outbreak_recall, 2)} | {_f(r.outbreak_precision, 2)} | {_f(r.false_alert_rate, 3)} | {_f(r.mae_diff_vs_champion)} | {r.seasons_better_than_champion} | {st} |")
        a("")
    a("## 6. New classical benchmarks (V3)")
    a("")
    a("Run by `scripts/model_comparison/run_classical_benchmarks.py` on the identical folds, rows, convention B, feature sets, outbreak thresholds and scoring code. Preprocessing is the GLM's (training-only median imputation, 0.5/99.5% winsorising, standardising). Ridge least squares and k-NN pick one setting inside every fit on its last training year; Random Forest, Extra Trees and the MLP use fixed settings chosen before any result. Nothing was tuned on a validation season.")
    a("")
    a("| Model | Best feature set | MAE 2019–24 | Δ vs champion | MAE if converted to a Poisson median | Peak-week MAE | Recall | Precision | Fit time (s) | Size of one fitted model |")
    a("|---|---|---|---|---|---|---|---|---|---|")
    for m in NEW:
        r = new6[new6.model == m].iloc[0]
        a(f"| {m} | {r.feature_set.split(' ')[0]} | {_f(r.mae)} | {_f(r.mae_diff_vs_champion)} | {_f(r.mae_poisson_median_of_point)} | {_f(r.peak_week_mae, 2)} | {_f(r.outbreak_recall, 2)} | {_f(r.outbreak_precision, 2)} | {_f(r.fit_seconds, 2)} | {_size(r.model_size_bytes)} |")
    a("")
    beats = out[(out.convention == "B") & (out.horizon == "2-4 mean") & out.model.isin(NEW) & (out.mae_diff_vs_champion < 0)]
    trees = new6[new6.model.isin(["rf", "extra_trees"])]
    a(f"**Reading.** {'None of the five beats the champion on either window' if beats.empty else 'Rows that beat the champion: ' + ', '.join(_label(r) + ' (' + r.window + ')' for r in beats.itertuples())}; the closest on 2019–2024 is {_label(best_new)}, {_f(best_new.mae_diff_vs_champion)} MAE behind. "
      f"Because they forecast a mean with a squared-error loss, the tree ensembles predict higher values (bias {_f(trees.bias.min(), 2)} to {_f(trees.bias.max(), 2)} against the champion's {_f(ch6.bias, 2)}): they are slightly better at peak weeks (MAE {_f(trees.peak_week_mae.min())}–{_f(trees.peak_week_mae.max())} vs {_f(ch6.peak_week_mae)}) and catch a few more outbreaks, but raise more false alerts ({_f(trees.false_alert_rate.min(), 3)}–{_f(trees.false_alert_rate.max(), 3)} vs {_f(ch6.false_alert_rate, 3)}) and are worse on the many zero-case weeks (MAE {_f(trees.zero_week_mae.min(), 2)}–{_f(trees.zero_week_mae.max(), 2)} vs {_f(ch6.zero_week_mae, 2)}). "
      "Converting their point forecasts to Poisson medians (the integer forecast the count models use) does not close the gap, so the gap is not an artefact of scoring. "
      "As configured here, all five produce point forecasts only. Uncertainty intervals and an outbreak probability could be added to them (for example with quantile or conformal methods), but that was not built or validated in this benchmark, so as run they do not meet the deployment rule, which requires a predictive distribution.")
    a("")
    a("Honest diagnostics:")
    for m, t in diag.items():
        a(f"- **{m}**: {t}.")
    a("- **SARIMA was not run.** A fair per-ward seasonal ARIMA would need weekly seasonality (period 52) fitted for 60 wards in every season, on short, zero-heavy count series, with convention-B availability rules for any weather input. That cannot be done reliably or within reasonable compute here, so the time-series role is filled by the seasonal-average (climatology) and persistence baselines, run on the identical folds.")
    a("")
    a("## 7. Baselines")
    a("")
    a(f"Re-run under convention B on the same folds (2019–2024): seasonal average {_f(sa6.mae)}, last week {_f(w6[w6.model == 'last_known'].iloc[0].mae)}, 4-week moving average {_f(w6[w6.model == 'moving_avg_4'].iloc[0].mae)}, ward mean {_f(w6[w6.model == 'ward_mean'].iloc[0].mae)}, overall mean {_f(w6[w6.model == 'global_mean'].iloc[0].mae)}. "
      f"The champion is {_f(sa6.mae - ch6.mae)} cases per ward-week better than the strongest baseline (seasonal average); the seasonal average beat it in {sa6.seasons_better_than_champion} seasons.")
    a("")
    a("Stage 1 baselines (`reports/baselines/`) used convention A and a different feature pipeline; they are kept for the record and not mixed into the tables above:")
    a("")
    a("| Stage 1 model (convention A, 2022–2024) | MAE h=2 | h=3 | h=4 |")
    a("|---|---|---|---|")
    for m in ("seasonal_avg", "last_known", "moving_avg_4", "ward_mean", "global_mean", "poisson_glm", "poisson_glm_poisson_median"):
        g = s1[s1.model == m].set_index("horizon").all_mae
        a(f"| {m} | {_f(g.get(2))} | {_f(g.get(3))} | {_f(g.get(4))} |")
    a("")
    a("## 8. Evidence that is not a model leaderboard")
    a("")
    a("**Hyperparameter tuning (Optuna, inner seasons 2019–2021).** Each tuned booster beat the plain GLM on the tuning seasons, but the gain did not transfer to 2022–2024 (see the 2022–2024 leaderboard, `tuned` rows).")
    a("")
    a("| Model | Trials | Complete | Pruned | Best inner MAE | GLM inner MAE |")
    a("|---|---|---|---|---|---|")
    for r in opt.itertuples():
        a(f"| {r.model} | {r.trials} | {r.complete} | {r.pruned} | {_f(r.best_inner_mae)} | {_f(r.glm_inner_mae)} |")
    a("")
    best_f = feat.sort_values("mae_avg").iloc[0]
    a(f"**Feature configurations (Stage 2, convention A, folds 2022–2024).** {len(feat)} runs = {feat.config.nunique()} feature configurations × {{{', '.join(sorted(feat.model.unique()))}}}. Best: `{best_f.config}` ({best_f.model}, MAE {_f(best_f.mae_avg)}, {int(best_f.n_features)} features). These selected the frozen feature sets F3/F8; their MAE is on convention A and must not be compared with the convention-B tables. Source: `reports/features/leaderboard_full.csv`.")
    a("")
    a("**Conventions A and C** are in `MODEL_COMPARISON.csv` with the same metrics; under A (weather and cases up to the forecast week itself) every model scores better, which is why conventions are never mixed.")
    a("")
    a("## 9. Limitations")
    a("")
    a("- Only six out-of-time seasons. The rule treats candidates within 0.05 MAE as equivalent; 0.05 is a pre-set selection tolerance, not a confidence interval or significance test (paired season-level intervals are in `reports/model_tournament/paired_*.csv`).")
    a("- 2022–2024 informed model selection; the only untouched test is the sealed 2025 season.")
    a("- Point-forecast and distribution-median MAE are not identical quantities (columns `point_forecast` and `mae_poisson_median_of_point` make this visible).")
    a("- Model size is measured on one fit per family (season 2024, 3 weeks ahead, F8); fit times are mean seconds per season fit on this laptop and vary with hardware.")
    a("- Ensembles have no R² (predictions were combined on the fly and not cached).")
    a("- The data are synthetic; none of these numbers describe real-world surveillance accuracy.")
    a("")
    a("## 10. Reproduce")
    a("")
    a("```bash")
    a(".venv/bin/python scripts/model_comparison/r2_from_cached_predictions.py <tournament .cache/models>   # optional: R² terms (needs the Stage 3 cache)")
    a(".venv/bin/python scripts/model_comparison/run_classical_benchmarks.py                                 # about 4 minutes")
    a(".venv/bin/python scripts/model_comparison/build_model_comparison.py                                   # this file and the CSV")
    a("```")
    a("")
    import platform, sklearn
    a(f"Environment: Python {platform.python_version()}, numpy {np.__version__}, pandas {pd.__version__}, scikit-learn {sklearn.__version__}; random seed 2026; "
      "tournament cache VERSION `s3.1`, rain projection `clim`; code base: baseline commit `938ff3b` plus the uncommitted V3 changes (`EDU_HACKATHON_V3_prep/snapshots/`).")
    a("")
    a("Scripts (SHA-256, first 16 hex): " + ", ".join(f"`{q}` `{sha(ROOT / q)}`" for q in ("scripts/model_comparison/r2_from_cached_predictions.py", "scripts/model_comparison/run_classical_benchmarks.py",
                                                                                          "scripts/model_comparison/build_model_comparison.py", "dengueshield/models/classical.py")) + ".")
    a("")
    a("Input files (SHA-256, first 16 hex):")
    a("")
    for k, v in prov.items():
        a(f"- `reports/{k}`: `{v}`")
    (R / "MODEL_COMPARISON.md").write_text("\n".join(L) + "\n")


def main():
    cells = load_cells()
    sizes = pd.read_csv(MC / "model_sizes.csv").set_index("model").size_bytes
    bench = cells[cells.model.isin(NEW)]
    diag = {}
    for m, g in bench.groupby("model"):
        bits = []
        if g.neg_share.max() > 0:
            bits.append(f"{g.neg_share.mean():.1%} of predictions were negative and clipped to 0 (MAE before clipping reported)")
        if (~g.converged.astype(bool)).any():
            bits.append(f"optimiser hit its iteration cap in {int((~g.converged.astype(bool)).sum())} of {len(g)} fits")
        if m == "knn":
            edge = int((g.hp.astype(float) == 80).sum())
            if edge:
                bits.append(f"chosen k at the grid edge (80) in {edge} of {len(g)} fits; grid kept fixed")
        if bits:
            diag[m] = "; ".join(bits)
    rows = []
    for w, yrs in WINDOWS.items():
        a = agg(cells[cells.valid_windows.apply(lambda v: w in v)], yrs)
        a = a.merge(vs_champion(cells, yrs), on=["source", "model", "fs", "conv", "tag"], how="left")
        a["window"] = w
        rows.append(a)
    out = pd.concat(rows, ignore_index=True)
    extra = bench.groupby(["model", "fs"])[["mae_unclipped", "neg_share", "mae_poisson_median_of_point"]].mean().reset_index()
    out = out.merge(extra, on=["model", "fs"], how="left")
    fam = out.model.map(lambda m: family(m))
    out["family"], out["variant"] = fam.str[0], fam.str[1]
    out["tuning"] = np.select([out.tag == "tuned", out.tag == "ensemble", out.model.isin(["ridge_ls", "knn"]), out.model.isin(["rf", "extra_trees", "mlp"]), out.model.isin(BASE)],
                              ["Optuna TPE, 40 trials on 2019-2021", "ensemble weights on the two preceding seasons",
                               "one setting chosen inside every fit on its last training year", "fixed settings chosen before any result", "none"],
                              "fixed specification; ridge strength or boosting rounds chosen inside every fit on its last training year")
    out["point_forecast"] = np.where(out.model.isin(NEW) | out.model.isin(BASE) | (out.model == "lgbm_l1"), "point forecast", "median of the predictive distribution")
    out["feature_set"] = out.fs.map(FS)
    out["convention_detail"] = out.conv.map(CONVENTION)
    out["window_role"] = out.window.map(WINDOW_ROLE)
    out["training"] = "expanding window from 2016 to 31 Dec of the year before each season (labels reported by then)"
    out["model_size_bytes"] = out.model.map(sizes)
    out["selection_status"] = out.apply(status, axis=1)
    out["comparability"] = np.where(out.conv == "B", "directly comparable: same folds, rows, convention B and scoring code as the champion",
                                    "same folds and scoring code, different information convention")
    out["limitations"] = out.apply(lambda r: limitations(r, diag), axis=1)
    cols = ["source", "family", "model", "variant", "tag", "tuning", "feature_set", "conv", "convention_detail", "window", "window_role", "training",
            "horizon", "n_seasons", "n_rows", "point_forecast", "mae", "rmse", "mae_pooled", "rmse_pooled", "r2", "r2_attribution", "bias", "high_mae", "high_bias", "high_under", "recall",
            "precision", "false_alert_rate", "zero_mae", "mae_mean", "rmse_mean", "poisson_dev", "season_sd_mae", "worst_season_mae", "mae_diff_vs_champion",
            "seasons_better_than_champion", "mae_unclipped", "neg_share", "mae_poisson_median_of_point", "model_size_bytes", "fit_s",
            "predict_ms_per_1k", "selection_status", "comparability", "limitations", "provenance"]
    out = out[cols].rename(columns={"tag": "variant_tag", "conv": "convention", "high_mae": "peak_week_mae", "high_bias": "peak_week_bias",
                                    "high_under": "peak_weeks_under_predicted", "zero_mae": "zero_week_mae", "recall": "outbreak_recall", "precision": "outbreak_precision",
                                    "mae_mean": "mae_of_expected_value", "rmse_mean": "rmse_of_expected_value", "fit_s": "fit_seconds"})
    order = {"2-4 mean": 0, "2": 1, "3": 2, "4": 3}
    out = out.sort_values(["window", "convention", "horizon"], key=lambda s: s.map(order) if s.name == "horizon" else s)
    out = out.sort_values(["window", "convention", "horizon", "mae"], key=lambda s: s.map(order) if s.name == "horizon" else s, kind="stable")
    num = out.select_dtypes("number").columns
    out[num] = out[num].round(4)
    out.to_csv(R / "MODEL_COMPARISON.csv", index=False)

    # temporal view for the app: convention B, per season and horizon
    bs = cells[(cells.conv == "B")][["source", "model", "fs", "tag", "year", "horizon", "mae", "high_mae", "recall"]].copy()
    bs.round(4).to_csv(MC / "by_season_convention_B.csv", index=False)

    # counts that must not be confused
    t3 = cells[cells.source.str.startswith("Stage 3")]
    opt = pd.read_csv(R / "model_tournament/optuna_summary.csv")
    feat = pd.read_csv(R / "features/leaderboard_full.csv")
    counts = {
        "stage3_base_model_variants": int(t3[t3.tag == ""].model.nunique()),
        "stage3_tuned_variants": int(t3[t3.tag == "tuned"].model.nunique()),
        "stage3_ensembles": int(t3[t3.tag == "ensemble"].model.nunique()),
        "stage3_algorithm_libraries": ["statsmodels/scikit-learn GLMs", "LightGBM", "XGBoost", "CatBoost"],
        "stage3_leaderboard_rows": int(len(pd.read_csv(R / "model_tournament/leaderboard_all.csv"))),
        "stage3_scored_cells": int(len(t3)),
        "v3_new_model_variants": len(NEW), "v3_baselines_rerun": len(BASE),
        "hyperparameter_trials": int(opt.trials.sum()), "hyperparameter_trials_by_model": dict(zip(opt.model, opt.trials.astype(int))),
        "stage2_feature_configurations": int(len(feat)), "stage2_feature_models": sorted(feat.model.unique().tolist()),
        "comparison_rows": int(len(out)),
    }
    prov = {p: sha(R / p) for p in ["model_tournament/scores_all_cells.csv", "model_tournament/leaderboard_all.csv", "model_tournament/optuna_summary.csv",
                                    "features/leaderboard_full.csv", "baselines/metrics_summary.csv", "model_comparison/r2_cells_from_cache.csv",
                                    "model_comparison/benchmark_cells.csv", "model_comparison/model_sizes.csv"]}
    (MC / "summary.json").write_text(json.dumps({"counts": counts, "provenance_sha256_16": prov, "diagnostics": diag,
                                                  "r2_cells_matched_from_cache": int(t3.sse_expected.notna().sum())}, indent=1))
    counts["r2_cells"] = int(t3.sse_expected.notna().sum())
    write_md(out, counts, diag, prov)

    # app-facing copies (reports/ is not shipped in the backend image; app_data/ is): convention B only, read-only explorer data
    APP = ROOT / "app_data"
    (APP / "MODEL_COMPARISON.csv").write_bytes((R / "MODEL_COMPARISON.csv").read_bytes())
    keep = ["source", "family", "model", "variant", "variant_tag", "tuning", "feature_set", "window", "horizon", "point_forecast", "mae", "rmse", "r2",
            "bias", "peak_week_mae", "peak_weeks_under_predicted", "zero_week_mae", "outbreak_recall", "outbreak_precision", "false_alert_rate",
            "season_sd_mae", "worst_season_mae", "mae_diff_vs_champion", "seasons_better_than_champion", "model_size_bytes", "fit_seconds",
            "predict_ms_per_1k", "selection_status", "limitations"]
    rowsB = out[out.convention == "B"][keep].copy()
    rowsB["feature_set"] = rowsB.feature_set.str.split(" ").str[0]
    seas = bs[bs.year >= 2019]
    opt_rows = opt[["model", "trials", "complete", "pruned", "best_inner_mae", "glm_inner_mae"]].round(4).to_dict("records")
    app = {"generated_by": "scripts/model_comparison/build_model_comparison.py", "csv": "reports/MODEL_COMPARISON.csv", "report": "reports/MODEL_COMPARISON.md",
           "convention": "B (start of week: weather and cases to t-1), the production convention",
           "models": {f"{r.model}|{r.variant_tag if isinstance(r.variant_tag, str) else ''}": {"family": r.family, "variant": r.variant, "tuning": r.tuning,
                                                                                               "point_forecast": r.point_forecast, "status": r.selection_status}
                      for r in rowsB.drop_duplicates(["model", "variant_tag"]).itertuples()},
           "rows": json.loads(rowsB.drop(columns=["source", "family", "variant", "tuning", "point_forecast", "selection_status"])
                              .assign(limitations=lambda x: x.limitations.where(x.horizon == "2-4 mean")).to_json(orient="records")),
           "by_season": json.loads(seas.drop(columns=["source"]).round(4).to_json(orient="records")),
           "counts": counts, "diagnostics": diag, "provenance_sha256_16": prov,
           "optuna": opt_rows, "feature_configs": {"runs": int(len(feat)), "configurations": int(feat.config.nunique()), "models": sorted(feat.model.unique().tolist()),
                                                    "convention": "A", "best": feat.sort_values("mae_avg").iloc[0][["config", "model", "mae_avg", "n_features"]].to_dict()}}
    (APP / "model_comparison.json").write_text(json.dumps(app, separators=(",", ":"), default=float))
    print(json.dumps(counts, indent=1))


if __name__ == "__main__":
    main()
