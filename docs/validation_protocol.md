# Validation and leakage-prevention protocol

Implemented in `dengueshield/validation.py` and `dengueshield/baselines.py`, enforced by
`tests/test_temporal_invariants.py`, and exercised in `notebooks/03_validation_and_baselines.ipynb`.

## 1. Forecast problem

For ward *w*, forecast origin *t* (a week date), and horizon *h* ∈ {2, 3, 4} weeks:

```
y(w, t, h) = dengue_cases(w, t + h·7 days)
```

- **Alignment** is by calendar date per ward (`forecast_frame` merges on `(ward_id, target_date)`
  with `validate="one_to_one"`). It never uses a positional shift of the target. Origins whose
  target lies beyond the data are dropped.
- **Information set at origin *t*:**
  - case counts for weeks ≤ *t* − `report_lag` (default 0; sensitivity at 1, see §6);
  - weather for weeks ≤ *t*;
  - static ward attributes;
  - the calendar date of the target week, which is known in advance.
- **Not allowed:** observed weather after *t*, case counts after *t* − `report_lag`, or any
  statistic computed over periods that include them. A future what-if weather interface, if
  added, must label its inputs as hypothetical and keep them separate from observed history.

**Assumption.** A row dated *t* (a Monday) is treated as the complete week labelled *t*, observable
at the origin. The dataset does not say whether the date is a week start or week end, and has no
reporting-delay metadata. `report_lag=1` is the conservative alternative.

## 2. Chronological folds (expanding window)

| Fold | Fit cutoff (labels reported by) | Evaluation rows | Role |
|---|---|---|---|
| `val_2022` | 2021-12-31 | origin **and** target in 2022 | model selection |
| `val_2023` | 2022-12-31 | origin and target in 2023 | model selection |
| `val_2024` | 2023-12-31 | origin and target in 2024 | model selection |
| `test_2025` | 2024-12-31 | origin and target in 2025 | **locked**: one final run only |

The initial protocol (train 2016–2021, rolling validation 2022–2024, test 2025) is kept unchanged.

Fold rules and why each one exists:

- **Training rows:** `target_date + report_lag weeks ≤ cutoff` and origin year ≥ 2016. Every training
  label had been reported when the model was fitted.
- **Evaluation origin inside the evaluation year.** The model is fitted on 31 December, so every
  evaluation origin comes strictly after every label used in fitting. If evaluation were defined
  by target year alone, early-January targets would have December origins *before* the cutoff,
  and the fitted model would include labels from after those origins.
- **Evaluation target inside the evaluation year.** This prevents `val_2024` from reading January
  2025 labels, which belong to the locked test year.
- **Expanding windows:** each fold refits from 2016. Parameters stay frozen through the evaluation
  year, while features update with observed history, as they would in operation.
- `folds()` excludes 2025 unless `include_test=True`. No Stage 1 code passes that flag.

Sample counts (`reports/baselines/fold_sizes.csv`; 60 wards):

| Fold | h | n_train | n_eval | first eval target | last eval target |
|---|---|---|---|---|---|
| val_2022 | 2 / 3 / 4 | 18,660 / 18,600 / 18,540 | 3,000 / 2,940 / 2,880 | 2022-01-17 / 01-24 / 01-31 | 2022-12-26 |
| val_2023 | 2 / 3 / 4 | 21,780 / 21,720 / 21,660 | 3,000 / 2,940 / 2,880 | 2023-01-16 / 01-23 / 01-30 | 2023-12-25 |
| val_2024 | 2 / 3 / 4 | 24,900 / 24,840 / 24,780 | 3,060 / 3,000 / 2,940 | 2024-01-15 / 01-22 / 01-29 | 2024-12-30 |

Because origin and target must share a year, longer horizons evaluate h fewer January weeks.
Those weeks have almost no cases (January mean ≈ 0.01 per ward-week), so horizon comparisons are barely affected.

## 3. Leakage controls

