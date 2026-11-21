# Model selection (Stage 3)

Evidence: `notebooks/07_model_tournament.ipynb`, `notebooks/08_model_diagnostics.ipynb`, and the machine-readable
outputs in `reports/model_tournament/` (`leaderboard_all.csv` has every candidate, convention and window;
`scores_all_cells.csv` has every model × season × horizon cell). All numbers are validation results.
**The 2025 test year has not been loaded** (procedure for its single use: `docs/holdout_protocol.md`).

## 1. Forecast-origin convention

| | Meaning | Usable at origin *t* | Role in Stage 3 |
|---|---|---|---|
| **B** start of week | forecast issued on the Monday that labels week *t* | weather and cases up to week *t − 1* | **primary** |
| A end of week | issued after week *t* closes | up to week *t* | secondary (Stages 1–2 convention) |
| C case delay | A with one-week case reporting delay | weather to *t*, cases to *t − 1* | sensitivity |

Evidence for week-start labels: the monsoon/dry regime switches at ISO week 39/40 (e.g. the week labelled 2020-09-28 is dry
while 2021-09-27 is wet), which matches assigning each week to the month of its midpoint, not of its Monday label
(`reports/features/tables/date_convention_evidence.csv`). This is circumstantial; the organizers have not stated the convention.
Leaderboards for A, B and C are kept separate.

## 2. Validation design

- **Season-level out-of-time predictions.** For each season *s* in 2018–2024 a model is fitted on labels reported by 31 Dec *s − 1*
  and predicts season *s* (origin and target both in *s*). Outer seasons **2019–2024**: 2019–2021 are the new robustness folds,
  2022–2024 the Stage 1/2 benchmark.
- **Nesting.** Anything learned for outer year *Y* uses only seasons before *Y*:
  - ensemble weights use seasons *Y − 2* and *Y − 1*;
  - interval calibration and alert thresholds use the same two seasons;
  - ridge strength and boosting rounds use each fit's own last training year;
  - Optuna tunes on 2019–2021 only, so tuned models are reported on 2022–2024 only.
- **Features frozen:** F3 (38) and F8 (24) from Stage 2, with rain projection `clim`. No new feature search.
- **Point forecast:** the exact median of the predictive distribution (Poisson, negative-binomial or hurdle quantile), never a rounded mean.
  The conditional **mean** is reported separately (expected demand, RMSE).
- **Uncertainty about differences:** paired season-level differences with a t-interval over seasons. With 3–6 seasons these intervals
  are wide and fragile. Differences below 0.05 MAE are treated as tentative.

## 3. Candidates (11 families × 2 feature sets, plus tuned boosters and 9 nested ensembles)

| Family | Models |
|---|---|
| Count GLMs | ridge Poisson (Stage 2 champion), Poisson mean + NB dispersion, Poisson + cyclic splines, NB2 IRLS, Tweedie (p = 1.5) |
| Boosting | LightGBM Poisson / Tweedie / L1, XGBoost Poisson, CatBoost Poisson |
| Zero-inflated | LightGBM hurdle: P(Y>0) × zero-truncated Poisson for positives |
| MAE-oriented | distributional medians for all count models; LightGBM L1 and quantile (α = 0.5) |
| Ensembles | GLM + {LightGBM, XGBoost, CatBoost, hurdle, spline GLM, Tweedie GLM, tuned LightGBM, tuned XGBoost, tuned CatBoost} |

**Failed or disqualified (kept on record):**
- `glm_nb`: the unpenalised NB2 IRLS fit **diverged in the short-history seasons** (season MAE 2.47 in 2018, 1.95 in 2019).
  On 2022–2024 alone it is nominally first (1.322), which illustrates the danger of judging on three seasons.
- `lgbm_l1`: produces a point forecast only, with no predictive distribution, so no intervals or expected cases.

## 4. Leaderboards (convention B, Poisson/NB/hurdle median MAE)

