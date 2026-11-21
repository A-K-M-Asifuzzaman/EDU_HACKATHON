# DengueShield AI: Architecture

One Python process serves the forecasting API **and** the pre-built dashboard on a single port. The forecasts come from a
small statistical model fitted offline; the optional LLM and weather providers sit beside it and never feed it.

## 1. Data flow

```
 Organizer CSV (31,320 rows, 60 wards x 2016-2025, SYNTHETIC)
        │  scripts/fetch_data.py  (SHA-256 verified)          2025 rows are dropped on load
        ▼
 load_development_panel()  ── 2016-2024 only ──────────────────────────────────────────┐
        │                                                                              │
        ├── OFFLINE (research, notebooks 01-08)                                        │
        │     features (F8, 24) → season-level out-of-time CV → champion → calibration │
        │     └─► models/dengueshield_B.joblib  (ridge Poisson GLM, per horizon 2/3/4) │
        │     └─► python -m dengueshield.appdata ─► app_data/*.json + replay.csv.gz    │
        │                                                                              │
        ▼                                                                              ▼
 ┌────────────────────────── FastAPI (dengueshield/api) ───────────────────────────────────┐
 │  /api/forecast*, /risk/wards, /reports/*   live inference: ForecastBundle.predict()    │
 │                                            (LRU cache by origin, horizon)              │
 │  /api/model/*, /data/*                     precomputed artifacts in app_data/          │
 │  /api/decision/*                           alert simulator + resource sandbox          │
 │                                            (saved 2019-2024 replay only; no refitting) │
 │  /api/assistant/chat   (SSE)               RAG: BM25 + embeddings → 7 read-only tools  │──► OpenAI
 │  /api/climate/*, /weather/*                NASA POWER + Open-Meteo, cached, optional   │──► NASA POWER / Open-Meteo
 │  /api/facilities, /api/route,              OSM facilities + A* on directed road graphs │
 │  /api/emergency/*                          (app_data/geo, ODbL; built offline)          │
 │  /api/geo/dghs/*                           DGHS ArcGIS boundaries, cached, optional     │──► DGHS GIS
 │  /  (everything else)                      static Next.js export  frontend/out         │
 └────────────────────────────────────────────────────────────────────────────────────────┘
        ▲
 Browser: Next.js 16 static export · React 19 · Tailwind · ECharts · MapLibre · R3F (optional) · EN/BN
```

Key separations:

| Boundary | Rule |
|---|---|
| Organizer data vs real weather | NASA POWER / Open-Meteo are shown **beside** the synthetic data in the Climate Observatory. They are never an input to the validated model. |
| Live bundle vs Historical Replay | Replay = out-of-time predictions (seasons 2019-2024, nested calibration), used for accuracy claims. Live bundle = in-sample for origins ≤ 2024; it is for exploration, labelled as such. |
| LLM vs numbers | The Copilot can only quote numbers returned by its read-only tools; it never computes forecasts and cannot call the model with arbitrary data. |
| Real facilities vs synthetic wards | Hospitals and roads are real OSM records; forecasts appear on the map only as city-level aggregates. No facility, route or polygon is linked to a synthetic ward ID. |
| Official boundaries vs dataset wards | DGHS polygons are context only. The dataset's ward IDs have no verified crosswalk to them, so no forecast is drawn on a polygon; predictions use an abstract matrix (`docs/dghs_gis_integration.md`). |
| Frontend vs secrets | All keys (`OPENAI_API_KEY`) stay in the backend `.env`. Only public map keys live in `frontend/.env.local`. |

## 2. Chronological validation

Random splits leak the future in a weekly panel, so every number in the app comes from a time-ordered scheme
(`docs/validation_protocol.md`, `docs/model_selection.md` §2):

- **Season-out-of-time.** For season *s* (2018-2024) the model is fitted on labels known by 31 Dec *s-1* and predicts season *s*.
  Outer folds: **2019-2024**.
- **Nesting.** Anything tuned for season *Y* (ensemble weights, interval dispersion, alert threshold) uses only seasons *Y-2* and *Y-1*.
  Hyperparameter search ran on 2019-2021 only.
- **Origin convention B (primary):** a forecast issued at the start of week *t* uses weather and cases through week *t-1*. Convention A
  (end-of-week) is also available and labelled "assumes week *t* is complete".
- **Locked holdout:** 2025 is removed on load. It is not used, displayed or scored (`docs/holdout_protocol.md`). The API refuses origins
  later than the last data week + 1 and never fabricates observations.

## 3. Why this model

Rule fixed before the tuned/ensemble results were seen (`docs/model_selection.md` §7): shortlist everything within 0.05 MAE of the best,
then take the simplest. Winner: **ridge Poisson GLM, 24 features, one model per horizon.**

