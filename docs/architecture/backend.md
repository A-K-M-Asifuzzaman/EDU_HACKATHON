# Backend: FastAPI service

[Architecture overview](../../ARCHITECTURE.md)

Interactive reference: `/docs` (OpenAPI) on a running server

## Modules

```mermaid
flowchart TB
    main["api/main.py<br/>routes, validation, CORS,<br/>access gate, SPA serving"]
    store["api/store.py<br/>Store: dataset, bundle, artifacts,<br/>replay, LRU cache"]
    inf["inference/<br/>ForecastBundle.predict / explain"]
    dec["decision.py<br/>alert curve, allocation"]
    rt["routing.py<br/>A*, Dijkstra, nearest facilities"]
    rag["api/rag.py<br/>retrieval, 7 tools, streaming"]
    clim["api/climate.py<br/>NASA POWER, Open-Meteo"]
    geo["api/geo.py<br/>DGHS ArcGIS"]
    integ["api/integrations.py<br/>status registry, .env loader"]
    main --> store --> inf
    main --> dec & rt & rag & clim & geo & integ
    rag --> main
    store --> files[("app_data/, models/, data/raw")]
    clim & geo --> cache[("CACHE_ROOT: .cache/ or /tmp on read-only hosts")]
```

## Request lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant G as access gate (optional)
    participant R as route handler
    participant C as LRU cache
    participant M as bundle / replay / routing
    B->>G: GET /api/forecast?ward_id&origin&horizon
    G->>R: password ok (or gate off)
    R->>R: Pydantic + regex validation (Monday grid, horizon 2-4, known ward)
    R->>C: key (bundle sha, origin, horizon)
    alt cached
        C-->>R: frame
    else miss
        R->>M: predict 60 wards (≈ 0.25 s)
        M-->>C: store
    end
    R-->>B: JSON (gzip ≥ 2 KB)
```

## Endpoint groups

| Group | Endpoints | Source |
|---|---|---|
| Health and metadata | `/api/health`, `/api/metadata`, `/api/cities`, `/api/wards`, `/api/integrations/status` | Store |
| Forecasts | `/api/forecast`, `/api/forecast/compare`, `/api/forecast/series`, `/api/risk/wards`, `/api/reports/summary` | bundle (live) or replay |
| Model evidence | `/api/model/{metrics,features,validation,calibration,diagnostics}` | committed artifacts |
| Data profile | `/api/data/{profile,distributions,correlations,seasonality,lag-analysis}`, `/api/weather/historical` | `app_data/` |
| Decision support | `/api/decision/{alert-curve,allocate,allocation-season}` | replay + pre-origin panel |
| Geospatial | `/api/facilities`, `/api/route`, `/api/emergency/{nearest,info}`, `/api/routing/status`, `/api/geo/dghs/{status,filters,wards}` | `app_data/geo`, DGHS |
| Climate | `/api/climate/{observations,current,compare}` | NASA POWER, Open-Meteo |
| Copilot | `/api/assistant/chat` (SSE), `/api/assistant/status` | OpenAI (optional) |
| Documents | `/api/docs`, `/api/docs/read` | allow-listed Markdown only |

## Failure handling

```mermaid
stateDiagram-v2
    [*] --> Fresh: cache hit within TTL
    [*] --> Fetch: miss
    Fetch --> Fresh: provider ok
    Fetch --> Stale: provider down, disk copy exists
    Fetch --> Unavailable: provider down, no copy
    Unavailable --> Breaker: DGHS only, 60 s fail-fast
    Stale --> [*]: served and labelled stale
    Unavailable --> [*]: 503 status unavailable, rest of app unaffected
```

## System context


```mermaid
flowchart LR
    user(["Public-health officer / judge<br/>(browser, EN or BN)"])
    subgraph app["DengueShield AI"]
        ui["Next.js static dashboard<br/>Vercel in production, FastAPI locally"]
        api["FastAPI backend<br/>/api/* · Hugging Face Space in production"]
        model[("Ridge Poisson GLM bundle<br/>11 KB, sha256-pinned")]
        art[("Precomputed artifacts<br/>app_data/: replay, profiles,<br/>RAG index, OSM graphs")]
        csv[("Development panel<br/>2016–2024")]
    end
    openai["OpenAI<br/>(Copilot only)"]
    wx["NASA POWER<br/>Open-Meteo"]
    tiles["MapTiler<br/>tiles + geocoding"]
    dghs["DGHS ArcGIS<br/>(boundaries)"]
    user --> ui --> api
    api --> model & art & csv
    api -. optional .-> openai
    api -. optional .-> wx
    api -. optional .-> dghs
    ui -. optional .-> tiles
```

Solid lines are required; dotted lines are optional services with timeouts, caches and graceful fallbacks.
