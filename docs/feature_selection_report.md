# Feature selection report (Stage 2)

Evidence base: `notebooks/04_feature_engineering.ipynb`, `05_feature_ablation.ipynb`, `06_feature_selection.ipynb`;
tables in `reports/features/`. All numbers are mean **Poisson-median MAE over the validation folds 2022, 2023, 2024**
(expanding window from 2016), convention A (end of week) unless stated. The locked 2025 test year was not loaded.

## 1. Protocol

- **Models, fixed in advance:** Poisson GLM (ridge strength chosen *inside every fit* by holding out the last training year;
  median-impute, winsorise 0.5/99.5%, standardise on training rows) and LightGBM, Poisson objective (7 leaves, 400 trees, learning
  rate 0.03; chosen on an inner split of 2016–2021, `model_config.json`). No search used 2022–2024.
- **Point forecast:** the Poisson median of the fitted rate (MAE-optimal under the model). It lowered MAE by 0.049 on average
  versus the mean forecast (`tables/mean_vs_median_mae.csv`) at the cost of a larger negative bias.
- **Families:** F0 Stage 1 features · F1 calendar+static · F2 rain memory · F3 horizon-aligned rain · F4 climate interactions ·
  F5 case history · F6 historical seasonal statistics · F7 all 204 · F8 compact. Incremental (over F1), removal (from F7) and
  family-level forward-step (over F3) ablations; 51 configurations × 2 models × 9 fits = 918 fits in the convention-A table.
- **Decision rule, fixed before the forward step:** add a family to F3 only if, for **both** models, mean MAE improves ≥ 0.01 and
  improves in ≥ 2 of 3 folds. **Differences below 0.1 MAE are inconclusive** unless also sign-consistent across folds, horizons and models.
- **Caveat on multiple comparisons.** 51 configurations were scored on the same three folds; per-configuration "wins" of a few
  hundredths are within selection noise (fold SD of MAE is 0.14–0.21).

## 2. Leaderboard (selected rows; full table `reports/features/leaderboard_full.csv`)

| Config | Model | h=2 | h=3 | h=4 | **Avg** | Fold SD | RMSE (avg) | n feat |
|---|---|---|---|---|---|---|---|---|
| `F3plus_zero_infl` | GLM | 1.069 | 1.128 | 1.434 | **1.210** | 0.158 | 2.391 | 43 |
| `F3_est_clim` | GLM | 1.075 | 1.136 | 1.432 | 1.214 | 0.163 | 2.399 | 38 |
| **`F3_aligned_rain`** | **GLM** | **1.075** | **1.137** | **1.437** | **1.216** | 0.167 | 2.400 | 38 |
| `F8_compact` | GLM | 1.069 | 1.148 | 1.453 | 1.223 | 0.162 | 2.422 | 24 |
| `F3_aligned_rain` | LightGBM | 1.102 | 1.167 | 1.476 | 1.248 | 0.209 | 2.512 | 38 |
| `F8_compact` | LightGBM | 1.099 | 1.164 | 1.488 | 1.251 | 0.210 | 2.518 | 24 |
| `F0_stage1_features` | GLM | 1.103 | 1.229 | 1.546 | 1.293 | 0.157 | 2.581 | 16 |
| `F0_stage1_features` | LightGBM | 1.147 | 1.195 | 1.459 | 1.267 | 0.236 | 2.549 | 16 |
| `F7_combined` (full library) | GLM | 1.082 | 1.201 | 1.543 | 1.275 | 0.184 | 2.523 | 196 |
| `F7_combined` | LightGBM | 1.088 | 1.187 | 1.537 | 1.271 | 0.200 | 2.561 | 196 |
| `F2_rain_memory` | GLM | 1.127 | 1.202 | 1.543 | 1.291 | 0.144 | 2.596 | 59 |
| `F1_calendar_static` | GLM | 1.436 | 1.459 | 1.519 | 1.471 | 0.284 | – | 18 |
| `F1_calendar_static` | LightGBM | 1.488 | 1.519 | 1.550 | 1.519 | 0.283 | – | 18 |

