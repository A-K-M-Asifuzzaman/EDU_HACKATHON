# Three-minute demo: walkthrough and voiceover

Run `./scripts/launch.sh` beforehand and open http://127.0.0.1:8000 in a 1440 px window. Everything below uses the real application
(Historical Replay on the synthetic organizer data), no slides. Figures quoted come from the replay table for **DNCC_Ward_19, origin
5 Aug 2024, 3 weeks ahead**; re-check them on screen before recording, because they change if the origin or ward changes.
Keep the Copilot question short, since each answer costs about $0.003 of OpenAI credit and needs the key in `.env`.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:10 | New tab: the intro. Move the pointer (the mosquito dodges), click to swat; the dashboard is revealed | "This is DengueShield AI. One swat and the Command Center opens; it was loading underneath the whole time." |
| 0:10-0:35 | **Command Center** hero. DNCC_Ward_19, origin 5 Aug 2024, 3 weeks. Point at the verdict row, then press ▶ on the scrubber for two steps and pause | "Weekly dengue forecasts for 60 wards, two to four weeks ahead, on the organizers' synthetic data, so this is a Historical Replay. This ward: median 13, 80% interval 8 to 18, outbreak probability 83%. The time machine shows what really happened: 20 cases. The alert was right, but both intervals missed, which is our documented weakness at peaks. Press play and every week is a genuine out-of-time forecast." |
| 0:35-1:05 | **Model Evidence → Reliability center**. Point at 0.607 / 0.740, then drag the alert threshold slider | "Every number here comes from saved out-of-time predictions. Intervals are honest on average but cover only 61% of peaks at the 80% level. The alert simulator lets an officer trade recall against false alerts, and it shows the honest comparison: the deployed rule, F1 0.61, versus re-choosing the threshold on prior seasons, 0.59. Picking the best threshold in hindsight looks better, and we label it optimistic." |
| 1:05-1:50 | **Map & Emergency Routing**: Use my location, search "Square Hospital", Route from start, toggle **A\* Algorithm Insight**, then "Nearest hospitals by road" | "914 real hospitals and clinics from OpenStreetMap. Routing is genuine A* on the directed road network: one-way streets, fastest versus shortest, and each route checked against Dijkstra. Insight mode shows why A* is faster: it explored about six times fewer nodes for the same optimal cost. Nearest hospitals are ranked by road time, and we never invent beds or doctors on duty." |
| 1:50-2:05 | Header **Emergency help** | "On every page, even when the API is down: tap-to-call 999 and the DGHS line 16263, WHO warning signs, one tap to the nearest hospitals." |
| 2:05-2:30 | **Response Intelligence → Resource planning sandbox**, 10 teams | "With ten field teams, risk-blind placement would have reached 15% of real outbreak ward-weeks in 2024; risk-based placement about 34%. Forecast and simple history are close, and we say so. It's a planning simulation, not a claim of prevented infections." |
| 2:30-2:50 | **Copilot**: "How often does the outbreak alert miss real outbreaks?" | "The Copilot answers only from read-only tools over the app's own evidence, with citations, in English or Bangla." |
| 2:50-3:00 | Command Center → **Download intelligence brief** | "And every view becomes a one-page brief with uncertainty, provenance and limitations. Thank you." |

## Fallbacks if something fails live

- No internet: skip Climate Observatory and the Copilot sentence. The forecast, evidence and profiling pages are local.
- No OpenAI key or credit: the Copilot returns retrieval-only passages; say so and move on.
- Map not loading (no MapTiler key): the map falls back to a blank basemap; facilities, routes and the directory still work.
- Location permission denied: click the map to set the start point.
- To replay the intro: open a new tab, or remove `ds.intro.seen` from session storage; add `?nointro` to skip it.
