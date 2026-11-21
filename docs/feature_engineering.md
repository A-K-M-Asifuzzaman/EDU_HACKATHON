# Feature engineering (Stage 2)

Code: `dengueshield/features/` (pipeline), `dengueshield/evaluation/` (experiments).
Complete per-feature table with availability classes: [`feature_definitions.md`](feature_definitions.md)
(auto-generated from the manifest by `notebooks/04_feature_engineering.ipynb`).
Tests: `tests/test_feature_pipeline.py`, `tests/test_evaluation.py`.

## 1. API

```python
from dengueshield.data import load_development_panel          # 2016-2024; 2025 dropped on load
from dengueshield.features import FeaturePipeline

pipe = FeaturePipeline(wlag=0, clag=0, rain_est="regime")     # availability assumptions
pipe.fit(panel, cutoff="2021-12-31")                          # scalar statistics from rows <= cutoff only
fm = pipe.transform(panel, horizon=3)                         # rows whose target is observed (training matrix)
fm = pipe.transform(panel, horizon=3, origins=[date])         # operational: target may be unknown
fm.X, fm.meta, fm.manifest                                    # features, keys + y_true, auditable manifest
pipe.save(path); FeaturePipeline.load(path)                   # joblib; transform output is bit-identical
```

- Feature construction never touches a model. All operators work on `[ward, week]` NumPy arrays
  (`features/ops.py`); a shift along the week axis cannot cross a ward, so ward isolation holds by construction.
- Full build for all 60 wards × 28k rows × 204 features takes about 0.15 s; one operational origin takes
  about the same (fixed cost of the array build, not of the rows).
- A missing ward-week becomes `NaN` on the full weekly grid, never a silent misalignment.

## 2. Forecast-origin convention (verified and tested)

**Evidence for the label meaning.** The monsoon regime flips between weeks dated 2020-09-28 (dry) and 2021-09-27 (wet), and between
2019-09-23 (wet) and 2019-09-30 (dry): i.e. at ISO week 39/40, not at a calendar-month boundary of the Monday date.
Assigning each week to the month of label + 1…3 days (its midpoint) explains the regime with fewer violations (8) than the label date
itself (10) (`reports/features/tables/date_convention_evidence.csv`). That is the behaviour of a **week-start** label. It is strong
circumstantial evidence, not proof; the file has no metadata.

Availability is therefore a parameter, not a hidden assumption:

| Convention | `wlag` | `clag` | Meaning | Calendar lead to the start of target week |
|---|---|---|---|---|
| **A** end of week | 0 | 0 | issued after week *t* closes; row *t* usable | *h − 1* weeks |
| **B** start of week | 1 | 1 | issued Monday of week *t*; only week *t−1* complete | *h* weeks |
| **C** case delay | 0 | 1 | A, with one-week reporting delay for cases | *h − 1* weeks |

Row *s* is usable at origin *t* iff *s ≤ t − lag*. Convention **A** is the Stage 1 convention and the like-for-like comparison
with the Stage 1 targets; **B and C are the conservative checks** and every selected set is re-scored under both.
`tests/test_feature_pipeline.py::test_origin_availability_boundaries` pins these definitions to exact dates.

## 3. Horizon-aligned rainfall

Rain *k* weeks before the **target** date is `rain_tl{k}`. At origin *t* for target *t + h* it is observed iff
`k ≥ h + wlag`, otherwise it is projected:

| k | h=2 (A) | h=3 (A) | h=4 (A) | h=3 (B) | h=4 (B) |
|---|---|---|---|---|---|
| 2 | observed | **projected** | **projected** | **projected** | **projected** |
| 3 | observed | observed | **projected** | **projected** | **projected** |
| 4 | observed | observed | observed | observed | **projected** |
| 5 | observed | observed | observed | observed | observed |

Projection (`rain_est`, selectable and compared in notebook 05):

- `clim`: mean over **previous years** of city-mean rain in the same week ±2 weeks (up to 10 years back).
- `regime` (default): the same, but averaged only over past years that were in the same regime (wet/dry, fitted threshold) as the
  currently observed 2-week city rain; falls back to `clim` when fewer than 3 matching samples exist.
- `zero`: assume no rain after the origin (the naive alternative).

Past-year statistics are read at lag `52·y − d − s ≥ 46` weeks, so they are strictly before the origin without any fitting.
Every projected column has a companion indicator `rain_tl{k}_obs` (0 = projection) and the set carries `rain_win_nobs` and
`rain_clim_sd_tl3` (across-year spread) as weather-uncertainty indicators. `rain_win` is the weighted mean of target-lags 2–4 with
weights 0.21/0.45/0.34, proportional to the 2016–2021 jointly adjusted GLM coefficients of Stage 1 EDA. Observed future weather is
never substituted; the pipeline refuses to emit names in `PROHIBITED`.

## 4. Fitted statistics (fold-specific)

`FittedStats.fit(grid, cutoff, case_lag)` estimates four scalars from rows inside the training boundary:

| Statistic | Definition |
|---|---|
| `wet_thr` | Otsu split of log1p(weekly rain) separates dry and monsoon weeks (≈ 11 mm on 2016–2021) |
| `rain_hi_thr` | 75th percentile of rain among wet weeks (excess-rainfall reference) |
| `rh_hi_thr` | 75th percentile of weekly humidity |
| `case_hi_thr` | 90th percentile of reported weekly cases (outbreak level) |

