# Three-minute demo: walkthrough and voiceover

Run `./scripts/launch.sh` beforehand and open http://127.0.0.1:8000 in a 1440 px window. Everything below uses the real application
(Historical Replay on the synthetic organizer data), no slides. Figures quoted come from the replay table for **DNCC_Ward_19, origin
5 Aug 2024, 3 weeks ahead**; re-check them on screen before recording, because they change if the origin or ward changes.
Keep the Copilot question short, since each answer costs about $0.003 of OpenAI credit and needs the key in `.env`.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:12 | Fresh tab (new session). The intro: move the pointer, the mosquito dodges; click to swat; the dashboard is revealed | "DengueShield AI. Swat the mosquito and the Command Center opens: it was loading underneath the whole time." |
| 0:12-0:40 | **Command Center**, DNCC_Ward_19, origin 5 Aug 2024, 3 weeks. Hover the fan chart | "We forecast weekly dengue cases for 60 wards, two to four weeks ahead, on the organizers' synthetic data, so this is a *Historical Replay*. For this ward the median is 13 cases, 80% interval 8 to 18, outbreak probability 83%. The observed 20 fell outside: intervals under-cover peaks, and we say so next to the alert." |
| 0:40-0:58 | **AI Forecast Lab**, toggle horizon 2 / 3 / 4 | "One ridge Poisson model per horizon. Every number splits into seasonality, rainfall and ward vulnerability." |
| 0:58-1:18 | **Model Evidence** | "Validation is chronological, with calibration nested inside. MAE is 1.1, 1.4 and 1.5 cases for 2, 3 and 4 weeks. Boosting and ensembles gave no reliable gain, so we kept the simplest model. 2025 stays locked." |
| 1:18-2:05 | **Map & Emergency Routing**: search "Square Hospital", Use my location (or click the map), Route from start. Then "Nearest hospitals by road". Toggle 3D buildings | "This map uses 914 real hospitals and clinics from OpenStreetMap. Routing is genuine A* on the directed road network: one-way streets respected, fastest versus shortest compared, and each route checked against Dijkstra (equal on 400 of 400 test routes). Nearest hospitals are ranked by estimated road time, not straight-line distance. City discs show the forecast at city level only, because the synthetic ward IDs cannot be placed on real wards. And we never invent beds or doctors on duty." |
| 2:05-2:20 | Header **Emergency help** | "On every page: tap-to-call 999 and the DGHS health line 16263, WHO warning signs, and one tap to the nearest hospitals." |
| 2:20-2:45 | **Copilot**: "Which wards are highest risk for 5 August 2024?" then "Find hospitals in Gazipur with a phone number" | "The Copilot answers only from read-only tools over the app's own data and cites them, in English or Bangla." |
| 2:45-3:00 | **Climate Observatory**, then System & Provenance | "Real NASA POWER and Open-Meteo weather sits beside the synthetic data and never feeds the model; every external service is optional. Thank you." |

## Fallbacks if something fails live

- No internet: skip Climate Observatory and the Copilot sentence. The forecast, evidence and profiling pages are local.
- No OpenAI key or credit: the Copilot returns retrieval-only passages; say so and move on.
- Map not loading (no MapTiler key): the map falls back to a blank basemap; facilities, routes and the directory still work.
- Location permission denied: click the map to set the start point.
- To replay the intro: open a new tab, or remove `ds.intro.seen` from session storage; add `?nointro` to skip it.