**2022–2024 benchmark: every candidate is nested here (34 rows; the top rows are shown).**

| Model | Features | h=2 | h=3 | h=4 | **Avg** | Season SD | RMSE | High-week MAE | Recall | Precision |
|---|---|---|---|---|---|---|---|---|---|---|
| glm_nb (disqualified) | F3 | 1.095 | 1.385 | 1.486 | 1.322 | 0.217 | 2.654 | 4.780 | 0.53 | 0.69 |
| ens GLM + spline GLM | F3 | 1.109 | 1.411 | 1.486 | 1.335 | 0.187 | 2.653 | 4.625 | 0.57 | 0.69 |
| glm_spline | F3 | 1.113 | 1.409 | 1.486 | 1.336 | 0.190 | 2.653 | 4.634 | 0.56 | 0.69 |
| **glm_poisson (champion)** | **F8** | **1.107** | **1.393** | **1.512** | **1.337** | **0.161** | 2.667 | **4.564** | **0.58** | 0.68 |
| ens GLM + tuned LightGBM | F3 | 1.106 | 1.397 | 1.513 | 1.339 | 0.176 | 2.669 | 4.604 | 0.57 | 0.68 |
| ens GLM + Tweedie GLM | F3 | 1.108 | 1.377 | 1.534 | 1.340 | 0.174 | 2.672 | 4.650 | 0.56 | 0.68 |
| glm_poisson (Stage 2) | F3 | 1.105 | 1.397 | 1.532 | 1.345 | 0.197 | 2.657 | 4.646 | 0.57 | 0.69 |
| glm_tweedie | F3 | 1.099 | 1.377 | 1.566 | 1.347 | 0.223 | 2.709 | 4.958 | 0.51 | 0.70 |
| LightGBM Poisson, tuned | F3 | 1.151 | 1.437 | 1.520 | 1.370 | 0.192 | 2.756 | 4.675 | 0.55 | 0.66 |
| XGBoost Poisson, tuned | F3 | 1.132 | 1.440 | 1.540 | 1.371 | 0.200 | 2.737 | 4.698 | 0.55 | 0.66 |
| CatBoost Poisson, tuned | F3 | 1.162 | 1.428 | 1.576 | 1.388 | 0.235 | 2.785 | 4.691 | 0.57 | 0.64 |
| hurdle (LightGBM) | F8 | 1.134 | 1.438 | 1.600 | 1.390 | 0.202 | 2.789 | 4.611 | 0.59 | 0.63 |

**2019–2024: six seasons. Tuned models and ensembles containing them are excluded, because they saw 2019–2021 during tuning.**

| Model | Features | h=2 | h=3 | h=4 | Avg | Season SD |
|---|---|---|---|---|---|---|
| glm_spline | F8 | 1.119 | 1.360 | 1.506 | **1.328** | 0.180 |
| glm_spline | F3 | 1.123 | 1.377 | 1.502 | 1.334 | 0.189 |
| glm_tweedie | F3 | 1.102 | 1.325 | 1.575 | 1.334 | 0.235 |
| ens GLM + Tweedie GLM | F3 | 1.108 | 1.334 | 1.572 | 1.338 | 0.177 |
| ens GLM + spline GLM | F3 | 1.112 | 1.392 | 1.530 | 1.345 | 0.176 |
| glm_poisson | F3 | 1.111 | 1.385 | 1.594 | 1.363 | 0.186 |
| **glm_poisson (champion)** | **F8** | 1.113 | 1.390 | 1.593 | 1.365 | **0.167** |
| hurdle (LightGBM) | F8 | 1.123 | 1.426 | 1.579 | 1.376 | 0.154 |
| XGBoost Poisson | F8 | 1.126 | 1.440 | 1.580 | 1.382 | 0.159 |
| LightGBM Poisson | F3 | 1.143 | 1.446 | 1.579 | 1.389 | 0.161 |
| CatBoost Poisson | F3 | 1.171 | 1.478 | 1.571 | 1.407 | 0.202 |

