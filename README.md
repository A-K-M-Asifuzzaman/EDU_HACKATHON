# DengueShield AI

Ward-level dengue forecasting for Bangladesh city corporations, built for the
EDU AI Engineering Hackathon 2026 (preliminary round). Goal: forecast weekly
dengue cases and outbreak risk tiers 2, 3 and 4 weeks ahead for each of 60 wards,
using only information available at the forecast origin.

## Status

**Stage 1 (complete):** forensic data audit, EDA, leak-safe validation design, baselines.
**Stage 2 (complete):** temporal feature pipeline (204 candidates), feature-family ablation tournament, selection and interpretability.
No forecasting app or UI yet; those arrive in later stages. The locked 2025 test year has **not** been used.

Headline (validation 2022-2024, end-of-week origin, Poisson-median MAE): Stage 1 best 1.094 / 1.213 / 1.517 for h = 2 / 3 / 4;
Stage 2 best (Poisson GLM, 38 horizon-aligned-rain features) 1.075 / 1.137 / 1.437, i.e. 1.7% / 6.3% / 5.3% lower. All gains are below
0.1 MAE (consistent in sign but not statistically established with only three seasons); under a start-of-week origin every score is
0.11-0.16 MAE worse. Details and negative findings: `docs/feature_selection_report.md`.

| Output | Location |
|---|---|
| Data integrity audit | `notebooks/01_data_audit.ipynb`, `docs/data_audit.md`, `reports/audit/` |
| Exploratory analysis | `notebooks/02_eda.ipynb`, `reports/eda/` |
| Validation and baselines | `notebooks/03_validation_and_baselines.ipynb`, `reports/baselines/`, `docs/validation_protocol.md` |
| Feature library, availability, quality | `notebooks/04_feature_engineering.ipynb`, `docs/feature_engineering.md`, `docs/feature_definitions.md` |
| Feature ablation tournament | `notebooks/05_feature_ablation.ipynb`, `reports/features/` |
| Selection, importance, conventions | `notebooks/06_feature_selection.ipynb`, `docs/feature_selection_report.md`, `reports/features/selection/` |
| Feature research plan | `docs/feature_research_plan.md` |
| Library code | `dengueshield/data.py`, `validation.py`, `metrics.py`, `baselines.py` (Stage 1); `features/` (pipeline), `evaluation/` (folds, models, ablation, quality) |
| Leakage and alignment tests | `tests/` (142 tests) |

## Setup (Python 3.12)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# place the organizer CSV first: see data/README.md
```

## Reproduce

```bash
pytest                                   # 142 invariants; the real-data ones skip if the CSV is absent
for nb in 01_data_audit 02_eda 03_validation_and_baselines 04_feature_engineering 05_feature_ablation 06_feature_selection; do
  jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=7200 notebooks/$nb.ipynb
done
```

Notebooks 01-04 take seconds to a minute. Notebooks 05-06 run about 1,500 model fits: roughly 25 minutes of fit time on an 11-core laptop CPU
the first time, and seconds afterwards because results are cached in `.cache/features/` (git-ignored; keyed by data, columns, model, convention).
Development workflows use `load_development_panel()`, which drops 2025 on load.

## AI assistants and external APIs (disclosure)

The competition requires listing all AI assistants and external APIs.

| Tool | Provider | Used for |
|---|---|---|
| Claude Code, model Claude Opus 5.5 | Anthropic | Stage 1: audit, EDA, validation design, baselines, tests, documentation |
| Claude Code, model Claude Sonnet 5.5 | Anthropic | Stage 2: feature pipeline, ablation tournament, selection analysis, tests, documentation |

All AI-written code and conclusions were produced under the team's direction; numbers in the reports come from executed notebooks and saved artifacts.

- **External APIs at runtime:** none. All analysis runs locally on the organizer CSV.
- **Package downloads:** Python packages from PyPI (see `requirements.txt`; Stage 2 adds LightGBM).
- Team members must add any other AI assistant or external API they use to this table.
