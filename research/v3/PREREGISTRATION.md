# V3 research pre-registration (written before any V3 experiment was run)

Date: 2026-11-25. Author: Claude Code (assistant to the DengueShield team), from the protocol in `EDU_HACKATHON_V3_prep/AUDIT.md` §10.
Data: development years 2016–2024 only, through saved out-of-time replay predictions (`app_data/replay.csv.gz`) or
`load_development_panel`. The 2025 holdout is sealed and is not read by any experiment here.
Production artefacts (`models/*.joblib`, replay table, deployed intervals and alert rule) are not modified. A candidate that passes is
reported as a candidate; promotion needs the owner's explicit decision.

## Common protocol

- Target seasons are evaluated one at a time; anything tuned is fitted only on the two preceding seasons' out-of-time predictions
  (Y−2, Y−1). Because replay starts in 2019, the evaluable seasons for E1 and E4 are **2021, 2022, 2023 and 2024** (4 seasons).
- Reported per horizon (2/3/4) and season, pooled over rows.
- 2022–2024 are reported but flagged as seasons that were already used for the original model selection.

## E1: magnitude-dependent interval calibration

Question: can intervals reach their nominal level for positive and peak weeks without inflating every interval?
- Baseline: deployed NB intervals (replay `lo/hi`).
- Candidate: "Mondrian" negative-binomial dispersion per predicted-mean bin. Bins on μ: [0, 0.5), [0.5, 2), [2, 5), [5, 10), [10, ∞).
  For each horizon and bin, α is the smallest value on a log grid (1e-3 … 10) whose NB(μ, α) central interval reaches the nominal
  coverage on the calibration rows of that bin. The point forecast (median) is unchanged.
- Metrics: coverage (all, zero weeks, positive below peak, peaks, ≥ 20 cases), mean width, interval (Winkler) score.
- **Success rule (fixed now):** for a horizon, the candidate passes if, in at least 3 of the 4 seasons, (a) peak 80% coverage improves by
  ≥ 0.05 over the baseline, (b) positive-week 80% coverage is ≥ 0.75, and (c) the mean 80% interval score is not worse than the baseline.

## E4: outbreak-probability calibration

Question: is P(outbreak) calibrated, and does a recalibration help the alert?
- Baseline: deployed probability and alert rule.
- Candidate: isotonic recalibration of P(outbreak) fitted on Y−2, Y−1 (per horizon), applied to Y; alert threshold set so the
  false-alert rate equals the deployed rule's rate on Y−2, Y−1.
- Metrics: Brier score, expected calibration error (10 bins), recall and precision at the calibrated threshold.
- **Success rule:** Brier score lower in ≥ 3 of 4 seasons for the horizon AND recall not lower at a false-alert rate within ±0.01 of the
  deployed rule (pooled over the 4 seasons).

## E2 / E3 (refits; run later)

- E2: ridge-penalised NB2 GLM with peak weighting (weight 1 + λ for y ≥ training q80; λ ∈ {0, 0.5, 1, 2} chosen on Y−2, Y−1).
- E3: conditional projection of unobserved rainfall weeks for h = 3–4 (AR(2) on weekly rain anomalies fitted on training years) instead
  of climatology; first an oracle-rain bound.
- Success rule (from the audit): a gain of ≥ 0.05 MAE or ≥ 5 points of peak coverage in ≥ 5 of 6 outer seasons (2019–2024), with MAE not
  worse by more than 0.02. The champion stays otherwise.