Test `test_fitted_stats_depend_only_on_training_window` corrupts every row after the cutoff and asserts identical statistics.
Model-side preprocessing (median imputation, 0.5/99.5% winsorising, standardising) lives in `evaluation/models.py` and is fitted on
the training rows of each fit.

## 5. Families

| Family | Contents (see `feature_definitions.md`) | Origin-safe because |
|---|---|---|
| `calendar` | target-week Fourier harmonics 1–3 (midpoint day of year, leap-year aware), month, ISO week (53→52), monsoon flag, origin-week harmonics | functions of dates known in advance |
| `static` | density, log density, waterlogging, sanitation | constant per ward |
| `rain_lag` | rain lags 0–8, 10, 12 | causal shifts of as-of arrays |
| `rain_roll` | sums/means/max/SD over 2–8 weeks, wet-week frequency, consecutive wet/dry weeks, momentum, acceleration, trend, intensity, excess over `rain_hi_thr`, EWMs with mean age 2/3/4/6 weeks | trailing windows only |
| `rain_align` | `rain_tl{2..5}` + observed flags, `rain_win`, climatology, wet probability, regime, monsoon onset clock | observed or past-year climatology (§3) |
| `temp` | avg/max/min lags, range proxy, rolling mean/SD, anomaly vs past-year climatology, a-priori Gaussian suitability (28.5 °C, SD 4; unvalidated), aligned lags 6–8 | trailing/past-year |
| `humidity` | lags 0–6, rolling mean, anomaly, high-humidity run, aligned lag 2 | trailing/past-year |
| `climate_int` | rain × suitability, rain × humidity, temperature × humidity, humidity × waterlogging | products of origin-safe terms |
| `breeding` | seven rain-memory × suitability × waterlogging × humidity variants (component controls) | products of origin-safe terms; **not** validated entomological indices |
| `vuln` | waterlogging/sanitation/density × rain bases, static pair and three-way products | products of static and origin-safe terms |
| `case` | lags 0–11, sums/max over 2–12 weeks, zero fractions, weeks since a positive week, momentum, acceleration, growth, EWMs, outbreak run/frequency vs fitted q90, weeks since 12-week peak, recovery | shifted by `clag` |
| `hist` | ward's mean/SD for the target week over previous years, previous-year same week, 52-week sum, recent-vs-historical ratio, rain anomaly | past-year reads ≥ 46 weeks back |
| `zero_infl` | historical zero share (ward and city), recent positive indicators, breeding-window activation proxy | past-year / shifted |

Density is **not** population: no per-capita incidence is computed anywhere.

## 6. Availability classification

Every feature carries a class in the manifest, per horizon and convention: 1 observed at origin · 2 derived from observed history ·
3 known in advance · 4 estimated from past-year climatology · 5 prohibited (never constructed: post-origin weather or cases, and the
Stage 1 oracle inputs). Counts under A at h=2/3/4: class 1: 8/7/7, class 2: 153/151/150, class 3: 30/30/30, class 4: 13/16/17
(`reports/features/tables/availability_class_counts.csv`). The Stage 1 `oracle_weather_glm` remains an oracle diagnostic and appears
in no deployable comparison.

## 7. Leakage controls and their tests

| # | Control | Test(s) in `tests/test_feature_pipeline.py` |
|---|---|---|
| 1 | ward isolation of rolling statistics | `test_ward_isolation_across_cities`, `test_own_series_features_ignore_other_wards_in_same_city` |
| 2 | exact target/date alignment | `test_target_alignment` |
| 3 | origin availability boundaries | `test_origin_availability_boundaries` (3 conventions) |
| 4 | horizon-specific rain alignment | `test_horizon_aligned_rain`, `test_projected_rain_is_flagged_and_not_the_future_value` |
| 5 | no future observed weather | `test_features_ignore_everything_unobservable_at_origin` (extreme future values, 3 conventions × 3 horizons × 6 origins incl. year boundaries) and its real-data twin |
| 6 | no future case labels | same, cases set to 999 after the origin |
| 7 | no future-derived climatology | same; `test_every_rain_estimate_mode_is_origin_safe` |
| 8 | rolling window and shift direction | `test_rolling_and_lag_direction`, `test_run_length_and_weeks_since` |
| 9 | no cross-fold fitted-statistic leakage | `test_fitted_stats_depend_only_on_training_window`, `test_fold_statistics_do_not_depend_on_later_years` |
| 10 | no boundary contamination across years | origins on 2022-01-03/10, 2023-01-02 and 2023-12-25 in test 5; `test_fold_masks_respect_training_boundary` |
| 11 | one-week case reporting delay | `test_case_delay_is_applied_independently_of_weather` |
| 12 | earliest observations | `test_earliest_origins_have_missing_long_history_not_errors` |
| 13 | missing ward-week | `test_missing_ward_week_becomes_nan_not_misaligned` |
| 14 | deterministic output | `test_transform_is_deterministic_and_serialisable` |
| 15 | serialised pipeline consistency | same |

**Mutation tests** (`test_invariance_check_detects_*`) plant three leaks (a lag that ignores the availability delay, a centred rolling
window, a climatology that mixes in the following week) and assert that the same invariance checker **fails**, so the origin test is
proven able to detect leakage.
The locked test year: `load_development_panel` drops 2025 on load; `fold_data` raises `PermissionError` for any fold after 2024
(`test_locked_test_year_cannot_enter_feature_development`).
