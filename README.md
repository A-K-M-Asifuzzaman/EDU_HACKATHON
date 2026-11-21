# DengueShield AI

Ward-level dengue forecasting for Bangladesh city corporations, built for the
EDU AI Engineering Hackathon 2026 (preliminary round). Goal: forecast weekly
dengue cases and outbreak risk tiers 2, 3 and 4 weeks ahead for each of 60 wards,
using only information available at the forecast origin.

## Quick start

Requirements: Python 3.12, Node 20.9+ and npm (CI uses Node 22), and internet access for the first run (PyPI, npm, and the organizer dataset).

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

### Deploying for teammates

The dashboard is a static site on Vercel and the API runs on a Hugging Face Space (`Dockerfile.backend`, `scripts/deploy_space.py`, `vercel.json`); steps, secrets and cost controls are in `docs/deployment.md`.

### Fresh-clone measurement

On 22 Nov 2026, an authenticated shallow GitHub clone took about **4 s** on Apple silicon. With Python 3.12.6, Node 25.2.0, empty pip and npm caches,
and a verified 2016–2024 fixture already in place, `./scripts/launch.sh` reached a healthy API and dashboard in **97 s**. The measurement excludes
the organizer CSV download. Judge access and the end-to-end download path require a separate verification.

## What is in the app (Stage 4)

| Page | Purpose |
|---|---|
| Command Center | Hero with the selected week's forecast and validated performance (MAE by horizon, interval coverage incl. the peak weakness); forecast, calibrated intervals, outbreak probability and risk tier for any ward, origin and horizon; **time machine** (▶ steps through real weekly forecasts) with a verdict row (error, interval hit, alert outcome) on validation weeks; downloadable **intelligence brief** |
| Data Profiling Studio | Dataset health, distributions, correlations, seasonality, rainfall-lag analysis |
| Ward Risk Explorer | Rank and filter all 60 wards by tier or alert |
| Map & Emergency Routing | The app's single map: 914 OpenStreetMap hospitals and clinics (clustered, searchable, click-to-call), A* routing on the directed OSM road graph (fastest vs shortest, each verified against Dijkstra), nearest hospitals by road time, city-level forecast and weather overlays, optional DGHS boundaries and 3D buildings. Facility data are community-mapped, not DGHS-verified; no live beds or doctors. See `docs/geospatial_routing.md` |
| AI Forecast Lab | Horizon comparison, driver contributions, uncertainty fan |
| Copilot | Chat grounded in the app's data and docs (OpenAI Responses API, read-only tools, citations, English and Bangla) |
| Model Evidence | **Reliability center** (per-horizon MAE/RMSE/bias, alert recall/precision/false alerts, coverage and width, peak coverage 0.607/0.740, error by outcome size, MAE by season, reliability diagram) and the **alert policy simulator** (retrospective; deployed rule vs nested re-selection vs optimistic in-sample); leaderboard, seasons, calibration, importance, limitations |
| Response Intelligence | Generic response options plus the **resource planning sandbox**: N teams allocated risk-blind vs by historical risk vs by forecast, with retrospective coverage of actual outbreak wards (planning simulation only) |
| Climate Observatory | Real NASA POWER and Open-Meteo observations/forecast, shown separately from the synthetic organizer data |
| Learn | Rainfall-to-cases explainer; optional lightweight 3D mosquito (procedural, no external model) |
| System & Provenance | Versions, data checksums, integrations status, methodology documents |

Global search (⌘K / Ctrl K) jumps to any page, forecast ward or hospital. An **Emergency help** button on every page gives tap-to-call 999 and 16263, WHO dengue warning signs and the nearest hospitals by road. A short interactive intro (swat the mosquito) plays once per session; it is skipped under reduced motion and has Skip and Emergency buttons.

The interface is bilingual (English / Bangla). [ARCHITECTURE.md](ARCHITECTURE.md) contains the system overview, validation design, cost controls and Mermaid diagrams for all seven subsystems.
Decision-support methods and evidence: `docs/decision_support.md`. Three-minute walkthrough: `docs/demo_script.md`. Screenshots: `docs/screenshots/`, `reports/screenshots/`.

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
| Leakage, alignment, model and bundle tests | `tests/` |

## Manual setup, research stack (Python 3.12)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-research.txt   # adds XGBoost, CatBoost, Optuna, Jupyter; the app itself needs only requirements.txt
# place the organizer CSV first: see data/README.md
```

## Reproduce

```bash
pytest                                   # organizer-data tests skip if the CSV is absent
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
| Claude Code (Claude Opus and Sonnet models) | Anthropic | Development assistant: website building (frontend, backend API, map and routing), suggestions for data handling and feature ideas, test writing and documentation |
| Codex | OpenAI | Release audit, browser and API verification, Vercel deployment fixes and architecture documentation |

The team directed the work and set the requirements, reviewed the results, and chose the validation protocol and model. Reported numbers come from executed notebooks and saved artifacts, not from an AI model's statements, and the tests in `tests/` check them.

- **External APIs at runtime (all optional; the app degrades gracefully if any is unavailable):**
  - OpenAI (Responses API `gpt-5.4-mini`; Embeddings `text-embedding-3-small`): Copilot only, called from the backend, key never sent to the browser.
  - NASA POWER daily point API and Open-Meteo (archive and forecast): real weather in the Climate Observatory, with attribution; never used to train or feed the forecasting model.
  - MapTiler: basemap tiles, 3D building heights and place search (geocoding), called from the browser with the public map key.
  - OpenStreetMap via the Overpass API: hospitals, clinics and road network, fetched **once at build time** (`scripts/build_geodata.py`) and committed under ODbL in `app_data/geo/`; routing itself runs locally with no API.
  - Public information shown in the Emergency panel: Bangladesh 999 and DGHS 16263 numbers, WHO dengue warning signs.
  - DGHS Bangladesh GIS (ArcGIS REST FeatureServer): official ward boundaries, display only. Access and reuse terms could not be verified from the development network; see `docs/dghs_gis_integration.md`.
  - Dataset download from the organizers' shared sheet (`scripts/fetch_data.py`).
- The forecasts themselves need no external service: they run locally from the committed 11 KB bundle.
- **Package downloads:** Python packages from PyPI (`requirements.txt` for the app, `requirements-research.txt` for the research notebooks) and npm packages for the frontend (`frontend/package-lock.json`).
- Team members must add any other AI assistant or external API they use to this table.
