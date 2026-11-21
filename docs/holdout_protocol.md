# One-shot 2025 holdout evaluation: procedure (NOT yet executed)

The 2025 rows of the organizer dataset have never been used for training, tuning, feature selection, calibration,
diagnostics or plots. Development code reads data only through `load_development_panel()`, which drops 2025 on load;
`season_fold(2025)` and `fold_data(...)` for 2025 raise `PermissionError`; source-scan tests forbid `load_panel(` and
`TEST_YEAR` in the development packages (`tests/test_lock_and_reproduction.py`).

**This procedure may be run once, only after an explicit instruction from the team, and only after the configuration below
is frozen in a Git commit.**

## Frozen configuration (must be committed first)

- Feature pipeline version and feature lists (`reports/model_tournament/champion.json`, `docs/feature_definitions.md`).
- Champion model and hyperparameters per horizon (`champion.json`), convention **B** primary, **A** secondary.
- Deployable bundles `models/dengueshield_B.joblib` and `models/dengueshield_A.joblib`, trained on labels reported by
  2024-12-31, with their SHA-256 recorded in `reports/model_tournament/diagnostics_summary.json`.
- Interval method and alert thresholds stored in the bundles (estimated on seasons 2023–2024 only).

## Procedure

1. Record the commit hash of the frozen configuration and the bundle SHA-256 values. Verify that `git status` is clean.
2. Load the full panel with `dengueshield.data.load_panel()` (the only place it is allowed), confirm the dataset SHA-256
   `a4088765…3dd7`, and keep rows ≤ 2025-12-29.
3. For each convention (B, then A) and horizon *h* ∈ {2, 3, 4}: for every 2025 origin *t* whose target *t + h* lies in 2025
   (origin and target both in 2025, as in validation), call `bundle.predict(panel_up_to_t, t, h)` with the panel truncated
   to the rows usable at *t*. Do not refit, retune or recalibrate anything.
4. Score exactly the metrics already reported for validation: MAE of the median forecast, RMSE, MAE/RMSE of the mean,
   high-incidence MAE, bias and under-prediction share (threshold = the bundle's training q90), outbreak recall, precision
   and false-alert rate, risk-tier confusion matrix, and 80%/90% interval coverage and width.
5. Write the results once to `reports/holdout_2025/` with the commit hash and timestamp. Report them as observed, whether
   better or worse than validation. No model change may be made in response; any later change requires a new, clearly
   labelled post-holdout analysis that cannot be presented as an unbiased test.