Convention A leaderboards are in `leaderboard_all.csv` (A, 2022–2024: Tweedie GLM 1.209, Poisson GLM F3 1.214,
champion 1.226; Stage 1 benchmark 1.094/1.213/1.517 → champion 1.069/1.152/1.459).

## 5. Hyperparameter optimisation

- **Setup:** Optuna TPE (seed 2026) with a median pruner, on the inner seasons 2019–2021 under convention B, F3.
- **Objective:** mean median-MAE over 3 seasons × 3 horizons.
- **Early stopping:** on each fit's last training year, then a refit.
- **Budget rule:** 20 trials, or 15 for CatBoost, extended to 40 only if the best trial beat the GLM's inner objective by ≥ 0.01. All three did.
- **Cost:** about 11 minutes of wall-clock in total (`optuna_run_log.json`).

| Model | Trials (complete / pruned) | Best inner MAE | Untuned GLM | Tuned on 2022–2024 (outer) |
|---|---|---|---|---|
| XGBoost Poisson | 40 (26 / 14) | **1.325** | 1.382 | 1.371 |
| LightGBM Poisson | 40 (21 / 19) | 1.343 | 1.382 | 1.370 |
| CatBoost Poisson | 40 (22 / 18) | 1.350 | 1.382 | 1.388 |
| spline GLM (untuned, reference) | – | 1.331 | – | 1.336 |

**Tuning gains did not transfer.** Each tuned booster beat the plain GLM by 0.03–0.06 on the inner seasons, but on 2022–2024 they were
0.025–0.05 behind the Poisson GLMs (Stage 2 F3: 1.345; champion F8: 1.337). The spline GLM, which had no tuning at all, was as good as the best tuned booster on the inner seasons.
This is the selection-bias pattern the nested design was built to expose. No further tuning was justified.

## 6. Ensembles

Weights were learned on the two preceding seasons, on a grid of 0, 0.1, …, 1. They were **unstable**: the GLM's weight ranges from 0 to 1 across seasons and horizons for most pairs.
The best ensemble on 2022–2024 (GLM + spline, 1.335) is 0.002 ahead of the champion. On 2019–2024, GLM + Tweedie is 0.025 ahead, with
a season-level 95% interval of −0.071 to +0.021. No ensemble clears the 0.05 bar, and none beats its best member consistently.

## 7. Champion

**Rule, fixed before the tuned and ensemble results were inspected:**
1. Eligible candidates are nested under B on 2022–2024, have no failed fits, and have a predictive distribution.
2. Shortlist every candidate within 0.05 of the best average MAE, which must also hold on 2019–2024.
3. Pick the simplest shortlisted model: plain Poisson GLM, then other GLMs, then ensembles, then boosting. Break ties by fewer features, then MAE.
4. A per-horizon override is allowed only if a candidate beats the pick by ≥ 0.05 at that horizon on both windows.

**Result: ridge Poisson GLM on F8 (24 features), one model per horizon (2, 3, 4) with the same specification.**

- On 2022–2024 it is 0.002 MAE behind the best eligible candidate; on 2019–2024 it is 0.037 behind (spline GLM F8). Both gaps are inside the tentative band.
- It has the **lowest season-to-season variability** of the GLM shortlist (SD 0.161 / 0.167) and the **best high-incidence error and recall**
  among the GLMs on both windows (2019–2024: high-week MAE 4.43, recall 0.58).
- It is the simplest and fastest model: 24 features, about 0.4 s to fit, sub-millisecond prediction, and additive per-driver explanations.
- No per-horizon override qualified. At h=3 the Tweedie GLM is 0.065 better on 2019–2024 but only 0.016 better on 2022–2024.
- Alternatives worth re-testing if the convention or data change: the cyclic-spline GLM (best on 2019–2024) and the
  GLM + Tweedie ensemble (most consistent paired gain: 5 of 6 seasons better).

