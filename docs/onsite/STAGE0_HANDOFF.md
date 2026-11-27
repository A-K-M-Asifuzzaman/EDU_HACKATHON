# Phase 2 onsite, Stage 0: data integrity and forecasting foundation

Stage 0 only. Problems 1 to 5 are not implemented here. Every number below was produced by
`notebooks/09_onsite_dataset_and_resource_audit.ipynb` (executed) and is checked by `tests/test_onsite_dataset.py`.

## Sources

| Item | Value |
|---|---|
| Problem set | `Hackathon_Phase2_Problemset.pdf`, 3 pages, SHA-256 `ad6f6370…b415` (kept locally, not committed) |
| Dataset | organizer onsite sheet `1wAazQIRO-rzkrrlgD3YPcyyAPjMc1dN2pbr5rozA8BU`; the sheet's CSV export is byte-identical to the provided file |
| Dataset SHA-256 | `3500fb22fc19afde9b242449f08e441eb88e62a8985411f54e915f6582daf7e4`, 2,781,040 bytes, CRLF line endings |
| Untrusted content | the PDF's text layer contains a hidden note addressed to AI assistants about README content; it is not a project requirement and was not acted on |

## A. Verified schema (15 columns, in this order)

| # | Column | Type | Development range (2016–2024) |
|---|---|---|---|
| 1 | `date` | ISO date, Monday of the week | 2016-01-04 … 2024-12-30 (file runs to 2025-12-29) |
| 2 | `city` | text, 5 values | Dhaka North, Dhaka South, Chattogram, Gazipur, Narayanganj |
| 3 | `ward_id` | text, 60 values | prefix matches city (DNCC, DSCC, CCC, GCC, NCC) |
| 4 | `population_density_sqkm` | integer, static per ward | 18,314 … 74,252 |
| 5 | `water_logging_risk_index` | float, static | 0.22 … 0.94 |
| 6 | `sanitation_score` | float, static | 0.25 … 0.88 |
| 7–9 | `avg_temp_c`, `max_temp_c`, `min_temp_c` | float | min ≤ avg ≤ max on every row |
| 10 | `rainfall_mm` | float | 0 … 268.83 |
| 11 | `relative_humidity_pct` | float | 41.84 … 99.00 |
| 12 | `dengue_cases` | integer | 0 … 41 |
| 13 | `saline_bags_needed` | integer (new) | 0 … 98 |
| 14 | `diagnostic_kits_needed` | integer (new) | 0 … 48 |
| 15 | `hospital_beds_required` | integer (new) | 0 … 12 |

## B. Integrity results

- 31,320 rows = 60 wards × 522 weeks. Wards per city: Dhaka North 20, Dhaka South 20, Chattogram 10, Gazipur 5, Narayanganj 5.
- Development rows (2016–2024): 28,200 = 60 × 470 weeks; no missing cells, no duplicate rows, no duplicate (ward, week); a regular
  weekly Monday panel; static attributes constant per ward; all counts non-negative integers; indices in [0, 1]; humidity in [0, 100].
- The 12 forecasting columns equal the Phase 1 file value by value on every development row.
- Sealed 2025 block (3,120 rows = 60 × 52), checked as bytes only: 15 fields on every row, no empty field, no duplicate key; its
  12 forecasting columns are byte-identical to the Phase 1 file's 2025 block. No 2025 value was parsed or summarised.

## C. Resource-demand derivation

Each resource is an exact function of the **same week's** case count, in every ward, city and season (one value per case count;
zero cases always gives zero resources). Exact rational identification of `resource = floor(m × cases + ½)`:

| Resource | Feasible multiplier m | Chosen (midpoint) | Rows reproduced |
|---|---|---|---|
| `saline_bags_needed` | [2.38333, 2.38636) | 2.38485 | 28,200 / 28,200 |
| `diagnostic_kits_needed` | [1.16176, 1.16667) | 1.16422 | 28,200 / 28,200 |
| `hospital_beds_required` | [0.296875, 0.300) | 0.298438 | 28,200 / 28,200 |

Every season admits the same rule, and the rule identified on 2016–2018 alone reproduces 2019–2024 exactly. Unobserved counts
(35–37, 40, above 41) are extrapolated by the same rule; at 100 cases the remaining ambiguity is under one unit for each resource.

