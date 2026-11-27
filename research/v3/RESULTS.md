# V3 research results (pre-registered in PREREGISTRATION.md)

Run 2026-11-25 with `python research/v3/e1_e4_calibration.py` on saved out-of-time replay predictions (2019–2024). The 2025 holdout was not read.
Production intervals and the alert rule were **not** changed. Raw outputs: `results/e1_intervals.json`, `results/e4_alert.json`; served at
`/api/research/v3` and shown in Model Evidence → Reliability center.

## E1: magnitude-dependent interval calibration — PASS at all three horizons

Mean over the evaluable seasons 2021–2024 (80% level; each season calibrated only on its two preceding out-of-time seasons):

| Horizon | Seasons passing | Peak coverage (baseline → candidate) | Coverage, positive weeks below peak | Mean width (cases) | Interval score (lower is better) |
|---|---|---|---|---|---|
| 2 weeks | 3 / 4 | 0.666 → 0.739 | 0.812 → 0.848 | 2.83 → 3.24 | 5.09 → 4.97 |
| 3 weeks | 4 / 4 | 0.604 → 0.764 | 0.733 → 0.843 | 2.99 → 4.19 | 7.00 → 6.31 |
| 4 weeks | 4 / 4 | 0.607 → 0.790 | 0.689 → 0.834 | 3.25 → 4.74 | 8.48 → 7.33 |

Reading: intervals are wider, but the interval (Winkler) score, which charges for width and for misses, improves in every season, so the extra
width is earned rather than padding. The point forecast is unchanged. Caveats: only four evaluable seasons, three of which (2022–2024) were
also used for the original model selection; dispersion bins are fixed, not tuned. **Status: research candidate; promotion needs the team's
decision**, then a frozen-model evaluation on 2025 if the team wants a blind test.

## E1 verification (hardening pass, 25 Nov 2026) — recommendation: INSUFFICIENT EVIDENCE to promote

Script: `research/v3/verify_e1.py` → `results/e1_verification.json`; tests: `tests/test_e1_intervals.py` (8).

| Check | Result |
|---|---|
| Inputs | `app_data/replay.csv.gz` byte-identical to the submitted baseline (SHA-256 `1f91c317…`); max year 2024; 2025 never read |
| Reproducibility | Re-running the experiment code reproduces `e1_intervals.json` exactly; two runs identical |
| Independent re-implementation | NB quantiles recomputed with the regularised incomplete beta (not `scipy.stats.nbinom.ppf`): same α per bin and same peak coverage in all 12 season × horizon cells |
| Leakage | Each season is calibrated on Y−2, Y−1 only; every calibration outcome is dated before the season's first forecast origin (replay rows never cross a year boundary). A test perturbs 2023+ outcomes and confirms the 2021–2023 calibration does not change |
| Same evaluation rows | Baseline and candidate are scored on the identical rows; the median (point forecast) is unchanged |
| Pre-registration order | `PREREGISTRATION.md` saved 09:53:06, script 09:53:07, results 09:53:13 (same assistant session; the protocol came from `AUDIT.md` §10, 09:35) |

4-week horizon, 80% intervals (the figure quoted in the handoff):

| | Baseline | Candidate |
|---|---|---|
| Peak-week coverage, mean of the four season values 2021–2024 | **0.607** | **0.790** (confirms "0.61 → 0.79") |
| Peak-week coverage, pooled over all 1,300 peak weeks | 0.544 | 0.735 |
| Gain by season (2021, 2022, 2023, 2024) | | +0.175, +0.162, +0.260, +0.134 |
| Pooled gain, 95% ward-cluster bootstrap (2,000 resamples) | | +0.171 to +0.214 |
| Coverage, all positive weeks (pooled) | 0.645 | 0.807 |
| Coverage, all weeks (pooled; nominal 0.80) | 0.825 | 0.906 (over-covers) |
| Mean width (cases) | 3.25 | 4.74 (+46%) |

At 2 and 3 weeks the pooled peak gains are +0.073 (95% CI +0.058 to +0.088) and +0.161 (+0.142 to +0.181). Calibration samples per season and
horizon: 446–807 rows (268–487 peak weeks) in the top μ bin; the [0.5, 2) bin has 0–14 peak weeks.

Why not PROMOTE:

1. **No independent test.** All four seasons are exploratory validation: 2022–2024 were also used to choose the model, and E1 was designed
   after the audit saw peak under-coverage in this same 2019–2024 replay. The only unseen data is the sealed 2025 holdout.
2. **The audit's stricter criterion fails.** `AUDIT.md` §10 asked for 80% coverage within 5 points of nominal in every μ bin. That fails at
   every horizon: low-count bins over-cover (0.92–0.98, which integer intervals cannot avoid) and some bins still under-cover
   (4 weeks: 0.615 for μ in [2, 5) in 2022, 0.663 for μ ≥ 10 in 2021). The pre-registered rule, written later, is the one that passes.
3. **Promotion changes public reliability figures.** Coverage and widths shown in the app would change, which needs the owner's decision.

Why not RETAIN as "no better": gains are positive in all 12 season × horizon cells, bootstrap intervals exclude zero and the interval
score improves everywhere, so the candidate is worth testing properly.

Path to a decision: freeze the dispersion table (fit on 2023–2024), then, only with the owner's explicit approval, score the frozen
candidate and the deployed intervals once on 2025 with the pre-registered rule, and publish the result either way. Until then the deployed
intervals stay, and E1 is shown only as a labelled research candidate (Model Evidence → Reliability center).

## E4: outbreak-probability recalibration — FAIL

Isotonic recalibration fitted on the two preceding seasons lowered the Brier score in 0, 1 and 1 of 4 seasons (h2, h3, h4); pooled recall at a
matched false-alert rate was lower at h2 (0.782 → 0.758) and h4 (0.718 → 0.680). **Conclusion: the deployed probabilities are already about as
well calibrated as this method can make them; the deployed alert stays.**

## E2 / E3: not run (deferred)

Execution plans, compute and leakage checks (prepared, not run): `E2_E3_EXECUTION_PLAN.md`.

E2 (ridge NB2 with peak weighting) and E3 (conditional projection of unobserved rain for 3–4 weeks) need refits on the rolling outer folds.
The fold-fitting infrastructure exists (`dengueshield/evaluation/folds.py`, `GLMModel`), but the development folds helper only exposes
2022–2024 and the outer 2019–2024 refit path was not wired in this session. One deviation to record before they are run: under a ridge,
NB2 mean estimates down-weight high counts (IRLS weights μ/(1+αμ)), which works against the peak goal, so peak weighting should be tested
first on the Poisson GLM. Nothing was run, so no result is claimed.
