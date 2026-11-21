# Frontend: Next.js static dashboard

[Architecture overview](../../ARCHITECTURE.md)

Next.js 16 (static export), React 19, TypeScript, Tailwind 4, ECharts 6 (tree-shaken), MapLibre 6 with MapTiler, React Three Fiber (intro and Learn
page only), Motion. The build output `frontend/out` is served by FastAPI on the same origin, so there is no CORS and no server rendering.

## Application shell

```mermaid
flowchart TB
    layout["app/layout.tsx<br/>Providers: i18n, selection, toasts"] --> shell["components/shell.tsx"]
    shell --> nav["Sidebar navigation (11 pages)"]
    shell --> top["Header: provenance chips,<br/>⌘K search, Emergency help, EN/BN"]
    shell --> main["Page content"]
    shell --> foot["Footer: sources and licences"]
    shell --> intro["Intro overlay (once per session)"]
    shell --> fab["Copilot button"]
```

## Pages

```mermaid
flowchart LR
    cc["Command Center<br/>hero, time machine,<br/>verdict, brief"]
    prof["Data Profiling Studio"]
    wards["Ward Risk Explorer"]
    map["Map & Emergency Routing<br/>(the single map)"]
    lab["AI Forecast Lab"]
    cop["Research Copilot"]
    ev["Model Evidence<br/>reliability center,<br/>alert simulator"]
    resp["Response Intelligence<br/>resource sandbox"]
    clim["Climate Observatory"]
    learn["Learn: Aedes & rainfall"]
    prov["System & Provenance"]
    sel(("Shared selection<br/>city, ward, origin,<br/>horizon, source"))
    sel --- cc & wards & lab & map & resp
```

## Data access in the browser

```mermaid
sequenceDiagram
    participant P as Page component
    participant H as useAsync hook
    participant A as lib/api.ts
    participant S as FastAPI
    P->>H: deps change (ward, origin, horizon)
    H->>A: api(path, signal)
    A->>A: memory cache (TTL) hit?
    A->>S: fetch same-origin /api/...
    S-->>A: JSON or error detail
    A-->>H: data, or ApiError (aborts never look like empty data)
    H-->>P: loading / error with retry / data
```

## Cross-cutting rules

| Concern | Implementation |
|---|---|
| Bilingual | `lib/i18n.tsx` EN/BN dictionary, Bengali digits and dates, Noto Sans Bengali |
| Design system | tokens in `app/globals.css` (midnight navy, forest, teal, restrained cyan, ivory), atoms in `components/ui.tsx` |
| Charts | `components/echart.tsx` lazy ECharts, shared axis style, accessible labels |
| Performance | code-split map, charts and 3D; Command Center LCP 220 ms cold / 88 ms warm (local) |
| Accessibility | keyboard-reachable controls, ARIA roles on tabs, switches, dialogs; reduced-motion respected everywhere |
| Safety | Copilot Markdown sanitised; no secrets in the bundle (tested) |
