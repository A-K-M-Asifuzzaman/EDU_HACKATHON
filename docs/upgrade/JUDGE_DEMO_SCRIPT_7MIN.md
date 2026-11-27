# Seven-minute uncut demonstration (run sheet)

Status: script ready; **no video has been recorded, uploaded or submitted by this sprint.** Check the organizer PDF
(`Hackathon_Phase2_Problemset.pdf`) for the exact upload rules before recording.

## Before recording (once, with the internet on)

1. `git switch upgrade/championship-engine-v2` in a prepared clone; data in `data/raw`, Python environment and `frontend/node_modules` present.
2. Build: `cd frontend && npm run build`.
3. Switch Wi-Fi **off**. Start: `scripts/launch_offline.sh` (serves the dashboard and API on one loopback port, offline guard on).
4. Open `http://127.0.0.1:<port>/response/?origin=2024-08-05&horizon=3` in one tab, `/geography/` in a second. Close everything else.
5. Optional proof before you start: `python scripts/offline_verify.py --base http://127.0.0.1:<port> --compare killswitch/baseline.json` (28 of 28).

## Script

| Time | Screen and clicks | Say (short) | Expected values (engine output, origin 5 Aug 2024, Dhaka North) |
|---|---|---|---|
| 0:00-0:25 | Wi-Fi icon off; landing footer stamps; Response page | "Offline laptop. Forecasts, plans and briefs run locally. Our mission: tell hospitals what to prepare before dengue arrives." | footer shows interface and API commits |
| 0:25-0:55 | Priority wards; horizon chips 2/3/4 | "Ridge Poisson model, 2-4 weeks ahead, with 80 and 90% ranges; 2025 stays sealed." | Dhaka North forecast 188 / 243 / 303 cases at the upper 80% |
| 0:55-1:55 | `#prepare` → **Mentor demonstration**; point at a bed board | "Hospitals are already full of other patients. Grey cells: other illnesses. Lilac: dengue. Amber: the reserve we protect." | 179 other-illness + 33 dengue patients now, 260 beds |
| 1:55-2:50 | Executive tiles; timeline; inventory panel | "Projected need crosses the reserve in week 1; saline runs out in week 2. Reorder point = lead-time demand + safety stock." | 299 need / 260 beds; 66 extra beds; 2,669 saline, 1,303 kits to order |
| 2:50-3:40 | Shock chips: Forecast → +100% → +200%; crisis laboratory | "A sudden outbreak: the same engine, three states. Nothing is hidden: remaining shortages stay in the table." | status Critical → Emergency Surge; response bed gap 0, 116 saline still unmet |
| 3:40-4:35 | Scroll to **Operations engine**: Allocate lanes, Surge network (Baseline → +20%) | "Official Stage 1 allocation and Stage 2 overflow: zero transfers at baseline because no ward has a spare bed; at +20% exactly the API's 9 links." | 53 → 16 patients without a bed; 9 transfers |
| 4:35-5:20 | `#prepare` → **Search from the Dhaka North centre**; tap 999; second tab: Map & Emergency Routing route | "Real hospitals from OpenStreetMap by road time, then neighbouring districts, then Chattogram by straight line. Capacity unknown: call first." | tiers with "Bed availability unconfirmed — contact hospital." |
| 5:20-6:05 | Stage 03 Intervene; crews 0 → 20 → 40 | "Vector control changes the scenario cases under an assumed effect; never a measured reduction." | about 63 fewer cases at 20 crews (assumed) |
| 6:05-6:35 | Preparation plan → CSV; Stage 04 Dispatch PDF | "Same settings, same scenario id, same bytes." | scenario id on screen equals the id in the file |
| 6:35-7:00 | Data sources panel (provenance, checks) | "Fictional planning hospitals, real forecast, every number checked: flow, conservation, max-flow certificate. All offline." | checks: all "holds"; "match" |

Values above were produced by the engine on the development laptop; confirm them once on the recording laptop and adjust the
spoken numbers if the dataset or build differ.
