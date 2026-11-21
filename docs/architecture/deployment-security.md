# Launch, deployment and security

[← Architecture overview](../../ARCHITECTURE.md) · Steps: [`deployment.md`](../deployment.md)

## Local launch (judges)

```mermaid
flowchart LR
    clone["git clone"] --> sh["./scripts/launch.sh"]
    sh --> venv["Python venv<br/>pip install -r requirements.txt"]
    sh --> data["scripts/fetch_data.py<br/>download + SHA-256 check"]
    sh --> fe["npm ci && npm run build<br/>(static export)"]
    venv & data & fe --> run["uvicorn on one port<br/>API + dashboard"]
```

Measured: fresh clone to a healthy server in 59 s on the development Mac with warm pip and npm caches (a cold machine takes longer).

## Deployment targets

```mermaid
flowchart TB
    repo[("GitHub repository")]
    subgraph vercel["Vercel: static dashboard (vercel.json, .vercelignore)"]
        cdn["frontend/out on the CDN<br/>rewrite /api/* to the Space"]
    end
    subgraph render["Hugging Face Space: API (scripts/deploy_space.py, Dockerfile.backend)"]
        img["Python 3.12 image: FastAPI, model bundle, app_data,<br/>dataset fetched and checksum-verified at build"]
    end
    repo --> vercel
    repo --> render
    cdn -->|"same-origin /api proxy"| img
    secrets["Space secrets: OPENAI_API_KEY, ACCESS_PASSWORD,<br/>OPENAI_BUDGET_USD"] -.-> render
    pub["Vercel env (public): NEXT_PUBLIC_MAPTILER_KEY"] -.-> vercel
```

Single-container alternative: the root `Dockerfile` bundles dashboard and API (used for local or one-host runs).

## Security model

```mermaid
flowchart LR
    b["Browser"] -->|"HTTP Basic (optional ACCESS_PASSWORD)"| gate["Access gate<br/>(all routes except /api/health)"]
    gate --> api["API: validated inputs,<br/>allow-listed documents,<br/>read-only tools"]
    api --> sec[("Backend-only secrets<br/>.env, platform env")]
    b -.->|"public keys only"| tiles["MapTiler (domain-restricted key)"]
```

| Control | Where |
|---|---|
| Secrets never in git or the browser bundle | `.gitignore`, `.dockerignore`, `.vercelignore`; Playwright secret scan of served assets |
| Input validation | Pydantic types, regex patterns, bounded numbers (horizon 2-4, teams 1-60, simplify ≤ 0.01) |
| Injection-safe external queries | DGHS filter values quoted and validated; facility IDs pattern-checked |
| Bounded compute | routing snap ≤ 1 km, insight samples ≤ 2,500, DGHS ≤ 3,000 features, Copilot rate and budget limits |
| Data licences | OSM ODbL (`app_data/geo/LICENSE.md`), Open-Meteo CC BY 4.0, NASA POWER acknowledgement, MapTiler/OSM attribution on the map |
| Organizer data | not committed; fetched and checksum-verified; served only as derived views |
