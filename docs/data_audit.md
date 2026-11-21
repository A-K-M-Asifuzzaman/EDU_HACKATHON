# Data audit: organizer dengue dataset

Source of truth: `notebooks/01_data_audit.ipynb`, with machine-readable output in
`reports/audit/audit_summary.json`. The audit reports findings and repairs nothing:
no row is dropped, clipped or imputed anywhere in the project.

## File identity

| Property | Value |
|---|---|
| Original name | `hackathon_preli_dataset - bangladesh_dengue_large_dataset.csv` |
| SHA-256 | `a4088765084a0bcf37b86222e22f89d06ef92ad2ac68a40c8057a21e13703dd7` |
| Size | 2,581,377 bytes |
| Shape | 31,320 rows × 12 columns (matches the brief) |
| Columns | exactly the 12 specified, in the specified order |

`dengueshield.data.load_panel()` re-verifies the checksum, schema and panel regularity on every load.

## Verdict: **PASS.** Structurally clean, evidently synthetic

| Hard check | Result |
|---|---|
| Parse failures (dates, numerics) | 0 |
| Missing or blank values | 0 in every column |
| Fully duplicated rows | 0 |
| Duplicate `(ward_id, date)` keys | 0 |
| Calendar | 2016-01-04 → 2025-12-29, 522 consecutive weeks, all Mondays, no gaps |
| Per-ward regularity | every ward has 522 rows; every step is exactly 7 days |
| Geography | 60 wards: Dhaka North 20, Dhaka South 20, Chattogram 10, Gazipur 5, Narayanganj 5 |
| Ward → city mapping | one city per ward; ward prefixes (DNCC/DSCC/CCC/GCC/NCC) all consistent |
| Cases | non-negative integers, 0 to 41 |

**Static versus time-varying.** `city`, `population_density_sqkm`, `water_logging_risk_index` and
`sanitation_score` are constant within each ward. With only 60 distinct values each, a model can
identify a ward from them, so they act as ward identifiers as much as covariates. Their Spearman
correlations are low: density–sanitation −0.28, density–waterlogging 0.06, waterlogging–sanitation −0.04.

**Physical plausibility.** min ≤ avg ≤ max temperature in every row; rainfall ≥ 0; humidity in
[41.8, 99.0]; average temperature 15.7–37.5 °C; risk indices in [0, 1]. There are 361 ward-weeks
above 200 mm of weekly rain (max 268.8 mm), all in monsoon months, which is plausible for Bangladesh.

## Synthetic-generation fingerprints (documented, not repaired)

1. **Shared weather with ward-level noise.** Every city's weekly mean weather correlates ≥ 0.996
   with the national weekly mean. Within a city-week the spread across wards is small:
   rainfall SD 4.0 mm against 50.1 mm between weeks, temperature 0.58 against 4.45 °C, humidity
   2.4 against 12.8 pp. Ward-level weather differences are therefore mostly noise, not microclimate.
2. **Loosely constructed temperature bands.** `max_temp_c − avg_temp_c` and `avg_temp_c − min_temp_c` both
   have mean ≈ 4.97 °C and SD ≈ 1.05 (about 600 distinct offset values each, range 1.6–8.4 °C), the two
   offsets correlate at −0.34, and corr(avg, (max+min)/2) = 0.98. Max and min are **highly redundant with the
   average (R² ≈ 0.94–0.95) but are not exact copies** of it.
   *Correction (Stage 2): the original Stage 1 text called these "avg ± ~5 °C" and said they add "essentially no
   information". Redundancy is now measured (`reports/features/tables/temperature_redundancy.csv`) and their
   incremental predictive value was tested in the Stage 2 ablation rather than assumed.*
3. **Step-function rainfall regime.** Monthly mean rainfall is about 3 mm from October to March,
   then 16 mm (April), 24 mm (May), and about 94 mm (June–August). The monsoon regime starts
   between April and June but **ends in the last week of September in every year** (Sept 21–27).
   About 40% of dry-season weeks report exactly 0 mm.
4. **Humidity cap.** The maximum is exactly 99.0, and 89 rows sit at that value: a clipping artifact.
5. **Rounding and calendar.** All weather values have 2 decimals and all dates are Mondays.
6. **Balanced zero inflation.** The zero-case share is 58.0% overall and nearly identical across
   wards (SD 0.026), consistent with a common seasonal generator rather than reporting heterogeneity.

**Robust outlier flags** (|value − month median| > 5 × MAD): rainfall 1,091 rows, humidity 193,
max temperature 60. Rainfall flags fall entirely in dry or transition months (Oct–May), where the
median is about 1 mm, so 15–40 mm weeks are flagged. Humidity flags are all in September,
where monsoon and dry regimes mix within one month. These are regime-boundary effects, not errors,
and are kept (`reports/audit/weather_outlier_flags_by_month.csv`).

## Target distribution

| Statistic | Value |
|---|---|
| Zero share | 58.03% (matches brief) |
| Mean / variance | 2.64 / 21.23 |
| Dispersion index (var/mean) | 8.05 marginal, but **2.66 median inside ward × month cells** with mean > 0.5 |
| Total cases | 82,572 |

Most marginal over-dispersion comes from seasonality and ward differences. Conditional on season
and ward it shrinks substantially: an exploratory Poisson model on 2016–2021 had Pearson
dispersion ≈ 1.13 (notebook 02). Zero inflation is largely **structural seasonality**: January–March
and November–December average ≤ 0.06 cases per ward-week.

Descriptive totals by year (all years, from `reports/audit/target_by_year.csv`): 2016 9,151 ·
2017 8,481 · 2018 6,621 · 2019 9,967 · 2020 7,669 · 2021 6,530 · 2022 10,013 · 2023 9,955 ·
2024 6,760 · 2025 7,425. The 2025 figures are shown only for completeness; no decision uses them.

## Consequences for modelling

- Positional lags are safe because the panel is perfectly regular, and `load_panel` asserts this
  on every load. Target alignment still merges on calendar dates, as a second layer of defence.
- `max_temp_c` and `min_temp_c` are highly redundant with `avg_temp_c` (R² ≈ 0.94–0.95) but not duplicates. Stage 2 measured their value: adding temperature features (with or without max/min) to calendar + static did not help (GLM MAE 1.471 → 1.485–1.500; LightGBM 1.519 → 1.517–1.539).
- City-level smoothed weather may beat raw ward weather, because ward deviations are mostly noise.
- Static attributes behave like ward identifiers. A model can memorise ward levels from them,
  which is fine for these 60 known wards but will not generalise to unseen wards.
- Real-world caveat: no reporting delay, under-reporting or serotype dynamics are visible in the
  data. A production system on real surveillance data would need them; see the validation protocol.
