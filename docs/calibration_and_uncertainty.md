# Calibration, uncertainty, alerts and risk tiers (Stage 3)

> **V3 correction (2026-11-25).** Peak figures in this document (0.607 / 0.740 coverage, 74% under-predicted, bias −3.2) are unweighted means over the 18 season × horizon cells. Pooled over all out-of-time weeks they are 0.573 / 0.707, 77.2% and −3.67. The deployed `nb_coverage` dispersion sits at its grid floor (α = 0.001), so intervals are effectively Poisson; zero-case weeks carry the average coverage. Canonical source: `app_data/metrics_canonical.json`; research follow-up: `research/v3/`. The original text below is kept unchanged.


Code: `dengueshield/calibration/` (`intervals.py`, `peaks.py`, `risk.py`). Evidence: `notebooks/08_model_diagnostics.ipynb`;
tables in `reports/model_tournament/` (`interval_*`, `peak_*`, `risk_*`). Champion: ridge Poisson GLM, F8 features,
convention **B**. Every parameter used for outer season *Y* is estimated on seasons *Y − 2* and *Y − 1* only, from their own
out-of-time predictions. Outer seasons: 2019–2024. 2025 is untouched.

## 1. Predictive intervals

| Method | What is learned on the inner seasons |
|---|---|
| `poisson` | nothing (Poisson quantiles of the predicted mean) |
| `nb_moment` | NB2 dispersion α by moments, Σ((y − μ)² − μ) / Σμ² |
| `nb_coverage` | the smallest α whose NB interval reaches nominal coverage on the inner seasons |
| `conformal` | the conformal quantile *q* of \|y − μ\| / √(μ + 1); interval ⌊μ − q√(μ+1)⌋ to ⌈μ + q√(μ+1)⌉ |

**Results, mean over 6 outer seasons × 3 horizons:**

| Method | Level | Coverage | High-week coverage | Zero-week coverage | Width | High-week width |
|---|---|---|---|---|---|---|
| poisson | 80% | 0.854 | 0.605 | 0.980 | 2.99 | 8.12 |
| **nb_coverage (deployed)** | **80%** | **0.854** | **0.607** | 0.980 | **3.00** | 8.17 |
| nb_moment | 80% | 0.912 | 0.759 | 0.985 | 4.22 | 13.09 |
| conformal | 80% | 0.872 | 0.574 | 0.987 | 3.70 | 7.73 |
| poisson | 90% | 0.900 | 0.709 | 0.986 | 3.84 | 10.41 |
| **nb_coverage (deployed)** | **90%** | **0.911** | **0.740** | 0.987 | **4.09** | 11.41 |
| nb_moment | 90% | 0.951 | 0.856 | 0.992 | 5.45 | 16.88 |
| conformal | 90% | 0.938 | 0.736 | 0.996 | 5.24 | 11.67 |

**By horizon (`nb_coverage`):** 80% coverage is 0.888 / 0.850 / 0.825 and 90% coverage is 0.930 / 0.901 / 0.901 for h = 2 / 3 / 4.
Widths grow with horizon: 2.8 / 3.0 / 3.2 cases at 80%, and 3.6 / 4.0 / 4.7 at 90%. That growth is the extra uncertainty from rainfall not yet observed.
**By season (80%):** 0.83 / 0.88 / 0.83 / 0.85 / 0.86 / 0.88 for 2019–2024.

**Choice.** The deployed method is the one closest to nominal on both levels after excluding the uncalibrated Poisson rule; ties go to the narrower method.
`nb_coverage` qualified, and it nests Poisson: at 80% the calibrated dispersion is ≈ 0.001 in every season and horizon, meaning Poisson already
reached nominal on the inner seasons. At 90% it widens slightly for h = 3–4 (α up to 0.088).
The deployed bundle stores α estimated on seasons 2023–2024 only.

**Miscalibration we could not remove.**
- **Coverage is conditional on magnitude.** Zero-case weeks are over-covered (about 98%), while high-incidence weeks are under-covered: 61% at
  the 80% level and 74% at 90%. Intervals are too narrow precisely at outbreak peaks, because the mean is under-predicted there (§2).
  Moment-based NB intervals reach 76% / 86% high-week coverage, but only by being 33–40% wider everywhere.