`F3plus_zero_infl` is nominally first, but it is 0.006 MAE ahead of F3 (a 5-feature addition), worse for LightGBM and in only 2 of 3
folds, so the pre-registered rule rejects it. The Stage 1 oracle (reads post-origin weather) is excluded from every row here.

## 3. Does the full 204-feature set win? **No.**

| | GLM | LightGBM |
|---|---|---|
| F7 (all) average MAE | 1.275 | 1.271 |
| F3 (38 features) | **1.216** | **1.248** |
| difference | F3 better by **0.059** | F3 better by **0.023** |

F7 (204 candidates minus 8 algebraic duplicates = 196 features) barely differs from the **Stage 1 feature set** (GLM 1.275 vs 1.293; LightGBM 1.271 vs 1.267), and its GLM takes 3.6 s per fit (F3: 0.38 s) with 5× the features. For the GLM, F3 beats F7 at all three horizons and in all three folds. For LightGBM, F3 is better at h=3 and h=4 but F7 is ahead at h=2 (1.088 vs 1.102) and in 2022 and 2024, so the LightGBM verdict is weaker (0.023, inconclusive). The removal ablation agrees: removing any single family from F7
changes average MAE by at most ±0.036 (`tables/ablation_family_deltas.csv`); the library is redundant, so no family is individually
critical once the others are present. Redundancy evidence: 28 feature clusters at |ρ| ≥ 0.95, 178 of 195 features with VIF > 10,
19 features that are exact copies or constants in every setting.

## 4. Family-level findings (positive **and** negative)

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **H1 horizon-aligned rain with climatological projection** | **Supported.** The only family that matters | gain over F1: F3 +0.255 (GLM) / +0.271 (LightGBM); rain memory F2 +0.181 / +0.233. F3 beats F2 by 0.075 (GLM) and 0.038 (LightGBM); at h=3 by 0.065 and 0.028 |
| Projection strategy for unobserved rain | Plain climatology ≈ regime-adjusted; both > zero-rain > observed-only | avg MAE GLM: clim 1.214 · regime 1.216 · zero 1.235 · observed-only (F2) 1.291. Rain-projection error at h=4: RMSE 34.1 mm (clim), 37.4 (regime), 64.9 (zero). **The hard-regime adjustment I designed did not help**; the simpler estimator is as good (difference inconclusive) and is the recommended default |
| Uncertainty flags (`*_obs`, `rain_win_nobs`, `rain_clim_sd`) | No measurable benefit | F3 without them: 1.216 (GLM), 1.256 vs 1.248 (LightGBM) |
| **H2 ward vulnerability** | Helps over F1 alone, **adds nothing over F3** | `inc_vuln` +0.229/+0.241 over F1, but `F3plus_vuln` −0.001 (GLM), 0.000 (LightGBM) |
| Static attributes | Carry ward level | permutation: removing them costs +0.30 MAE (both models) |
| **H3 calendar + monsoon onset clock** | Calendar essential; onset clock not needed | permutation: calendar family +1.32/+1.34 MAE. `monsoon_started`, `weeks_since_onset` fell below the 0.2% gain cut |
| **H4 recent case history** | **Negative.** Does not help | F5 over F1: −0.019 (GLM) / +0.001 (LightGBM); `F3plus_case`: −0.042 (GLM) / +0.001 |
| Previous-year / ward-season history (F6) | Helps over F1 (+0.061/+0.083), **hurts over F3** | `F3plus_hist`: −0.021 / −0.023; improved in 0 of 3 folds (GLM) and 1 of 3 (LightGBM) |
| Zero-inflation features | Inconclusive | `F3plus_zero_infl`: +0.006 (GLM, 2/3 folds), −0.004 (LightGBM, 0/3) |
| **H5 humidity** | **Negative** | over F1: −0.060 (GLM) / −0.003; `F3plus_humidity` −0.026 / +0.005 |
| Temperature (incl. max/min, range) | **Negative** | over F1: −0.029 / −0.007. Without max/min and with max/min only: no gain either (§ temperature below) |
| Climate interactions | No incremental value over F3 | `F3plus_climate_int` −0.006 / −0.005 |
| Breeding indices (rain memory × suitability × waterlogging × humidity) | **No component helps** | all seven variants vs the control (rain memory only): GLM 1.286–1.333 vs 1.290; LightGBM 1.283–1.296 vs 1.285. The best variant (no temperature term) is only 0.004 better (inconclusive); the full index is worse (1.313 / 1.296) |
| Rain memory beyond aligned rain (lags, rolling sums, EWM) | Hurts once added to F3 | `F3plus_rain_roll` −0.122 (GLM) / −0.020; `F3plus_rain_lag` −0.037 / −0.009 |

