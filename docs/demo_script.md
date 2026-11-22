# Three-minute uncut demo: voice script

The video is one continuous screen recording of the deployed site (https://dengueshield-ai.vercel.app), with no cuts and no slides.
`frontend/scripts/record-demo.mjs` drives the browser and paces every scene to the voice.

## How to record the voice

- Read the 11 sections in order, in one audio file (m4a, mp3 or wav), in a quiet room.
- **Leave a clear pause of about 2 seconds between sections** (marked ⏸). The recorder finds the sections by these pauses, shortens them to 0.7 s, and then records the screen so that each scene starts exactly when its section starts.
- Do not pause for 1.5 seconds or longer *inside* a section.
- Aim for a calm pace. The whole read should be **under 2 min 55 s** once the pauses are shortened. A reading of about 3:15 with the pauses still in is fine.
- Then run `DEMO_AUDIO=/path/voice.m4a node scripts/record-demo.mjs` from `frontend/`. The output is `~/Desktop/DengueShield_demo/dengueshield_demo_final.mp4`.

## Script

| # | On screen (automatic) | Voice |
|---|---|---|
| 1 | Intro: the mosquito flies, one click swats it, the dashboard opens | This is DengueShield AI, running live on our deployed website. One swat, and the dashboard opens. ⏸ |
| 2 | Pointer on Ward, Forecast origin, 3 weeks; scrolls to Weather context | An officer chooses three inputs: a ward, a forecast week, and how far ahead, two to four weeks. Here: Dhaka North ward 19, the week of 5 August 2024, three weeks ahead. The model only uses data available before that week: past case counts, temperature, humidity, and rainfall summed over the previous weeks. ⏸ |
| 3 | Back to the ward forecast, fan chart, risk tier, time-machine verdict | The prediction: a median of 13 cases, an 80 percent interval of 8 to 18, an 83 percent chance of an outbreak, and the risk tier, Critical. This is a historical replay of the organizers' synthetic data, so we can check what really happened: 20 cases. The alert was right, but the interval missed the peak. ⏸ |
| 4 | "What drives this forecast", then "Which rainfall does this forecast use?" | Why Critical? The driver breakdown shows the season and recent rainfall pushing risk up, plus this ward's vulnerability. The lag is explicit: the strongest weather signal is rainfall three weeks before the target week, the mosquito breeding cycle. Rain after the forecast week is never used. ⏸ |
| 5 | Clicks 4 weeks, back to 3 weeks, then ▶ time machine | Change any input and the forecast updates. Press play, and every week is a real out-of-time forecast from a model trained only on earlier seasons. ⏸ |
| 6 | Ward Risk Explorer: risk matrix | The ward risk matrix shows all 60 wards at once, as Low, Medium, High and Critical, so teams can target the worst wards first. ⏸ |
| 7 | Model Evidence: validation by season, coverage at peaks (0.607) | Model Evidence shows how far to trust it. It is a ridge Poisson regression, tested season by season on years it never saw. The error is about 1.4 cases per ward per week, three weeks ahead. Intervals cover 85 percent of weeks overall, but only 61 percent at peaks, and we show that openly. ⏸ |
| 8 | Map: Use my location, search Square Hospital, route, Dijkstra check, A\* insight, nearest hospitals | For the response, the map shows 914 real hospitals and clinics from OpenStreetMap. From Old Dhaka, I search Square Hospital and route there. This is A-star search on the real road network, with one-way streets, and every route is checked against Dijkstra: the same optimal cost. Insight mode shows A-star explores far fewer nodes. Nearest hospitals are ranked by travel time on the roads. ⏸ |
| 9 | Emergency help dialog: 999, 16263, warning signs | Emergency help is one click away on every page: 999, the DGHS health line 16263, and the WHO warning signs. ⏸ |
| 10 | Response Intelligence: resource planning sandbox | With ten field teams in 2024, risk-blind placement reached 15 percent of real outbreak ward-weeks. Risk-based placement reached about 34 percent. It is a planning simulation, not a promise. ⏸ |
| 11 | Back to Command Center, switches to Bangla | And everything also works in Bangla. Thank you. |

Figures are from the live site (DNCC_Ward_19, origin 5 Aug 2024, 3 weeks ahead, Historical Replay): median 13, 80% interval 8–18,
P(outbreak) 0.83, Critical, observed 20; MAE 1.39 at 3 weeks (2022–2024); 80% interval coverage 0.854 overall, 0.607 at high-incidence weeks;
2024 sandbox with 10 teams: 14.9% equal, 34.4% historical, 33.3% forecast.

## Fallbacks

- The recorder warms the API first. If a step is late, the log lists it. Run it again; the backend is cached after the first take.
- To run against a local launch instead: `DEMO_URL=http://127.0.0.1:8000`.
