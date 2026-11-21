# DengueShield AI

Ward-level dengue forecasting for Bangladesh city corporations, built for the
EDU AI Engineering Hackathon 2026 (preliminary round). Goal: forecast weekly
dengue cases and outbreak risk tiers 2, 3 and 4 weeks ahead for each of 60 wards,
using only information available at the forecast origin.

## Status

**Stage 1 (complete):** forensic data audit, EDA, leak-safe validation design, baselines.
**Stage 2 (complete):** temporal feature pipeline (204 candidates), feature-family ablation tournament, selection and interpretability.
**Stage 3 (complete):** count-aware model tournament, bounded tuning, nested ensembles, calibrated intervals, outbreak alerts, risk tiers,
deployable inference bundles. No dashboard yet (Stage 4). The locked 2025 test year has **not** been used.

Headline (Stage 3; validation seasons 2022-2024; Poisson-median MAE). The champion is a ridge Poisson GLM on 24 features:
- **start-of-week origin (primary):** 1.107 / 1.393 / 1.512 for h = 2 / 3 / 4;
- **end-of-week origin:** 1.069 / 1.152 / 1.459, against the Stage 1 benchmark of 1.094 / 1.213 / 1.517.

Tuned XGBoost/LightGBM/CatBoost, hurdle models and ensembles did not beat it by a meaningful margin. Stage 3 found no reliable
accuracy gain over Stage 2. Its gains are robustness over six seasons, calibrated 80%/90% intervals, and an outbreak alert with
recall 0.78 (precision 0.53). Details and limitations: `docs/model_selection.md`, `docs/calibration_and_uncertainty.md`.

| Output | Location |
|---|---|
| Data integrity audit | `notebooks/01_data_audit.ipynb`, `docs/data_audit.md`, `reports/audit/` |
| Exploratory analysis | `notebooks/02_eda.ipynb`, `reports/eda/` |
| Validation and baselines | `notebooks/03_validation_and_baselines.ipynb`, `reports/baselines/`, `docs/validation_protocol.md` |
| Feature library, availability, quality | `notebooks/04_feature_engineering.ipynb`, `docs/feature_engineering.md`, `docs/feature_definitions.md` |
| Feature ablation tournament | `notebooks/05_feature_ablation.ipynb`, `reports/features/` |
| Selection, importance, conventions | `notebooks/06_feature_selection.ipynb`, `docs/feature_selection_report.md`, `reports/features/selection/` |
| Feature research plan | `docs/feature_research_plan.md` |
| Library code | `dengueshield/data.py`, `validation.py`, `metrics.py`, `baselines.py` (Stage 1); `features/`, `evaluation/` (Stage 2); `models/`, `optimization/`, `calibration/`, `inference/` (Stage 3) |
| Model tournament | `notebooks/07_model_tournament.ipynb`, `docs/model_selection.md`, `reports/model_tournament/` |
| Diagnostics, intervals, alerts, risk tiers | `notebooks/08_model_diagnostics.ipynb`, `docs/calibration_and_uncertainty.md` |
| Deployable bundles | `models/dengueshield_B.joblib` (primary), `models/dengueshield_A.joblib`; API in `dengueshield/inference/`; `docs/stage4_handoff.md` |
| One-shot 2025 test procedure (not run) | `docs/holdout_protocol.md` |
| Leakage, alignment, model and bundle tests | `tests/` (194 tests) |

## Setup (Python 3.12)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# place the organizer CSV first: see data/README.md
```

## Reproduce

```bash
pytest                                   # 194 invariants; the real-data ones skip if the CSV is absent
for nb in 01_data_audit 02_eda 03_validation_and_baselines 04_feature_engineering 05_feature_ablation 06_feature_selection 07_model_tournament 08_model_diagnostics; do
  jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=7200 notebooks/$nb.ipynb
done
```

Notebooks 01-04 take seconds to a minute. Notebooks 05-06 run about 1,500 model fits (roughly 25 minutes on an 11-core laptop the first time).
Notebook 07 needs the Stage 3 season predictions: about 6.5 min of screening plus about 11 min of Optuna (studies persist in `.cache/optuna/`).
Notebook 08 takes about 1.5 min. Later runs take seconds, because results are cached in `.cache/` (git-ignored; keyed by data, columns, model, parameters and convention).
Development workflows use `load_development_panel()`, which drops 2025 on load.

## AI assistants and external APIs (disclosure)

The competition requires listing all AI assistants and external APIs.

| Tool | Provider | Used for |
|---|---|---|
| Claude Code, model Claude Opus 5.5 | Anthropic | Stage 1: audit, EDA, validation design, baselines, tests, documentation |
| Claude Code, model Claude Sonnet 5.5 | Anthropic | Stage 2: feature pipeline, ablation tournament, selection analysis, tests, documentation |
| Claude Code, model Claude Opus 5.5 | Anthropic | Stage 3: model tournament, tuning, calibration, inference bundle, tests, documentation |

All AI-written code and conclusions were produced under the team's direction; numbers in the reports come from executed notebooks and saved artifacts.

- **External APIs at runtime:** none. All analysis runs locally on the organizer CSV.
- **Package downloads:** Python packages from PyPI (see `requirements.txt`; Stage 2 adds LightGBM, Stage 3 adds XGBoost, CatBoost, Optuna).
- Team members must add any other AI assistant or external API they use to this table.