**Temperature correction.** Stage 1 called maximum/minimum temperature "avg ± ~5 °C". They are *not* exact copies: the offsets have SD ≈ 1.05 °C
(≈ 600 distinct values) and correlate −0.34; each of max/min is predictable from the average at R² ≈ 0.94–0.95. Redundant but not
deterministic. The Stage 1 documents were corrected, and the ablation measured the value instead of assuming it (none).

**Why the forward step kept nothing.** 0 of 10 families met the rule (`forward_step_decision.csv`): four (humidity, breeding, case history, zero inflation) are positive for one model
and negative for the other, vulnerability is ≈ 0, and the other five are negative for both models. With 19,000–25,000 training rows per fit and 38 aligned-rain features the
GLM is already close to what the signal supports; additional correlated features mostly add variance (an interpretation, not a tested claim).

## 5. Final selection

| Item | Decision |
|---|---|
| Recommended feature set | **F3** (38 features) for GLM and LightGBM; **F8** (24 features) as the compact alternative |
| F8 construction | F3 plus nothing (rule kept no family), then drop features whose training-only LightGBM gain share is < 0.2% in the 9 fold×horizon fits (14 dropped). Costs 0.007 MAE (GLM), 0.003 (LightGBM): within noise, 37% fewer features |
| Families in F8 | calendar 11, rain_align 10, static 3 |
| Horizon-specific sets | **Not justified.** A horizon-specific set would need to beat F8 by ≥ 0.02 for both models at that horizon; none did. One feature set serves h=2,3,4 |
| Best model | Poisson **GLM** with Poisson-median forecast; LightGBM is 0.032 MAE worse on average at identical features |
| Files | `reports/features/selection/features_h{2,3,4}.json`, `F8_features.csv` (generated; the pipeline never reads them) |

Per horizon (GLM / F3): h=2 **1.075**, h=3 **1.137**, h=4 **1.437**. At h=2 F8 is nominally better (1.069); the 0.006 gap is inconclusive.

## 6. Comparison with Stage 1 (Poisson-median GLM benchmark)

| Horizon | Stage 1 MAE | Stage 2 MAE (GLM, F3) | Reduction | Abs. change | Stage 1 RMSE | Stage 2 RMSE |
|---|---|---|---|---|---|---|
| h=2 | 1.094 | **1.075** | **1.7%** | −0.019 | 2.189 | 2.146 |
| h=3 | 1.213 | **1.137** | **6.3%** | −0.076 | 2.398 | 2.225 |
| h=4 | 1.517 | **1.437** | **5.3%** | −0.080 | 3.059 | 2.828 |
| mean | 1.275 | **1.216** | **4.6%** | −0.059 | 2.549 | 2.400 |

- **Every absolute gain is below 0.1 MAE.** By the stated standard they are *potentially inconclusive*; the evidence that they are real
  is consistency: the F3 GLM beats the same GLM on the Stage 1 features in **9 of 9** fold × horizon cells, and the gain is concentrated
  at h=3–4, where the aligned-rain design should matter. For LightGBM the F3 gain over its own F0 holds in 7 of 9 cells (2024 is worse at h=3 and h=4).
- The new pipeline reproduces the Stage 1 inputs within noise (F0 GLM: 1.104/1.229/1.546 vs Stage 1 1.094/1.213/1.537).
- LightGBM at h=2 (1.102) is *worse* than the Stage 1 benchmark (1.094).
- The Stage 1 benchmark already used the Poisson-median forecast, so this is median against median. Stage 1 with the mean forecast was 1.128/1.247/1.578.
  At h=2 features contribute only 0.019 MAE, so **the h=2 improvement is small**.

