# Stage 4 handoff: what the dashboard must use and respect

## 1. Load and call the model

```python
from dengueshield.data import load_development_panel        # 2016-2024 only (the 2025 holdout stays locked)
from dengueshield.inference import ForecastBundle

panel = load_development_panel()
bundle = ForecastBundle.load("models/dengueshield_B.joblib")   # primary: start-of-week convention
pred = bundle.predict(panel, origin="2024-08-05", horizon=3)   # all 60 wards; or wards=["DNCC_Ward_19"]
drivers = bundle.explain(panel, origin="2024-08-05", horizon=3)  # additive log-rate contributions by driver family
```

`predict` returns one row per ward with these columns:

| Column | Meaning |
|---|---|
| `ward_id`, `city`, `origin_date`, `target_date`, `horizon` | keys |
| `expected_cases` | predicted mean (use for resource planning) |
| `median_cases` | MAE-optimal point forecast (use as the headline number) |
| `lower_80`, `upper_80`, `lower_90`, `upper_90` | calibrated predictive interval (NB, α fitted on seasons 2023–2024) |
| `p_outbreak` | P(cases ≥ training q90) under the calibrated distribution |
| `outbreak_alert` | `p_outbreak` ≥ the cut tuned on seasons 2023–2024 (validated recall 0.78, precision 0.53, false alerts 9.7%) |
| `risk_tier` | Low / Medium / High / Critical from the median vs training quantiles q60/q80/q95 (1, 5, 13 cases) |
| `convention`, `model` | provenance |

`explain` returns, per ward, the log-rate contribution of `seasonality (calendar)`, `rainfall (observed + climatology)` and
`ward vulnerability`, plus `baseline_log_rate`; `exp(sum)` equals `expected_cases` (tested).

## 2. Hard rules for the UI

1. **Inputs that `predict` refuses:**
   - an unknown ward;
   - a horizon other than 2, 3 or 4;
   - a date off the Monday grid;
   - fewer than 104 weeks of history;
   - any origin whose required observed week is missing.

   Under B, the latest valid origin is `last data week + 1 week` (2025-01-06 with the development panel). Show the error;
   **never fabricate current observations**, and never present a November 2026 "live" forecast from this historical file.
2. **Do not display 2025 actual cases or compute 2025 errors** until the one-shot holdout is authorised (`docs/holdout_protocol.md`).
   Forecasts *for* early-2025 target weeks made from ≤ 2024 data are allowed, but without actuals.
3. Label risk tiers as **statistical categories for this dataset, not official public-health warning levels**.
4. Show both conventions honestly. If the UI offers the end-of-week bundle (`dengueshield_A.joblib`), label it
   "assumes week *t* data are complete at issue time".
5. State the known weakness next to the alert: intervals under-cover outbreak peaks (61% / 74% at 80% / 90%), and peaks are
   under-predicted by about 3 cases on average.

## 3. Performance and cost

- `predict` takes about 130 ms per call for 1 or 60 wards (most of it is feature construction over the full history). Three horizons take about 0.4 s, and loading a bundle takes 2 ms.
- **Cache** by `(bundle sha256, origin, horizon)`. A whole season of origins for 60 wards × 3 horizons takes about 20 s to precompute once.
- No external API calls, no LLM, no GPU. Bundles are 11 KB joblib files; the raw CSV must be present locally (`data/README.md`).

## 4. Material ready for the bonus items

| Bonus item | Source |
|---|---|
| Ward-level risk heatmap | `predict(...)` for all wards and one origin; ward metadata in `bundle.wards` (no coordinates in the data) |
| Forecast confidence intervals | `lower_*` / `upper_*`; example chart in `reports/model_tournament/figures/04_uncertainty_fan_example.png` |
| Chronological validation error dashboard | `reports/model_tournament/leaderboard_all.csv`, `scores_all_cells.csv` (per season × horizon), `champion.json` |

## 5. Still required by the rubric (not done in Stage 3)

- Root `ARCHITECTURE.md`: data-flow diagram, chronological split (§2 of `model_selection.md`), model-selection rationale (§7),
  compute and API cost controls (§3 above; no LLM/API usage).
- A web dashboard (Streamlit or FastAPI + frontend) with README launch commands that run within 3 minutes of cloning.
- The decision on redistributing the organizer CSV (`data/README.md`), and making the GitHub repository public before submission.
