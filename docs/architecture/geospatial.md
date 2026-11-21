# Geospatial: facilities, road graphs, A* routing and emergency help

[Architecture overview](../../ARCHITECTURE.md)

Details: [`geospatial_routing.md`](../geospatial_routing.md), [`dghs_gis_integration.md`](../dghs_gis_integration.md)

## Build-time data pipeline

```mermaid
flowchart LR
    ov["Overpass API<br/>(OpenStreetMap, ODbL)"] -->|"3 cached requests"| raw[(".cache/osm<br/>raw JSON")]
    raw --> roads["Drivable ways<br/>oneway, access filters"]
    roads --> contract["Contract at intersections<br/>keep street geometry"]
    contract --> scc["Largest strongly<br/>connected component"]
    scc --> graphs[("greater_dhaka_graph.npz<br/>chattogram_graph.npz")]
    raw --> fac["Hospitals and clinics<br/>normalise, dedupe point+outline"]
    fac --> snap["Snap to nearest graph vertex"]
    graphs --> snap
    snap --> geojson[("facilities.geojson<br/>914 records")]
    graphs --> bench["A* vs Dijkstra benchmark<br/>400/400 equal"]
```

## Routing request

```mermaid
sequenceDiagram
    autonumber
    participant U as User (map)
    participant API as /api/route
    participant G as Graph (CSR arrays + KD-tree)
    U->>API: start (GPS, click or search) + facility id
    API->>G: area for both points, snap each to nearest intersection (≤ 1 km)
    G->>G: A* on distance (haversine heuristic)
    G->>G: A* on estimated time (haversine / max speed)
    G->>G: Dijkstra on both (verification)
    G-->>API: paths, costs, nodes expanded, ms
    opt A* Insight Mode
        API->>G: bounded exploration samples (≤ 2,500 nodes each)
    end
    API-->>U: fastest + shortest GeoJSON, equal-cost flags, assumptions, attribution
```

## Map composition (one map)

```mermaid
flowchart TB
    base["MapTiler streets basemap<br/>(blank fallback without key)"]
    b3d["3D buildings<br/>(OpenMapTiles heights)"]
    facl["OSM facilities<br/>clustered, click to detail"]
    route["Routes: fastest (arrows) / shortest,<br/>A* and Dijkstra exploration fronts"]
    city["City-level forecast pills<br/>(aggregate of synthetic wards)"]
    wx["Weather now<br/>(Open-Meteo, timestamped)"]
    dghs["DGHS boundaries<br/>(context only, optional)"]
    base --> b3d --> dghs --> facl --> route --> city --> wx
```

Synthetic ward forecasts are never attached to real geometry: the map shows them only as city aggregates, and the abstract ward-risk matrix sits beside the map.

## Emergency flow

```mermaid
flowchart LR
    btn["Emergency help<br/>(every page, also during intro)"] --> modal["Instant modal, no API call:<br/>tap-to-call 999 and 16263,<br/>WHO warning signs"]
    modal --> near["Find nearest hospitals by road"]
    near --> loc{"Location permission?"}
    loc -->|granted| md["Multi-target Dijkstra<br/>on estimated time"]
    loc -->|denied| click["Click the map to set a start"] --> md
    md --> list["Top 5 hospitals: time, distance,<br/>phone if mapped, route, Google Maps link"]
```

No beds, admissions, doctors on duty or live traffic exist in these sources, and none are shown.