| Risk | Control | Test |
|---|---|---|
| Random split | none exists; only `folds()` / `split()` | `test_folds_are_chronological_and_disjoint` |
| Future labels in training | `target_date + report_lag ≤ cutoff < first eval origin` | same, for report_lag 0 and 1 |
| Train/eval duplicates | no shared `(ward, origin, h)` or `(ward, target_date)` | same |
| Misaligned multi-horizon targets | merge on calendar date; `target − origin = 7h` days | `test_target_alignment_is_by_calendar_date_within_ward`, plus a 5,000-row real-data check in notebook 03 |
| Lags crossing ward boundaries | all shifts are `groupby("ward_id")`; panel regularity asserted at load | `test_lags_never_cross_ward_boundaries`, `test_irregular_panel_is_rejected` |
| Features peeking past the origin | origin-keyed features; seasonal average uses weeks ≥ 51 before the target | `test_predictions_ignore_everything_after_origin`: scrambling all unreported cases and post-origin weather leaves every model's forecast unchanged. Mutation-checked: planting a one-week case leak or a future seasonal term makes it fail |
| Reporting delay | `report_lag` parameter end to end | `test_report_lag_hides_latest_count` |
| Preprocessing fitted on all years | scaler and GLM fitted inside each fold on training rows only (sklearn pipeline) | by construction in `baselines._glm` |
| Thresholds from evaluation data | outbreak and tier thresholds = quantiles of each fold's training targets | `test_thresholds_and_tiers_use_training_values_only` |
| Test-set tuning | 2025 opt-in only; EDA relationship analyses restricted to 2016–2021; 2025 never loaded in EDA | `test_locked_test_year_is_opt_in` |

**Disclosed exposure.** Before the protocol was frozen, one exploratory Poisson GLM was fitted on
2016–2021 and scored on 2022–2024 to size the Poisson noise floor (about 0.83 MAE if the true rate
were known). No feature selection followed from it. The data audit reports descriptive 2025 totals
and zero share for integrity only.

## 4. Metrics (`dengueshield/metrics.py`)

- **Primary:** MAE. **Secondary:** RMSE, mean Poisson deviance (predictions floored at 0.01, so
  hard-zero point forecasts are heavily penalised), and bias (mean of prediction − actual).
- **Under-prediction:** share of rows with prediction < actual, and mean shortfall.
- **Slices:** zero-case rows, positive rows, high-incidence rows (actual ≥ training q90), each
  city, each ward, each horizon, and each fold.
- **Outbreak detection:** actual ≥ q90 versus predicted ≥ q90, with precision, recall and F1.
- **Risk tiers:** Low < q60 ≤ Medium < q80 ≤ High < q95 ≤ Critical, using the training-target
  quantiles of each fold. For 2016–2021 these are 1, 5 and 13 cases, with outbreak at 9. These are
  data-derived operating points for this synthetic dataset, **not** official epidemiological cutoffs.
- Report each fold separately and the mean ± SD across folds. With only three seasons,
  differences smaller than the fold SD (about 0.1–0.2 MAE) are not decisive on their own.

## 5. Model-selection rule for Stage 2

1. Choose models, features and post-processing (for example a median vs mean point forecast) on
   mean validation MAE across the three folds, per horizon. Break ties with high-incidence MAE
   and outbreak recall.
2. Freeze the configuration and record it in Git.
3. Refit on all labels reported by 2024-12-31 and evaluate **once** on `test_2025`. Report that
   number as it comes out; do not iterate on it.

## 6. Reporting-delay sensitivity (baselines)

| h | Model | MAE, lag 0 | MAE, lag 1 |
|---|---|---|---|
| 2 | last_known | 2.142 | 2.379 |
| 2 | poisson_glm | 1.128 | 1.126 |
| 4 | moving_avg_4 | 2.777 | 3.069 |
| 4 | poisson_glm | 1.578 | 1.559 |

Pure case-history baselines degrade with a one-week delay. The GLM does not, because its skill
comes from observed weather lags. A production system on real surveillance data should still
default to `report_lag ≥ 1`.
