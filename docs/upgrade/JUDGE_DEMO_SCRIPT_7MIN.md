# Seven-minute uncut demonstration (run sheet)

Status: script final; **no video has been recorded, uploaded or submitted by this work.** Check the organizer PDF
(`Hackathon_Phase2_Problemset.pdf`) for the upload rules before recording. Numbers below are engine outputs on the final build
(development laptop); confirm them once on the recording laptop, they depend only on the dataset and the code.

## Before recording

Follow [WIFI_OFF_CHECKLIST.md](WIFI_OFF_CHECKLIST.md). Open `http://127.0.0.1:<port>/response/?origin=2024-08-05&horizon=3` and
`/geography/` in two tabs; close everything else.

## Script

| Time | Screen and clicks | Say (short) | Expected values |
|---|---|---|---|
| 0:00-0:25 | Wi-Fi icon off; landing footer stamps; open Response | "Offline laptop. Every forecast, plan and brief here runs locally on the organizer's synthetic data." | footer shows interface and API commits |
| 0:25-0:55 | Priority wards; horizon 2/3/4 | "Ridge Poisson GLM, 2-4 weeks ahead with 80 and 90% ranges; 2025 stays sealed." | Dhaka North upper 80%: 188 / 243 / 303 cases (weeks 2-4) |
| 0:55-1:55 | `#prepare` → **Mentor demonstration**; bed boards; **Play 28 days** | "Hospitals are already full of other patients. Grey: other illnesses; lilac: dengue; amber: the protected reserve." | 179 other-illness + 33 dengue patients now; 260 beds |
| 1:55-2:50 | Answer tiles; threshold gauges; stockout countdown; timeline | "Need crosses the reserve in week 1 and beds run out in week 1 under this shock; saline runs out on day 8." | 299 need / 260 beds; 66 extra beds; 2,669 saline and 1,303 kits to keep safety stock |
| 2:50-3:40 | Shock chips Forecast → +100%; crisis laboratory | "Same engine, three states; shortages that remain are shown." | Baseline Critical → crisis Emergency Surge → Critical after response |
| 3:40-4:35 | Inventory policies; referral plan (28-day) | "Moving 520 bags from the referral centre plus orders leaves 58 unmet, against 2,511 with no action. The 28-day integer program places all 60 patients who had no bed; checked by re-simulation." | 2,511 / 116 / 1,991 / 58; 60 → 0 |
| 4:35-5:20 | Scroll to Operations engine: Allocate lanes, Surge network Baseline → +20% | "Official Stage 1 and 2: zero transfers at baseline because no ward has a spare bed; at +20% exactly the API's 9 same-city links." | 53 → 16 patients without a bed |
| 5:20-6:00 | `#prepare` real hospitals: **Search from the Dhaka North centre**; 999 chip; Geography tab card | "Real OSM hospitals by road time and district; capacity and availability are unknown, so we say so; call first." | "Bed availability unconfirmed — contact hospital." |
| 6:00-6:30 | Stage 03 crews; preparation plan CSV; Stage 04 PDF | "Crews change the scenario under a simulated effect; the brief carries the same scenario id as the screen." | id on screen = id in the file |
| 6:30-7:00 | Data sources panel; terminal `offline_verify` result | "Synthetic data, fictional planning hospitals, every number checked; 28 of 28 offline results identical." | checks "holds"; 28/28 |
