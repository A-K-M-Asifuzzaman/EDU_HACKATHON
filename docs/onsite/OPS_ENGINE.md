# Operations engine (Response page)

Branch `ops-engine`, not merged and not deployed. This document covers what changed on the Response page, where each number on
screen comes from, and how it is tested.

## 1. What it is

The four Phase 2 decision modules now sit in one dark section, `#engine`, in causal order:

| Stage | Module (anchor) | API it reads | What changes it |
|---|---|---|---|
| 01 Allocate | Supply allocation (`#supply`) | `/api/allocation/plan` | city, service level, stock, crews, priority settings |
| 02 Surge | Hospital surge (`#surge`) | `/api/overflow/plan` | city, service level, ward beds (%), typed ward beds |
| 03 Intervene | Vector control (`#vector`) | `/api/intervention/simulate` | crews, deployment mode, assumed effect |
| 04 Dispatch | Dispatch briefs (`#dispatch`) | `/api/dispatch/brief` | the whole scenario |

All four still use the one shared plan state (`usePlanState`); the old anchors and every module's own controls still work.

```
 scenario controls (city, plan for, stock, crews, ward beds, assumed effect)
        │ same shared state the stage controls write
        ▼
 FORECAST ─► DEMAND ─► ALLOCATION ─► SURGE ─► INTERVENTION ─► DISPATCH      ← causal rail (sticky on desktop)
   743 cases  224 beds   60% supplied  53 without   63.2 fewer cases  S-…     each node = a stage's own API result
                                       a bed
```

- **Causal rail.** Each module publishes the API response it already fetched through `report(key, value)` on the shared plan state;
  the rail only formats it. No second request, no client-side model. `report` ignores content-equal values, so a re-render can never
  turn into a loop. A node flashes once (CSS, 1.1 s) only when its own value changes; nothing animates while idle.
- **Scenario controls.** Presets for city, service level, stock (30/60/100%), crews (0/20/40/60), ward beds (baseline, +20, +30,
  +50%) and the assumed crew effect (cautious, moderate, strong). They set the same state the stage sliders set; a custom slider
  value is shown as "set to …". On phones the same controls open in a bottom sheet (native `<dialog>`), and a bottom bar jumps
  between the four stages (scroll position comes from an `IntersectionObserver`, no scroll listeners).
- **Kept apart, on screen.** Stock limits supplies, never beds; Stage 2 beds are a separate illustrative number and are never
  added to stock (the map inspector shows "Stage 1 bed stock" next to the illustrative beds, labelled as a comparison). Beds change
  the overflow, never the forecast: the rail's Forecast and Demand nodes do not move when beds change (tested). Crew effects are
  assumptions.

## 2. Stage 01: where the stock goes

`components/allocation-flow.tsx`. One lane per stock pool (city); lane width follows ward count, so a ward column has the same
width in every pool. Wards stand in priority order. Column height is the ward's need, the solid part what it was allocated, the
hatched part what is still needed; a white tick marks the fairness floor; dots below are crews (filled assigned, hollow still
needed). The pool bar and the line `Pool S = A placed + L left over` restate the API's own fields (`supply`, `allocated`,
`surplus`) and say so if they ever fail to add up. Bars grow by `transform` only, staggered by priority rank, so stock visibly
fills the highest priority first. Saline, kits and beds switch with one control. Arrow keys, Home and End move between wards
(roving tab stop); the side panel shows the selected ward.

## 3. Stage 02: two views of one overflow plan

### Ward transfer network (default, works offline)

`components/surge-network.tsx`. One cluster per city: patients never cross cities. Each ward is a bed ledger, one cell per bed,
bottom-up: own patients, patients received, empty beds, then the overflow above the white bed line: moved out, then no bed in the
city. Arcs are exactly `transfers` from `/api/overflow/plan`, thickness by patients, labelled with the count; they draw in once when a
link appears and never loop. Positions follow ward IDs only: the synthetic wards have no coordinates, so this is not a map and
shows no routes or travel times.

- At baseline beds the peak week is a city-wide surge: no ward has a spare bed, so the network shows **zero arcs** and each city
  says why ("No ward in Dhaka North has a spare bed, so no patient can move.").
- At +20% beds the API returns 9 transfers in Chattogram, Dhaka North and Dhaka South; the network draws those 9 links and nothing
  else. +30% and +50% redraw from the recomputed plan.
- "Against the previous setting" shows the change in patients moved and patients without a bed.
- Hover or click a ward (or use the arrow keys and Enter) for demand, beds, overflow, moved out (to which wards), received (from
  which wards), spare beds after moves and patients with no bed. Click a city header for the city summary. The transfer and ward
  tables below list the same numbers exactly.

### Hospital map (geographic)

`components/surge-map.tsx`, loaded only when opened (MapLibre via the existing `CommandMap`).

- Blue points: the 631 OpenStreetMap hospitals bundled in `app_data/geo` (`/api/facilities?kind=hospital`). Each record shows
  its emergency tag as tagged (community-mapped) or unknown, and its source. An OSM `beds` tag, where one exists, is shown only as
  an unverified tag and is never used in planning. **No hospital is given an available-bed count.**