**Champion validation (convention B)**

| Horizon | MAE 2022–24 | MAE 2019–24 | RMSE 2022–24 | MAE of mean | High-week MAE | Recall | Precision | False-alert rate |
|---|---|---|---|---|---|---|---|---|
| 2 | 1.107 | 1.113 | 2.221 | 1.161 | 3.934 | 0.624 | 0.771 | 0.024 |
| 3 | 1.393 | 1.390 | 2.794 | 1.447 | 4.864 | 0.552 | 0.635 | 0.043 |
| 4 | 1.512 | 1.593 | 2.988 | 1.595 | 4.895 | 0.557 | 0.630 | 0.046 |

(Recall and precision here use the median forecast ≥ training q90. The deployed probability alert is in §9 and
`docs/calibration_and_uncertainty.md`.)

Per season (average of h = 2, 3, 4): 2018 1.091 · **2019 1.581** · 2020 1.176 · 2021 1.423 · **2022 1.470** · 2023 1.383 · 2024 1.159.

## 8. Stage 2 → Stage 3

| Convention | Horizon | Stage 2 GLM F3 | Stage 3 champion | Change |
|---|---|---|---|---|
| B | 2 / 3 / 4 | 1.104 / 1.397 / 1.532 | 1.107 / 1.393 / 1.512 | +0.2% / −0.3% / −1.3% |
| A | 2 / 3 / 4 | 1.075 / 1.136 / 1.432 | 1.069 / 1.152 / 1.459 | −0.6% / +1.4% / +1.8% |

**Stage 3 did not find a model that is reliably more accurate than the Stage 2 Poisson GLM.** The best candidates are 0.01–0.04
better on one window and not the other. The improvements Stage 3 does deliver are:
1. A validated picture of model robustness over six seasons.
2. The realistic origin convention as the primary score.
3. Calibrated intervals.
4. A validated outbreak-alert rule with much higher recall: 0.78 against 0.58 for the median rule.
5. A deployable, tested bundle.

The Stage 2 published figures (A: 1.075/1.137/1.437; B average 1.341) used the `regime` rain projection. Re-run with `clim`, they
are A 1.075/1.136/1.432 and B average 1.345.

Against the Stage 1 benchmark (A: 1.094/1.213/1.517), the champion is −2.3% / −5.0% / −3.8% under A. Every absolute difference is under 0.1.

## 9. High-incidence underprediction (B, 2019–2024; details in `docs/calibration_and_uncertainty.md`)

| Method | Overall MAE | Ordinary-week MAE | High-week MAE | High-week bias | Recall | Precision | False-alert rate |
|---|---|---|---|---|---|---|---|
| median forecast (deployed count) | **1.365** | **0.906** | 4.425 | −3.21 | 0.58 | **0.63** | **0.045** |
| mean forecast | 1.426 | 0.988 | 4.345 | −3.04 | 0.55 | 0.64 | 0.040 |
| learned multiplier on large predictions | 1.404 | 0.950 | 4.407 | −2.85 | 0.61 | 0.61 | 0.052 |
| isotonic recalibration | 1.471 | 0.938 | 4.719 | −3.69 | 0.56 | 0.62 | 0.051 |
| Poisson 0.65 quantile | 1.470 | 1.094 | 3.981 | −1.96 | 0.71 | 0.57 | 0.069 |
| LightGBM quantile α = 0.6 | 1.419 | 1.016 | 4.111 | −3.31 | 0.66 | 0.55 | 0.067 |
| LightGBM quantile α = 0.7 | 1.540 | 1.220 | **3.645** | −1.94 | 0.77 | 0.51 | 0.094 |
| **deployed alert: P_NB(Y ≥ q90) ≥ tuned cut** | – | – | – | – | **0.78** | 0.53 | 0.097 |
| separate severity classifier | – | – | – | – | 0.75 | 0.51 | 0.117 |