| | |
|---|---|
| MAE 2022-24 (h = 2/3/4) | 1.107 / 1.393 / 1.512 |
| Cost | ~0.4 s to fit, sub-millisecond to predict, 11 KB bundle |
| Why not boosting/ensembles | Gaps to the best candidate were 0.002-0.037 MAE, inside the noise of 3-6 seasons; GLM has the best high-incidence behaviour of the shortlist, lowest variability and additive per-driver explanations |
| Intervals | Negative-binomial with dispersion calibrated on the two prior seasons. 80% / 90% coverage 0.855 / 0.911 on average |
| Alert | P(cases ≥ training q90) ≥ tuned cut. Recall ≈ 0.78, precision ≈ 0.53 |
| Known weakness | Intervals under-cover outbreak peaks (≈ 61% at the 80% level) and peaks are under-predicted by ≈ 3 cases. Shown next to the alert in the UI |

Risk tiers (Low/Medium/High/Critical) are quantiles of the training data (1 / 5 / 13 weekly cases), **statistical categories, not official warning levels.**

## 4. Backend layout

| Module | Role |
|---|---|
| `dengueshield/inference/` | `ForecastBundle` (load, `predict`, `explain`), refuses invalid origins |
| `dengueshield/appdata.py` | builds `app_data/` (profile, correlations, seasonality, lag analysis, validation, `replay.csv.gz`) in ≈ 20 s |
| `dengueshield/api/main.py` | routes, Pydantic validation, CORS (localhost), SPA serving |
| `dengueshield/api/store.py` | loads dataset, bundle, artifacts; LRU cache |
| `dengueshield/api/rag.py` | Copilot retrieval, tools, streaming, limits |
| `dengueshield/api/climate.py`, `integrations.py` | external weather providers, status registry, `.env` loader |

Interactive API reference: `/docs` (FastAPI OpenAPI) once running.

## 5. Compute and API cost controls

| Resource | Control |
|---|---|
| Model inference | No GPU. ≈ 0.25 s for a cold 60-ward origin, ≈ 6 ms warm (LRU). Replay table lookups ≈ 4 ms |
| Dashboard | Static export (no server rendering). Charts, map and 3D are code-split and loaded on demand; 3D loads only on the Learn page, is skipped on small screens, low-core devices and without WebGL (an SVG explainer replaces it), and stops animating under reduced-motion |
| OpenAI | Backend only, key from `.env`. `gpt-5.4-mini` for answers, `text-embedding-3-small` (512 dims) for retrieval; the document index is built once into `app_data/rag_index.npz`. Output capped at 900 tokens, 30 requests/hour, request-size limits, a USD budget guard (`OPENAI_BUDGET_USD`, default 1.00), response cache, usage log without message content. Measured ≈ $0.002-0.004 per answer. Without a key, Copilot falls back to retrieval-only |
| NASA POWER | Per-city daily point query, 40 s timeout, memory + disk cache (`.cache/weather`), history TTL 24 h, stale fallback when the provider is down |
| Open-Meteo | Archive (24 h TTL) and forecast/current (10 min / 1 h TTL), 15-40 s timeouts, same stale fallback. Free non-commercial tier; attribution shown |
| Decision tools | `dengueshield/decision.py` reads only the saved out-of-time replay (2019–2024) and pre-origin observations: alert curve 15 ms, allocation 8 ms, season allocation 375 ms, cached per query. No refitting, no 2025 data; the deployed alert rule is unchanged (`docs/decision_support.md`) |
| Routing | Local and free: graphs load in ≈ 0.3 s; A* median 5.7 ms per route (400/400 equal to Dijkstra). OSM is queried only by the offline build script (3 requests, cached). MapTiler geocoding runs from the browser only when the user searches places |
| DGHS GIS | Connect timeout 6 s, 60 s circuit breaker, paginated queries capped at 3,000 features, boundaries cached 7 days with stale fallback; no key needed |
| Deployment access | Optional shared password (`ACCESS_PASSWORD`, HTTP Basic) for private previews; per-client Copilot rate limit works behind the platform proxy. See `docs/deployment.md` |
| Map tiles | MapTiler key in `frontend/.env.local`; without it the city-risk table is shown instead |

If any external service fails, the affected panel shows a status message; every other page keeps working
(`/api/integrations/status` reports what is reachable).

## 6. Testing

- `pytest tests`: 244 tests (leakage, feature alignment, models, bundle invariants, API contracts, A* vs Dijkstra, one-way handling, decision tools without look-ahead, regressions).
- `cd frontend && npx playwright test`: 26 end-to-end tests (all routes, map routing and A* insight, emergency help, intro, reliability center, alert simulator, resource sandbox, brief, search, console errors, mobile overflow, Bangla, Copilot markdown
  sanitisation, 3D fallback, secret scan of served assets).