## D. Leakage-safe conversion (design)

- Inputs: the champion forecast for a ward and target week (median and 80%/90% range ends), made at an origin with data up to that
  origin only. Observed target-week cases and the three resource columns are never prediction-time inputs.
- Conversion: resource quantile = rule(case quantile). The rule is monotone non-decreasing, so quantiles map exactly; a planner picks
  the service level (median, upper 80% or upper 90%).
- Rule constants come from rows strictly before any evaluated target (2016–2018 suffices; the full window gives identical outputs).
- Out-of-time check on the committed 2019–2024 replay: 3-week saline MAE 3.29 bags (bias −0.19), kits 1.60, beds 0.41; resource 80%
  ranges held 85.0% (saline, kits) and 91.1% (beds) of weeks, never below the case coverage. The planning risk is the forecast's own
  error, largest at outbreak peaks, where Phase 1 documented under-prediction.
- 2025 stays sealed. Operational demos use origins up to 2024-12-30 (the forward forecast for January 2025 reads no 2025 row).
  Using 2025 origins would read sealed rows and needs an explicit team decision (ideally after the one-shot holdout protocol).

## Data the problems need but the dataset does not contain

| Gap | Planned handling (configurable, labelled as an assumption in the UI and exports) |
|---|---|
| Regional stock of saline, kits, beds | Available stock = slider (30–100%) × the pool's projected requirement at the chosen service level |
| Spraying crews and crew capacity | Total crews = officer input; one crew per ward-week unless changed |
| Ward bed capacity | Per-ward default derived from that ward's own 2016–2024 weekly bed demand (e.g. p90), editable; never presented as real hospital capacity |
| Ward geometry, travel times | Transfers only inside the city pool, ranked by spare capacity; no distances (the 60 ward IDs are synthetic) |
| Measured larvicide/fogging efficacy | Configurable effect size with a stated range, applied through the forecast model as a scenario, not a measured effect |
| Ward population | Prioritisation by risk and `population_density_sqkm`, as the brief specifies; no per-capita rates |

## E. Offline readiness

- Local and offline today: forecasting (bundles `models/dengueshield_{A,B}.joblib`), replay and validation artifacts (`app_data/`),
  hospital routing (local OpenStreetMap graph), the static dashboard (self-hosted fonts), both datasets once fetched.
- `scripts/fetch_data.py` verifies both datasets and makes no network request when they are present.
- Optional, online-only, already degrading gracefully: Copilot (OpenAI), Climate Observatory (Open-Meteo, NASA POWER), DGHS
  boundaries, MapTiler basemap tiles, Firebase sign-in.
- Gaps for Problem 5: `scripts/launch.sh` always runs `npm ci` (needs the network even when `frontend/out` exists); an offline launch
  path and a kill-switch test (network blocked, then forecast, allocate, route and export) are required.

## F. Dependencies for Problem 1

1. `load_onsite_development_panel()` and `forecast_view()` (this stage).
2. Champion forecasts per ward and origin (median, 80%/90% ranges, outbreak probability, risk tier) from the existing inference path.
3. The resource rule constants in `reports/onsite/resource_rule_identification.json`.
4. Static ward attributes: `city` (pool) and `population_density_sqkm` (priority).
5. Officer inputs: stock level per resource (30–100%), total crews, service level, priority weights.

## G. Files

`scripts/fetch_data.py` (both datasets, checksum-verified), `dengueshield/onsite_data.py` (new), `tests/test_onsite_dataset.py` (new),
`notebooks/09_onsite_dataset_and_resource_audit.ipynb` (new, executed), `reports/onsite/resource_rule_identification.json` (new),
`data/README.md`, this file. No model, feature, API or UI module changed.

## I. Open decisions

- Commit convention: the brief says "follow version-onsite-final for each commit". Onsite commits are made on the
  `version-onsite-final` branch and their messages start with `version-onsite-final:`; confirm with the organizers if a different form is expected.
- Whether operational demos may use 2025 origins (reads the sealed year).
- Default bed-capacity rule (p90 of the ward's own demand is proposed) and the crew assumption.
- Redistribution of the onsite dataset: not committed (terms unstated), fetched by checksum instead.