- **Average coverage is above nominal** (0.85 at 80%), driven by the large share of zero weeks, whose discrete interval [0, 0] or [0, 1] almost always contains them.
- Treat the intervals as **honest on average and optimistic at peaks**. A magnitude-conditional (Mondrian) conformal method is the
  natural next step.

## 2. High-incidence underprediction

High-incidence week = actual ≥ the training-fold q90 (9–10 cases). That is a data-derived operating point, not an epidemiological threshold.
The full method table is in `docs/model_selection.md` §9 and `reports/model_tournament/peak_methods_summary.csv`.

- The champion's median forecast under-predicts **74%** of high-incidence weeks, with mean bias −3.2 cases.
- The **mean** forecast is closer at peaks (bias −3.0), but its overall MAE is worse (1.426 vs 1.365).
- **Training-only corrections all trade ordinary-week accuracy for peak accuracy.**
  - Isotonic recalibration of μ (learned on inner seasons) made peaks *worse*: high-week MAE 4.72.
  - A limited multiplier on predicted means ≥ the training q80 learned factors of 1.00–1.16, with marginal effect: high-week MAE 4.41.
  - Upper-quantile forecasts cut the bias to about −1.9 but raise ordinary-week MAE by 0.19–0.31: Poisson 0.65 quantile, LightGBM quantile α = 0.7.
- **Not deployed as the case forecast**, because "a model that predicts high risk everywhere is unacceptable" and the case count
  is optimised for MAE. Detection is handled separately (§3).

## 3. Outbreak alert (deployed)

Alert if **P_NB(Y ≥ q90) ≥ τ**. The probability uses the bundle's calibrated α, and τ maximises F1 on the two previous seasons.

| Horizon | Recall | Precision | False-alert rate |
|---|---|---|---|
| 2 | 0.784 | 0.602 | 0.061 |
| 3 | 0.777 | 0.506 | 0.098 |
| 4 | 0.763 | 0.473 | 0.134 |
| **mean** | **0.775** | **0.527** | **0.097** |

Against simply alerting when the median forecast ≥ q90 (recall 0.58, precision 0.63, false alerts 4.5%), the probability alert finds about a third more
outbreak weeks, at the cost of about 1.7 extra false alerts per extra true alert (per season × horizon: about 74 more true and 127 more false alerts). A **separately trained severity classifier**
(LightGBM, P(Y ≥ q90), cut tuned the same way) was worse on every detection metric: recall 0.748, precision 0.505, false-alert rate 0.117.
Expected cases, median cases and alert status are reported as separate outputs, so ordinary-week accuracy and outbreak sensitivity are
never conflated.

## 4. Risk tiers

Cut points are q60 / q80 / q95 of each fold's **training** targets: 1, 5–6 and 13 weekly cases for Low < Medium < High < Critical.
**These are statistical categories for this synthetic competition dataset, not clinical, municipal or national warning levels.**

| Tier from | Accuracy | Within one tier | High+Critical recall | High+Critical precision | False alerts (High+) | Revision flips h4→h3→h2 |
|---|---|---|---|---|---|---|
| **median forecast (deployed)** | **0.745** | 0.994 | **0.881** | 0.764 | 0.082 | **0.210** |
| mean forecast | 0.743 | 0.993 | 0.855 | 0.776 | 0.074 | 0.207 |
| upper 80% bound | 0.530 | 0.977 | 0.973 | 0.682 | 0.137 | 0.320 |

**Tier frequencies.**
- Predicted, from the median forecast: Low 54.4%, Medium 18.8%, High 23.1%, Critical 3.6%.
- Actual: Low 55.1%, Medium 21.7%, High 17.3%, Critical 5.9%.
- So Critical is under-assigned, consistent with peak under-prediction.

**Stability.** For about 21% of ward × target weeks, the tier changes as the forecast is revised from 4 to 3 to 2 weeks ahead.
The confusion matrices are in `risk_confusion_*.csv` and figure `05_risk_confusion.png`.

## 5. Uncertainty visualisation

`reports/model_tournament/figures/04_uncertainty_fan_example.png` shows the 3-week-ahead median, the mean, and nested 80%/90% intervals
for the highest-incidence ward in 2024, an outer validation season, against observed cases.
The deployed bundle returns `expected_cases`, `median_cases`, `lower_80`/`upper_80`, `lower_90`/`upper_90`, `p_outbreak`,
`outbreak_alert` and `risk_tier` for every ward, origin and horizon, ready for a dashboard fan chart.