- City gauges: one per forecast city at its city centre (`CITY_POS`), showing projected bed need, illustrative beds, patients moved
  and patients without a bed for that city. They are labelled as sums of synthetic wards. **No ward is placed on the map** (tested:
  five markers, none with a ward ID).
- Routing: tap the map to set a start point; the bundled road graph returns the nearest hospitals by estimated road time
  (`/api/emergency/nearest`) and draws the fastest route. Pick a hospital (map or search) and "Route from the start point" draws
  the A* fastest and shortest routes (`/api/route`). Travel times use assumed road speeds.
- Offline: facilities, roads and routing are bundled; without the internet the basemap falls back to a blank background and the
  points, gauges and routes still draw. The overflow mathematics never depends on the map, MapTiler, Firebase or any external API.
- The chosen city is shared between the two views.

## 4. Look and motion

- The engine is one obsidian bay (`.ops-engine` tokens in `app/globals.css`): stage `#0e0f1a`, panels `#151729`, lines `#2a2d4a`, a
  faint 32 px grid. Resource colours mark data only (saline `#5fc3f0`, kits `#ffc23d`, beds `#b4a6ff`, crews `#3fd3a5`,
  shortage `#ff6b72`); text always uses the ink tokens (smallest text `#9ea3c9` on `#151729` is 7.2:1). Risk colours are unchanged.
- The container carries `data-theme="dim"`, so every existing dark-mode rule applies inside it; charts detect the dark container
  (`echart.tsx` checks `closest('[data-theme="dim"]')`).
- Motion is transform-only (bars, bed segments, bed line) or a one-shot stroke draw (arcs) and a one-shot rail flash. Every one of
  them starts because a computed number changed. Under reduced motion all of them are instant (global rule). There are no timers,
  intervals or animation loops; the idle test watches the whole engine for 3 seconds and sees zero DOM mutations.

## 5. Tests

`frontend/tests/e2e/ops-engine.spec.ts` (all against the real local API, origin 2024-08-05, horizon 3):

| Test | Checks |
|---|---|
| rail | each node shows its stage's API result; +20% beds changes Surge only; stock 100% changes Allocation, not Surge |
| network | 0 arcs at baseline with the zero-transfer message; at +20% and +30% arc count = API transfers, arc labels sum to API `transferred`, every link same-city, no receiver above its spare beds, sent = received = transferred, each cluster lists only its own city's links; previous-setting comparison shown |
| races | a slow +20% answer, then +50%, then Baseline: the page settles on Baseline (53 without a bed, 0 arcs) |
| keyboard | ward glyphs and allocation columns take focus and arrow keys; inspectors follow |
| map | 631 OSM hospitals, exactly 5 city gauges, no marker carries a ward ID, city selection carries to the network |
| idle | 0 DOM mutations in `#engine` over 3 s after everything loaded |
| phones | 360 and 390 px: no sideways scroll, stage bar visible, scenario sheet changes beds |

`offline.spec.ts` (network cut off) now also checks that the ward network draws one arc per transfer at +20%.
The existing allocation, hospital, vector, dispatch, axe (light and Dim) and landing suites run unchanged.

## 6. Screenshots and measurements

Before (production `79b9fa5`, 27 Nov): [supply](media/ops_before_supply_1440.jpg), [hospital surge](media/ops_before_surge_1440.jpg).
After (this branch, local API, +20% beds where the network is shown):

| Width | Engine top | Ward transfer network |
|---|---|---|
| 360 | [engine](media/ops_after_engine_360.jpg) | [network](media/ops_after_network_360.jpg) |
| 390 | [engine](media/ops_after_engine_390.jpg) | [network](media/ops_after_network_390.jpg) |
| 768 | [engine](media/ops_after_engine_768.jpg) | [network](media/ops_after_network_768.jpg) |
| 1024 | [engine](media/ops_after_engine_1024.jpg) | [network](media/ops_after_network_1024.jpg) |
| 1440 | [engine](media/ops_after_engine_1440.jpg) | [network](media/ops_after_network_1440.jpg) |

Also: [allocation instrument at 1440](media/ops_after_allocation_1440.jpg) and [at 360](media/ops_after_allocation_360.jpg),
[hospital map with a nearest-hospital route](media/ops_after_map_1440.jpg) (blank basemap: the test build has no MapTiler key).

What changed for hospital surge: the five city cards and the Sankey chart are replaced by the ward network (one cell per bed, exact
transfer arcs, a zero-transfer explanation per city, a comparison with the previous setting) and the hospital map. The KPIs,
alert, transfer table, editable ward table and the six separate bed numbers are unchanged.

Measured locally (production build served by the API, Chromium, MacBook): every stage reported to the rail about 1.1 to 1.2 s after
navigation at all five widths; 0 DOM mutations in the engine over 3 s idle; no page reaches sideways scroll at 360 to 1440 px.
The map code (MapLibre) loads only when the map view is opened.

## 7. Also on this branch

- The landing footer now shows two stamps: `Interface <commit>` (stamped into the static build from git, or Vercel's commit SHA) and
  `API <commit>` (from `/api/health`). Before, the single "Build" stamp was the API commit only.

## 8. Not done yet

- Stages 03 and 04 sit in the engine with its look but keep their previous layouts (no new visual for vector control or dispatch).
- The map's basemap stays light; a dark basemap needs a MapTiler style choice.
