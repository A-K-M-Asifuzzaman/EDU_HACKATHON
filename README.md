# DengueShield AI

Ward-level dengue forecasting for Bangladesh city corporations, built for the
EDU AI Engineering Hackathon 2026 (preliminary round). Goal: forecast weekly
dengue cases and outbreak risk tiers 2, 3 and 4 weeks ahead for each of 60 wards,
using only information available at the forecast origin.

## Quick start

Requirements: Python 3.12 (the tested version), Node 20+ and npm, internet access for the first run (PyPI, npm, and the organizer dataset).

```bash
git clone https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON.git && cd EDU_HACKATHON
./scripts/launch.sh            # http://127.0.0.1:8000   (PORT=8100 ./scripts/launch.sh if 8000 is busy)
```

The script creates `.venv`, installs the runtime dependencies (`requirements.txt`), downloads and checksum-verifies the organizer CSV
(`scripts/fetch_data.py`; see `data/README.md` if the download fails), builds the dashboard (`npm ci && npm run build`) and starts one
process that serves both the API and the dashboard. Measured clone-to-running time: see "Fresh-clone measurement" below.

Optional keys (the app runs without them, with the affected feature disabled):

| Feature | Where | Variable |
|---|---|---|
| Copilot (OpenAI) | `.env` in the repo root (see `.env.example`) | `OPENAI_API_KEY` |
| City map tiles | `frontend/.env.local` (see `frontend/.env.example`) | `NEXT_PUBLIC_MAPTILER_KEY` |

Both files are git-ignored. NASA POWER and Open-Meteo need no key.

## What is in the app (Stage 4)

| Page | Purpose |
|---|---|
| Command Center | Forecast, calibrated interval, outbreak probability and risk tier for any ward, origin week and horizon; city map; Historical Replay |
| Data Profiling Studio | Dataset health, distributions, correlations, seasonality, rainfall-lag analysis |
| Ward Risk Explorer | Rank and filter all 60 wards by tier or alert |
| AI Forecast Lab | Horizon comparison, driver contributions, uncertainty fan |
| Copilot | Chat grounded in the app's data and docs (OpenAI Responses API, read-only tools, citations, English and Bangla) |
| Model Evidence | Leaderboard, validation per season, calibration, known weaknesses |
| Response Intelligence | Turn forecasts into resource-planning signals |
| Climate Observatory | Real NASA POWER and Open-Meteo observations/forecast, shown separately from the synthetic organizer data |
| Learn | Rainfall-to-cases explainer; optional lightweight 3D mosquito (procedural, no external model) |
| System & Provenance | Versions, data checksums, integrations status, methodology documents |

The interface is bilingual (English / Bangla). Architecture, validation design and cost controls: **`ARCHITECTURE.md`**.
Three-minute walkthrough: `docs/demo_script.md`. Screenshots: `docs/screenshots/`, `reports/screenshots/`.

## Status

**Stage 1-3 (complete):** data audit, EDA, leak-safe validation, 204-feature pipeline, model tournament, calibrated intervals,
outbreak alerts, risk tiers, deployable bundles. **Stage 4 (complete):** FastAPI + Next.js platform, Copilot, external weather hub, tests.
The locked 2025 test year has **not** been used. The dataset is synthetic; nothing in the app is live surveillance, and the demo
mode is labelled **Historical Replay**.

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
| Web platform | `dengueshield/api/`, `frontend/`, `app_data/`, `ARCHITECTURE.md` |
| Deployable bundles | `models/dengueshield_B.joblib` (primary), `models/dengueshield_A.joblib`; API in `dengueshield/inference/`; `docs/stage4_handoff.md` |
| One-shot 2025 test procedure (not run) | `docs/holdout_protocol.md` |
| Leakage, alignment, model and bundle tests | `tests/` (212 tests) |

## Manual setup, research stack (Python 3.12)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-research.txt   # adds XGBoost, CatBoost, Optuna, Jupyter; the app itself needs only requirements.txt
# place the organizer CSV first: see data/README.md
```

## Reproduce

```bash
pytest                                   # 212 tests; the real-data ones skip if the CSV is absent
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

| Claude Code, model Claude Sonnet 5.5 | Anthropic | Stage 4: FastAPI backend, Next.js frontend, Copilot, climate integrations, tests, documentation |

All AI-written code and conclusions were produced under the team's direction; numbers in the reports come from executed notebooks and saved artifacts.

- **External APIs at runtime (all optional; the app degrades gracefully if any is unavailable):**
  - OpenAI (Responses API `gpt-5.4-mini`; Embeddings `text-embedding-3-small`): Copilot only, called from the backend, key never sent to the browser.
  - NASA POWER daily point API and Open-Meteo (archive and forecast): real weather in the Climate Observatory, with attribution; never used to train or feed the forecasting model.
  - MapTiler tiles: city map background.
  - Dataset download from the organizers' shared sheet (`scripts/fetch_data.py`).
- The forecasts themselves need no external service: they run locally from the committed 11 KB bundle.
- **Package downloads:** Python packages from PyPI (`requirements.txt` for the app, `requirements-research.txt` for the research notebooks) and npm packages for the frontend (`frontend/package-lock.json`).
- Team members must add any other AI assistant or external API they use to this table.