By year, F3 GLM: 2022 **1.196/1.319/1.573**, 2023 1.144/1.144/1.470, 2024 0.884/0.949/1.268 (h=2/3/4). The early-peaking 2022 season is hardest; 2024 easiest.

## 7. Errors in high-incidence periods and outbreak detection

High-incidence = actual ≥ the training-fold q90 (9 or 10 cases; a data-derived operating point, **not an epidemiological cutoff**); 13.3%
of evaluation rows.

| Model / set | MAE, high weeks | Bias, high weeks | Share under-predicted | MAE, other weeks | Bias, other weeks |
|---|---|---|---|---|---|
| GLM F0 | 4.728 | −3.272 | 76.9% | 0.760 | +0.196 |
| **GLM F3** | **4.276** | −3.172 | 77.0% | 0.742 | +0.251 |
| LightGBM F3 | 4.393 | −3.501 | 77.1% | 0.761 | +0.304 |

Per horizon (GLM F3): high-week MAE 3.91/3.85/4.84 (Stage 1 4.09/4.36/5.40); outbreak **recall 0.62/0.63/0.57** (Stage 1 0.57/0.56/0.52),
**precision 0.80/0.76/0.64**. Every model still **under-predicts about three in four high weeks by roughly 3 cases**: peak magnitude
remains the main unresolved error. Jul–Sep weeks have MAE ≈ 3.1 versus 0.5 in other months. Gazipur is the hardest city
(GLM F3 MAE 1.39 vs 1.16–1.21 elsewhere).

## 8. Interpretability (descriptive, not causal)

- **Training-only gain** (LightGBM, 9 fits): top features `cal_org_monsoon` 39.8% (CV across fits 0.12, stable), `cal_org_cos1` 15.5%, `rain_win` 13.5%
  (CV 1.36, unstable), `rain_tl3` 6.7%, `rain_tl4` 3.1%, `regime_wet_now` 2.6%, `waterlogging` 2.3% (CV 0.01).
- **Validation permutation importance by family** (MAE increase): calendar 1.32 (GLM) / 1.34 (LightGBM), `rain_align` 1.04 / 0.99, static 0.30 / 0.30.
  By horizon for GLM the aligned-rain family drops from 1.27 (h=2) to 1.18 (h=3) to **0.67 (h=4)**: when the key rainfall is not yet observed the model
  relies more on the calendar. This is the direct signature of the future-weather limit.
- **TreeSHAP** (1,500 rows, 2023, h=3): `cal_org_cos1` 0.86, `cal_org_monsoon` 0.50, `cal_tgt_cos1` 0.39, `regime_wet_now` 0.26, `rain_tl3` 0.23.
- **Computation checks (asserted in the notebook):** SHAP contributions + bias equal the raw prediction (max error 6e-15); permuting no column changes MAE by exactly 0;
  permuting every column raises MAE by +3.85; every family's permutation effect is non-negative; one saved leaderboard cell was re-fit from scratch
  and matched to all digits (1.1438775510204082).
- Caveat: calendar features dominate because the series is strongly seasonal. Permuting a family with correlated partners understates
  importance, and importance is not causal. `rain_win` is unstable across folds despite high average gain.

## 9. Forecast-origin convention

| Config (avg MAE) | A end of week | B start of week | C case delay |
|---|---|---|---|
| F3 GLM | 1.216 | **1.341** | 1.216 |
| F8 GLM | 1.223 | 1.332 | 1.223 |
| F0 GLM (Stage 1 features) | 1.293 | 1.438 | 1.280 |
| F3 LightGBM | 1.248 | 1.403 | 1.256 |
| F0 LightGBM | 1.267 | 1.375 | 1.268 |
| F7 GLM | 1.275 | 1.437 | 1.278 |

- **C ≈ A** (within 0.013): a one-week *case* reporting delay costs nothing here, because case history carries almost no signal beyond weather and season.
- **B costs +0.11 to +0.16 MAE** because the most informative rain falls one week later in the data a Monday-morning forecast can see. This is the operational
  price if the week label means week start. The label evidence (`tables/date_convention_evidence.csv`) favours week start, so **B is the realistic
  deployment figure**: F3/F8 GLM at ≈ 1.33–1.34.
