# Decision support: reliability, alert policy, time machine, resource planning

> **V3 correction (2026-11-25).** Peak figures in this document (0.607 / 0.740 coverage, 74% under-predicted, bias −3.2) are unweighted means over the 18 season × horizon cells. Pooled over all out-of-time weeks they are 0.573 / 0.707, 77.2% and −3.67. The deployed `nb_coverage` dispersion sits at its grid floor (α = 0.001), so intervals are effectively Poisson; zero-case weeks carry the average coverage. Canonical source: `app_data/metrics_canonical.json`; research follow-up: `research/v3/`. The original text below is kept unchanged.


Code: `dengueshield/decision.py`, endpoints `/api/decision/*` in `dengueshield/api/main.py`, UI in `frontend/components/reliability.tsx`
(Model Evidence → *Reliability center*), `frontend/components/sandbox.tsx` (Response Intelligence), the Command Center verdict row.
Tests: `tests/test_decision.py`, Playwright "reliability center", "resource sandbox", "command center" tests.

**Inputs are only saved artifacts.** `app_data/replay.csv.gz` holds the Stage 3 out-of-time predictions for 2019–2024 (53,100 ward-weeks):
each season was forecast by a model trained on earlier seasons, with dispersion and alert thresholds learned on the two previous seasons. Nothing
here refits the model, changes the deployed alert rule, or reads 2025. The model results are unchanged.

## 1. Forecast reliability center

Per horizon (pooled over 2019–2024 ward-weeks, `/api/model/diagnostics`): MAE, RMSE, bias, alert recall/precision/false-alert rate, 80%/90%
coverage and mean widths, coverage at high-incidence weeks, share of peaks under-predicted, error by outcome size, MAE by season, and a reliability
diagram for P(outbreak). The documented calibration table (`/api/model/calibration`, NB-coverage method, mean over 6 seasons × 3 horizons) is shown
beside it: **80% → 0.854 overall but 0.607 at high-incidence weeks; 90% → 0.911 overall but 0.740 at peaks.** Pooled per-horizon values differ
slightly (for example 0.559 at 80% for 3 weeks) because they weight ward-weeks rather than seasons; both are labelled.

## 2. Outbreak alert policy simulator (retrospective)

Event = actual cases ≥ the training-fold q90. For each threshold τ on a 0.02 grid the explorer counts true alerts, false alerts, missed
outbreaks, flagged ward-weeks, recall, precision, F1 and false-alert rate, optionally for selected seasons. Three reference rows:

| Policy | How the threshold was chosen | 3 weeks, 2019–2024 |
|---|---|---|
| Deployed rule | per season, F1-optimal on the two previous seasons (as validated in Stage 3) | recall 0.758, precision 0.508, F1 0.609, false alerts 9.9% |
| Nested F1 re-selection | per season from the two previous replay seasons only, then applied to that season (2021–2024) | recall 0.765, precision 0.480, F1 0.590 |
| Best in-sample | chosen and scored on the same rows | F1 0.626: **optimistic**, labelled as such |

The deployed row reproduces the published diagnostics exactly (tested). Choosing τ in the explorer and reading its numbers off the same seasons is
optimistic; the interface says so in a warning above the slider and in the comparison table.

## 3. Historical forecast time machine

The Command Center's origin scrubber (with a ▶ play control that steps one week at a time) replays the genuine out-of-time forecast for any validation
origin, ward and horizon. For target weeks up to 2024 a **verdict** row shows the error (actual − median), whether the 80% and 90% intervals covered the
outcome, and whether the alert decision was a correct alert, false alert, missed outbreak or correctly quiet. Replay forecasts were made by models trained
only on earlier seasons; bundle (live-inference) values for ≤ 2024 targets are labelled in-sample. 2025 targets have no actuals.

## 4. Resource planning sandbox

N teams, one per ward, for the target week of a validation origin. Three deterministic rules:

- **equal (risk-blind):** round-robin across cities, wards in ID order;
- **historical risk:** highest mean weekly cases observed *strictly before the origin* (tested to be unaffected by later data);
- **forecast:** highest calibrated outbreak probability at the origin.

Outcome measures are retrospective coverage counts: actual outbreak wards reached and actual cases in the chosen wards. Season view (3 weeks, 10 teams,
share of outbreak ward-weeks reached):

| Season | Equal | Historical | Forecast |
|---|---|---|---|
| 2019 | 17.1% | 22.3% | 22.3% |
| 2020 | 15.9% | 30.1% | 31.0% |
| 2021 | 22.6% | 40.1% | 38.4% |
| 2022 | 17.4% | 27.1% | 27.7% |
| 2023 | 17.0% | 24.1% | 24.3% |
| 2024 | 14.9% | 34.4% | 33.3% |

Both risk-based rules beat the risk-blind spread in every season; forecast and simple history are close and neither wins every season. This is a
planning simulation: it does not estimate prevented infections, real team capacity or clinical benefit.

## 5. Intelligence brief

The Command Center's *Download intelligence brief* writes a self-contained HTML page from data already loaded in the browser (no API or LLM call):
the selected origin and horizon, citywide totals and tiers, the selected ward's forecast and intervals, the top-10 wards, validated MAE by horizon,
calibrated coverage including the peak weakness, model and data provenance, and limitations. All values are HTML-escaped.

## Performance

Alert curve 15 ms; single allocation 8 ms; a whole-season allocation (≈ 50 origins × 3 rules) 375 ms on the development laptop; all cached per query.