No correction lowers peak error without raising ordinary-week error. Only the asymmetric/quantile forecasts substantially cut the
high-week bias, and they cost 0.11–0.31 MAE on ordinary weeks. The deployed design therefore keeps the **median** as the case
forecast, reports the **mean** for resource planning, and issues a separate **probability alert** tuned on prior seasons.
That alert detects 78% of high-incidence weeks at a 9.7% false-alert rate. A separate severity classifier was worse on recall,
precision and false alerts alike.

## 10. Cost

- **Screening:** 1,029 season fits in 386 s.
- **Tuning:** Optuna 654 s.
- **Notebooks:** 07 re-run (cached) about 45 s; notebook 08 about 80 s.
- **Champion:** about 0.4 s per fit.
- **Bundle prediction:** about 130 ms per call, for one ward or all 60 wards. It is dominated by building the feature arrays for the whole history.
- **Bundles on disk:** 11 KB each.

## 11. Interpretability (descriptive, not causal)

Grouped permutation importance on the outer seasons, convention B: the MAE increase when a feature group is shuffled.

| Group (champion, permuted jointly) | h=2 | h=3 | h=4 |
|---|---|---|---|
| calendar (seasonality) | 1.28 | 1.58 | 2.08 |
| **all weather** (rain observed or projected, climatology, regime) | **1.05** | **0.41** | **0.13** |
| ward vulnerability (density, waterlogging, sanitation) | 0.29 | 0.25 | 0.22 |

- **Weather matters only while it has been observed.** Under convention B, target-lag-3 rain is observed only at h=2. At h=3 and
  h=4 it is a climatological projection, and weather's contribution falls from 1.05 to 0.13 while calendar rises from 1.28 to 2.08. The 4-week forecast is
  essentially "season × ward level". This is the clearest Stage 3 explanation of why h=3–4 errors stay high.
- **Rain at target-lag 3 remains the dominant weather signal where it is observed.** At h=2 the twin pair (`rain_tl3` + `rain_clim_tl3`)
  alone costs 0.39 MAE when permuted. LightGBM gives similar weight to rain lags 2–5 and the climatology at h=2 (0.35–0.45 each).
- **Ward vulnerability** is a stable level effect: 0.21–0.34 in every season. Waterlogging has a positive standardised GLM coefficient (+0.21).
- **Stability of rankings across seasons:** mean Spearman correlation of group rankings between seasons is 0.44 for the champion and 0.60 for LightGBM.
- **TreeSHAP (LightGBM, 2024, h=3):** the top features are `cal_org_cos1` 1.01, `cal_org_monsoon` 0.53, `cal_tgt_cos1` 0.39, `weeks_since_onset` 0.11 and
  `rain_win` 0.09 (additivity verified to 1e-6).
- **Synthetic-data caveat.** The rigid monsoon calendar (the regime ends at ISO week 40 every year) and nationally shared weather are
  generator properties. High calendar importance reflects that construction, not a finding about dengue biology.

**Fragility found and recorded.** Single-group permutations exposed exact linear dependencies in F8:
- `rain_win` is a fixed weighted sum of `rain_tl2/3/4`;
- under B at h ≥ 3, `rain_tl3` equals `rain_clim_tl3`.

In 2021 the in-fit ridge choice was 1e-4, and permuting `rain_tl3` and its twin out of step with `rain_win` raised MAE by 95.6.
In every other season the effect is at most 0.97. Validation scores are unaffected, because the pipeline computes all features from raw data,
so the identities always hold. The deployed B bundle selected α = 1e-4 / 0.3 / 3.0 (h = 2/3/4) with |coefficients| ≤ 0.89.
A stability rule for the ridge choice (strongest α within 1% of the best) was tested and rejected: no gain, and worse under A
(`ridge_stability_rule_experiment.csv`). Recommended fix for a later stage: drop exactly dependent features, or set a minimum penalty,
re-evaluated nested.