- Under B, F3 GLM (1.341) still beats F0 GLM (1.438) by 0.097, but **LightGBM F3 (1.403) is worse than LightGBM F0 (1.375)**. The Stage 1 benchmark was measured under A, so B numbers are not comparable with it.

## 10. Cost

| Item | GLM F3 | LightGBM F3 | GLM F7 | GLM F8 |
|---|---|---|---|---|
| Fit per (fold, horizon), s | 0.38 | 0.46 | 3.61 | 0.28 |
| Predict, ms per 1,000 rows | 0.14 | 1.94 | 0.61 | 0.11 |
| Features | 38 | 38 | 196 | 24 |

Feature construction for all 60 wards and 522 weeks takes 0.13–0.17 s (fixed cost, ~46 MB matrix); one operational origin takes about
the same. Tournament compute: 918 fits in the final table (≈ 14 min of fit/predict time), 1,476 cached fits including superseded runs
(≈ 25 min). Peak process memory: 767 MB in notebook 06, 1.3 GB in notebook 04 (`runtime_by_config.csv`, `feature_engineering_summary.json`).

## 11. Limitations and risks

1. **Only three validation seasons** (fold SD 0.14–0.21 MAE); 2022 dominates the error. Gains below 0.1 are not statistically established.
2. **Selection reused the validation folds** (51 configurations). The 2025 test is the only unbiased check and remains locked.
3. **Origin convention is an inference** from the generator's behaviour, not metadata; under convention B every number worsens by 0.11–0.16.
4. **Peaks are under-predicted** (~3 cases, 77% of high weeks); the Poisson median deliberately trades peak bias for lower MAE.
5. **Synthetic data**: shared weather across wards, constructed temperature bands, regime-step rain. Findings on rain lag 3 may reflect the
   generator; no claim of epidemiological validity. Breeding indices and the temperature-suitability curve are unvalidated hypotheses.
6. **Heavy dependence on calendar**: much of the skill is seasonal knowledge; weather adds 0.26 MAE over calendar + static.
7. LightGBM was configured once (inner split) and **not tuned per feature set**; its comparison with the GLM is not a fair model tournament.
8. Regime-adjusted rain projection did not beat plain climatology; the default `rain_est="regime"` should be revisited (Stage 3 should default to `clim`).
9. Gain importance and permutation importance disagree on some features (`rain_win`), so ranking beyond the top five is weak evidence.

## 12. Stage 3 plan (prioritised)

1. **Re-baseline protocol.** Fix feature sets F3 and F8 (rain_est=`clim`) and evaluate under **A and B** as co-primary metrics. Add
   leave-one-season-out folds over 2017–2024 (nine seasons) for development; keep 2022–2024 results as the reference; 2025 stays locked.
2. **Model tournament** on fixed features: Poisson / negative binomial / Tweedie GLM with spline seasonality; LightGBM/XGBoost/CatBoost
   with Poisson, Tweedie and L1 objectives; two-stage hurdle P(Y>0) × E(Y|Y>0); simple GLM+GBM blend. Score with MAE, RMSE, Poisson deviance
   and high-week bias; use block bootstrap (by season and ward) for confidence intervals, and call differences < 0.05 ties.
3. **Peak correction:** quantile or asymmetric-loss post-processing and calibration of the high tiers; report recall/precision at predefined
   tier thresholds; aim to cut the −3 case bias without raising non-peak error.
4. **Bounded hyperparameter optimisation:** Optuna ≤ 100 trials per model, objective = mean MAE over inner chronological folds *inside the training
   years* (never 2025), with early stopping and a fixed seed; cap compute and cache by (data, config, fold, horizon).
5. **Uncertainty:** conformal or Poisson/NB predictive intervals per ward-week (a stated bonus item), plus tier probabilities.
6. **Deployable path:** joblib bundle (pipeline + model), single-origin inference test, cost notes for `ARCHITECTURE.md`.
7. **One-shot 2025 evaluation** only after the configuration is frozen in Git; report the number as observed.
