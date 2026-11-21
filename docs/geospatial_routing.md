# Map & Emergency Routing: facilities, A* road routing, emergency help

Page: **Map & Emergency Routing** (`/geography/`), the single map of the application. Code: `scripts/build_geodata.py` (data),
`dengueshield/routing.py` (algorithms), API routes in `dengueshield/api/main.py`, UI in `frontend/components/commandmap.tsx`,
`frontend/app/geography/page.tsx`, `frontend/components/emergency.tsx`. Tests: `tests/test_routing.py`, Playwright map/emergency tests.

## 1. Data: what is real and what is not

| Layer | Source | Status |
|---|---|---|
| Hospitals and clinics (914) | OpenStreetMap via the Overpass API (`amenity`/`healthcare` = hospital or clinic), snapshot 21 Nov 2026 | Real, **community-mapped, not verified by DGHS**. 933 OSM records, of which 19 point-plus-outline duplicates (same name within 200 m) were merged. 884 named, 59 with a phone number, 2 more than 300 m from a mapped road (excluded from nearest-hospital search). |
| Road graphs | OpenStreetMap drivable ways in Greater Dhaka (Dhaka, Narayanganj, Gazipur) and Chattogram | Real geometry and one-way tags. 71,129 + 18,766 intersections, 9,647 + 2,282 km of road. |
| Travel times | Assumed free-flow speeds by road class (motorway 50 … residential 15 km/h) | **Estimates.** No live or historical traffic data exist in this project. |
| DGHS boundaries | DGHS ArcGIS layer (`docs/dghs_gis_integration.md`) | Optional context; the server was unreachable from our networks. |
| Official facility registry | `facilityregistry.dghs.gov.bd` | Unreachable (connection timeout) when tested; not used. |
| Doctors, beds, vacancies, admission status | none | **Not available, not shown, never invented.** `beds_tagged` is only what an OSM mapper typed. |
| Emergency numbers | 999 (Bangladesh National Emergency Service), 16263 (DGHS Shasthya Batayon) | Published public numbers. |
| Warning signs | WHO "Dengue and severe dengue" fact sheet | Shown as general information, not medical advice. |
| Forecast overlay | The deployed model, aggregated to city level | Synthetic ward IDs are never placed on real geography. |

Licence: OpenStreetMap data are © OpenStreetMap contributors under the **ODbL 1.0**. The derived files in `app_data/geo/` are distributed under the
same licence (`app_data/geo/LICENSE.md`), and the map shows the attribution. No Google Maps data or paid Places API is used.

Rebuild: `python scripts/build_geodata.py` (3 Overpass requests, cached raw in `.cache/osm/`, retried with backoff; `--offline` rebuilds from the cache), then
`python -m dengueshield.routing bench` for the benchmark.

## 2. Graph

- **Directed.** `oneway=yes/-1`, roundabouts and motorways are one-way; `access=no/private`, `motor_vehicle=no` and reversible lanes are excluded.
- **Contracted at intersections** (any way endpoint or node shared by two or more ways). Each edge keeps the full street geometry, so routes are drawn along real streets.
- **Weights:** length in metres (sum of haversine distances along the geometry) and estimated time in seconds (length ÷ class speed).
- **Connectivity:** only the largest strongly connected component is kept, so every snapped origin can reach every snapped destination. Points more than
  1 km from the network are refused ("outside the mapped road network"); origin and destination in different areas are refused.

## 3. Algorithms

- **A\*** with a great-circle (haversine) heuristic for distance, and haversine ÷ the fastest class speed in the graph for time. Both are **admissible and
  consistent**: an edge is at least as long as the great-circle distance between its endpoints, great-circle distance obeys the triangle inequality, and
  no edge is faster than the maximum speed. A 1e-9 relative margin keeps floating-point rounding admissible.
- **Dijkstra** (same code with h = 0) is the reference. Every `/api/route` response includes both costs and an `equal` flag.
- **Nearest facilities**: multi-target Dijkstra on estimated time from the user's point, stopping after k facilities are settled, so "nearest" means
  shortest estimated road travel time, not straight-line distance.

**Measured** (`app_data/geo/benchmark.json`, 400 random origin-destination pairs × both weights, development laptop, pure Python):
A* matched Dijkstra's optimal cost in **400/400** cases. Median **5.7 ms vs 9.5 ms**, and A* expanded **2.9×** fewer nodes (3.8× for distance, where the heuristic is tighter).
Loading the Greater Dhaka graph takes about 0.3 s.

## 4. Interface

- Clustered facility markers (blue hospitals, teal clinics), search by name/area (local) plus place search (MapTiler geocoding, Bangladesh only),
  permission-based geolocation or click-to-set start, smooth camera moves (instant under reduced motion), navigation/fullscreen/scale controls.
- Route panel: fastest (estimated, green with direction arrows, drawn progressively) vs shortest (dashed blue), distance, time, nodes expanded, runtime
  and the Dijkstra check. Snap distances and speed assumptions are printed under the numbers.
- Facility panel: names (English/Bangla where mapped), operator, address, click-to-call phone, website, tagged emergency department, last OSM edit, source link.
- Layers: facilities, city-level forecast pills (aggregate of synthetic wards for the selected origin; a calendar input picks the week), current Open-Meteo
  weather with observation time, DGHS boundaries, and 3D buildings (MapTiler's OpenMapTiles building heights; toggle disabled if the basemap lacks them).
- **Emergency help** in the header of every page opens instantly with no API call: tap-to-call 999 and 16263, WHO warning signs, and "find the nearest
  hospitals by road". The Copilot has a read-only `find_health_facilities` tool over the same data.

## 5. Intro

`frontend/components/intro.tsx`: a procedural 3D mosquito (the same primitives as the Learn page; no external model) flies a wandering path, approaches
the pointer and dodges when it gets close. Click, tap, Enter or Space swats it; it tumbles away and a circular reveal opens onto the dashboard, which has
been loading underneath the whole time. It plays once per browser session, never on internal navigation, is skipped under `prefers-reduced-motion` or
`?nointro`, falls back to an animated SVG without WebGL or on low-end devices, and keeps **Skip intro** and **Emergency help** visible throughout.

## 6. Limits

- Travel times ignore traffic, which dominates real Dhaka journeys; treat them as relative.
- OSM coverage of facilities and phone numbers is incomplete (only 59 of 914 have a phone number). A facility missing from OSM is missing here.
- Routing covers Greater Dhaka and Chattogram only.
- Routing targets motor vehicles (ambulance/car), not walking or rickshaw.
