# Phase 2 onsite, Stage 4: offline resilience and deterministic dispatch

Stage 4 only. At the time of writing nothing was merged or deployed. **Update:** the owner later merged Stage 4 into `main`
(PR #6, `7cf8e0d`) and released the backend; see [`FINAL_RELEASE.md`](FINAL_RELEASE.md) section 9b for the current production state.

What a judge can do with Wi-Fi switched off, on a laptop prepared once:
- start DengueShield
- forecast 2 to 4 weeks ahead
- change stock, crews, city, horizon, service level, priority weight and fairness floor
- run hospital overflow with any illustrative capacity
- optimize spraying crews and simulate their 2 to 4 week effect
- produce SMS, WhatsApp, HTML and PDF dispatch briefs

This was checked automatically with the network cut off, on macOS and on Linux in CI.

## 1. Offline architecture

```
browser ──HTTP on 127.0.0.1──> FastAPI (uvicorn, one process)
                                 ├─ serves the built dashboard (frontend/out: HTML, JS, CSS, self-hosted fonts)
                                 ├─ forecasts: replay table (app_data/replay.csv.gz) + deployed bundle (models/dengueshield_B.joblib)
                                 ├─ Stage 1 allocation, Stage 2 overflow, Stage 3 simulator, dispatch: pure Python on local data
                                 ├─ routing: local road graphs and facility list (app_data/geo)
                                 └─ offline guard (DENGUESHIELD_OFFLINE=1): every non-loopback connection and DNS lookup is refused and recorded
optional, online only: Copilot generation (OpenAI), live weather (NASA POWER, Open-Meteo), DGHS ward polygons,
                       Firebase sign-in, basemap tiles (MapTiler, fetched by the browser)
```

- One process on one loopback port; no CDN. `scripts/offline_check.py` scans the built pages and stylesheets for external scripts,
  styles, images or fonts and found none.
- Offline mode is set by `scripts/launch_offline.sh`. The API then refuses and records every outbound connection, and
  `GET /api/system/offline` reports the mode, the artifact check, the service states and every refused attempt. The header shows an
  "Offline mode: local engines" chip ([screenshot](media/stage4_offline_header.jpg)).

## 2. Startup commands

| When | Command | Network |
|---|---|---|
| Once, while online | `./scripts/setup.sh`: Python venv, `pip install -r requirements.txt`, both datasets (checksum-verified), `npm ci`, dashboard build, readiness check | needed |
| Every offline session | `./scripts/launch_offline.sh`, then open http://127.0.0.1:8000/response/ | none |
| Check readiness only | `python scripts/offline_check.py` (add `--fast` to skip checksums) | none |
| Online, as before | `./scripts/launch.sh` (setup, then serve) | needed |

`launch_offline.sh` never runs npm, pip, git or a download (a test checks this). It starts only after the readiness check passes. If
anything is missing it stops with exit code 3, lists each missing file, and gives the command that restores it. Nothing is created in
place of a missing file. Without a Python environment it stops with exit code 2. On Windows, run the same steps by hand:
`set DENGUESHIELD_OFFLINE=1`, `python scripts\offline_check.py`, `python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port 8000`.

## 3. Local artifacts

Checked by `scripts/offline_check.py` and shown at `GET /api/system/offline`:

| Artifact | Purpose |
|---|---|
| `data/raw/bangladesh_dengue_large_dataset.csv` (SHA-256 checked) | forecast inputs; 2025 rows dropped as bytes before parsing |
| `data/raw/onsite/bangladesh_dengue_large_dataset_onsite.csv` (SHA-256 checked) | illustrative bed capacity; 2025 dropped |
| `models/dengueshield_B.joblib` | deployed forecasting bundle, used only for targets past its training window |
| `app_data/replay.csv.gz` | validated replay forecasts for 2019-2024 targets (each season from models fitted on earlier seasons) |
| `app_data/resource_rules.json` | saline, kit and bed rule (identified on 2016-2018) |
| `app_data/validation.json`, `app_data/profile.json` | evidence and data profile pages |
| `app_data/geo/greater_dhaka_graph.npz`, `chattogram_graph.npz`, `facilities.geojson` | offline road routing and facility directory |
| `frontend/out/index.html`, `frontend/out/response/index.html` | built dashboard |
| Python modules: fastapi, uvicorn, pandas, numpy, scipy, sklearn, joblib, httpx, pydantic | runtime |

## 4. Network kill-switch procedure

**For judges (manual).** On a laptop where `./scripts/setup.sh` has run once:
1. Switch Wi-Fi off (and unplug Ethernet).
2. `./scripts/launch_offline.sh`, then open http://127.0.0.1:8000/response/. The header shows "Offline mode: local engines".
3. Run a forecast: Command Center at 2, 3 and 4 weeks, or the Priority wards table.
4. Supply allocation: move "Regional stock" (for example to 40%), crews, city, horizon, "Plan for", risk weight and fairness floor.
5. Hospital surge: the baseline shows the city-wide shortage; choose "+20% surge beds" or type a ward capacity.
6. Vector control: Optimized deployment, any preset, sensitivity; the Supplies and Hospital tabs show downstream effects.
7. Dispatch briefs: pick a ward, then Copy SMS, Copy WhatsApp, HTML brief, PDF brief, City summary, Wards needing attention.
8. Open the downloaded PDF in any viewer.

Every number matches the online run (section 5).

**Automated (what CI and I ran).** `scripts/killswitch.sh` cuts the internet off but keeps loopback:
- **Linux:** a private network namespace (`unshare --net`) in which only `lo` exists. A browser offline mode would also block
  localhost and is not used.
- **macOS:** a `sandbox-exec` profile that denies every outbound connection except to localhost.

Inside, `scripts/killswitch_inner.sh`:

| Step | Check |
|---|---|
| 1 | Proves 1.1.1.1, 8.8.8.8, 140.82.112.3 and example.com are unreachable (it aborts if any connects) |
| 2 | Starts the server with `scripts/launch_offline.sh` |
| 3 | Compares 21 API results byte for byte with an online baseline from `scripts/offline_verify.py`: forecasts at 2, 3 and 4 weeks, one ward forecast, the January 2025 forward forecast, supply at 30/50/75/100% stock, a Gazipur plan with other crews/service/horizon/weights, overflow at three capacity settings, vector control in four configurations, and every dispatch format |
| 4 | Drives the 12-step browser workflow (`frontend/tests/e2e/offline.spec.ts`), checking every UI number against the local API and saving screenshots and the PDF |
| 5 | Checks the server's record of refused outbound attempts |

Results:

| Run | Server ready | API results identical | Browser workflow | Refused server attempts | External hosts the page tried |
|---|---|---|---|---|---|
| macOS (sandbox-exec), this laptop | 3 s | 21 of 21 | passed, 7.0 s | 0 | only the test's own `example.com` probe |
| Linux CI (network namespace), [job](https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45956574258/job/140364680041) | 4 s | 21 of 21 | passed, 25.5 s | 0 | (same test) |

Every result hash from the Linux run equals the macOS run, including the deployed model's inference for 2025 targets. The results
are reproducible across machines and operating systems, not only between online and offline runs on one machine. Evidence:
`exports/offline/` and the CI artifact `killswitch-evidence` (screenshots, PDF, logs).

## 5. Offline engines verified

| Engine | Offline evidence |
|---|---|
| Forecasting, 2-4 weeks | replay for 2019-2024 targets, bundle only past its training window, in-sample refused (Stage 2). Identical hashes offline at every horizon. |
| Stage 1 allocation | stock 30/50/75/100%, crews, city, horizon, service level, risk weight and floor. Identical hashes; the UI matches the API at 40% stock (saline 705 of 1,767). |
| Stage 2 overflow | baseline, +20% capacity and typed capacity: same-city transfers, deficits, unresolved shortage (53 at baseline, 16 at +20% with 9 transfers). Identical hashes. |
| Stage 3 simulator | optimized, manual, supply-plan and Strong preset: 63.2 cases prevented by default, with the downstream resource and hospital changes. Identical hashes. |
| Dispatch | brief JSON with all text formats, ward PDF, city summary HTML, multi-ward PDF. Identical hashes. |

Owner decisions are kept: the Cautious, Moderate and Strong illustrative presets with Moderate as the default; 50-150% sensitivity
labelled as an assumption; one deployment at the forecast date with no fading and no repeat rounds; a shared crew budget with crews
per city shown in the vector-control headline and the city summary.

## 6. Dispatch engine

- **One canonical object.**
  - `dengueshield/dispatch.py` builds a ward brief by copying numbers from the Stage 1, 2 and 3 engine outputs for one scenario. It
    computes nothing new.
  - The brief contains: ward, risk and priority; forecast (origin, target week, horizon, source, service level, planned and expected
    cases); saline, kits and regional bed stock (required, allocated, short); hospital (bed demand, illustrative capacity, over or
    spare, transfers, without a bed); crews (assigned, deployment, supply-plan need, scenario estimate with range); items needing
    attention; assumptions; provenance; model identifier; disclaimer.
  - SMS (English and Bangla), WhatsApp (English and Bangla), the HTML brief (English and Bangla) and the PDF (English) are all rendered
    from that object.
- **Scenario identifier.**
  - `S-` plus the first 12 hex digits of SHA-256 over every setting (origin, horizon, source, city view, service level, stock, crews and
    per-ward maximum, risk weight, floor, cases per crew, capacity percentage and typed capacities, deployment mode and manual crews,
    effect parameters).
  - The hash also covers the dataset, onsite dataset, bundle and replay SHA-256s and the resource rules.
  - A separate content SHA-256 covers the brief itself.
- **Snapshot integrity in the UI.**
  - The dispatch desk shows one snapshot (scenario id and content hash).
  - Copy SMS and Copy WhatsApp copy that snapshot's text.
  - Downloads request `/api/dispatch/document` with that snapshot's own query string, never the current sliders. The file is refused
    if the response headers carry a different scenario id or content hash. Moving a slider produces a new snapshot and id.
  - The scenario query and the forecast-validity check are debounced together, so a request never mixes old and new settings.
- **Determinism.** No timestamps enter any output, and the PDF writer (`dengueshield/pdfmini.py`, no dependencies) writes no creation
  date. The same scenario gives byte-identical SMS, WhatsApp, HTML and PDF, as tested and as shown by `scripts/export_samples.py`
  across runs.
- **SMS length.**
  - GSM-7 when every character is in the GSM basic or extension set (extension characters count twice): 160 characters in one
    segment, 153 per segment when split.
  - Otherwise UCS-2: 70, then 67 per segment.
  - The English notices are GSM-7 (about 430 characters, 3 segments); Bangla is UCS-2 (about 460 characters, 7 segments). The UI
    shows both counts.
- **Bangla.** The SMS, WhatsApp and HTML brief come in Bangla; the HTML uses `lang=bn`, UTF-8 and Bengali system fonts. PDFs are
  English because the standard PDF fonts have no Bengali glyphs, and a Bangla PDF request is refused with that explanation.
- **Nothing is sent.** No SMS gateway, WhatsApp API or AppLink exists in the code. Every output is labelled as a planning estimate,
  not an outbreak report, not an order, and not sent.

Endpoints:
- `GET /api/dispatch/brief?ward=...&<scenario>`: snapshot with every text format.
- `GET /api/dispatch/document?kind=ward|city|wards&format=html|pdf&lang=en|bn&<scenario>`: downloads, with `X-Scenario-Id` and
  `X-Content-SHA256` headers.

## 7. Supported exports

| Export | Where |
|---|---|
| Copy SMS (English or Bangla) | dispatch desk |
| Copy WhatsApp (English or Bangla) | dispatch desk |
| Ward brief HTML (English or Bangla), ward brief PDF | dispatch desk; `kind=ward` |
| City summary HTML or PDF | dispatch desk; `kind=city` |
| Briefs for every ward needing attention (or all wards), HTML or PDF | dispatch desk; `kind=wards&scope=attention|all` |
| Existing CSV exports of Stages 1 and 2 | Supply allocation and Hospital surge sections |

Samples are in [`exports/`](../../exports/README.md): 20 files for scenario `S-94fbd8367d09` (2024-08-05, 3 weeks, 60% stock,
40 crews, capacity 120%), plus the kill-switch evidence.

## 8. Sample messages (scenario `S-94fbd8367d09`)

SMS, English (GSM-7, 427 characters, 3 segments):

```
DengueShield plan (forecast, not an outbreak report)
CCC_Ward_03, Chattogram: week of 26 Aug 2024 (3-wk forecast of 5 Aug 2024)
Cases 19 planned, risk Critical
Alloc/need: saline 45/45, kits 22/22, beds 6/6
Hospital: 6 beds needed, 5 illustrative; transfer 1 to CCC_Ward_06; 0 without bed
Crews 2; scenario -6.4 cases wks 2-4 (assumed effect)
Attention: none
Ref S-94fbd8367d09. Planning estimate, synthetic data, not an order.
```

SMS, Bangla (UCS-2, 7 segments): `exports/sms_CCC_Ward_03_bn.txt`. WhatsApp: `exports/whatsapp_CCC_Ward_03_en.txt` and `_bn.txt`.

**Commissioner brief.** `exports/brief_CCC_Ward_03_en.html` and `exports/brief_CCC_Ward_03.pdf`
([page image](media/stage4_pdf_brief.jpg)) contain:
- the forecast
- a supplies table
- the hospital section with the planned transfer
- crews and the vector-control estimate with its range
- items needing attention
- assumptions
- the four-part provenance (measured data, forecast, assumptions, simulated)
- scenario id, content hash, model and data identifiers

City version: `exports/city_summary_Chattogram.pdf`. Multi-ward version: `exports/briefs_attention_Chattogram.pdf`.

## 9. Data provenance in every brief

| Part | Text in the brief |
|---|---|
| Measured data | organizer dataset (synthetic), weekly cases, weather and resource requirements 2016-2024; target weeks never read; 2025 sealed |
| Forecast | origin-safe forecast with its issue date, target week and source (validated replay, or deployed model past its training window) |
| Assumptions | stock level, crew budget, capacity and intervention effect, listed with their values |
| Simulated | allocations, transfers and cases prevented are engine outputs, not actions taken and not observed outcomes |

## 10. External services when offline

| Service | Offline behaviour |
|---|---|
| Firebase sign-in | not configured by the offline launch; every public decision tool works without an account; officer workspaces need a sign-in that is unavailable offline |
| Copilot | answer generation off even if a key exists ("Offline mode: ... sources found locally"); local retrieval still works |
| AppLink / SMS sending | not used anywhere; notices are text and documents |
| Live weather (NASA POWER, Open-Meteo) | refused at once (no timeout wait); 503, or an earlier copy labelled stale; the forecast never uses it |
| DGHS ward polygons | refused at once; the abstract ward matrix is shown |
| Basemap tiles | fail in the browser and are reported; routes and facilities still draw from local data |
| Road routing | works from the local graphs |
| Emergency help | published numbers bundled in the page; always available |

## 11. Automated tests

| Suite | Before Stage 4 | Now | New |
|---|---|---|---|
| Python (pytest) | 611 | 632 | `tests/test_offline.py` (9), `tests/test_dispatch.py` (12) |
| Browser (Playwright, no retries) | 107 | 115 | `frontend/tests/e2e/dispatch.spec.ts` (8) |
| Kill-switch workflow | none | 1 | `frontend/tests/e2e/offline.spec.ts`, run only inside `scripts/killswitch.sh` (skipped in the normal suite) |

`tests/test_offline.py`:
- guard refuses outbound connections at once and records them; loopback works; disable restores the original functions
- no core engine attempts the network
- Copilot and the status endpoint are honest
- weather and boundaries fail fast
- missing artifacts are reported and nothing is created (exit code 3)
- external-asset scan
- the offline launch script never installs or downloads
- a real offline server process on loopback serves every engine and a PDF with zero refused attempts

`tests/test_dispatch.py`:
- brief numbers equal the Stage 1, 2 and 3 engines
- every format comes from one snapshot (scenario id and content hash also in the download headers)
- byte-deterministic exports
- the scenario id tracks every setting but not the ward
- SMS length rules (GSM-7, extension characters, UCS-2, segment boundaries)
- ward IDs never altered in any format
- Bangla rendering, and Bangla PDF refused
- PDF structure (header, every cross-reference offset, page count, escaping and transliteration)
- self-contained HTML
- multi-ward and city summary consistency (no duplicates, no other city, priority order, totals equal the engines)
- sealed 2025, in-sample refusal and invalid requests
- runs with sockets disabled

`frontend/tests/e2e/dispatch.spec.ts`:
- clipboard copy equals the preview
- PDF and HTML downloads carry the displayed scenario id
- a new snapshot after a slider change
- Bangla UCS-2
- axe on every tab in light and dim mode
- export controls at 360 and 390 px

Engines from earlier stages (allocation, overflow, simulator) keep their own tests for city isolation, flow conservation, no duplicated
patients or resources, and leakage. CI links are in section 14.

## 12. Screenshots

All taken during the kill-switch run with the internet cut off, except the 390 px view:
- [`stage4_offline_header.jpg`](media/stage4_offline_header.jpg)
- [`stage4_offline_supply.jpg`](media/stage4_offline_supply.jpg)
- [`stage4_offline_hospital.jpg`](media/stage4_offline_hospital.jpg)
- [`stage4_offline_vector.jpg`](media/stage4_offline_vector.jpg)
- [`stage4_offline_dispatch.jpg`](media/stage4_offline_dispatch.jpg)
- [`stage4_pdf_brief.jpg`](media/stage4_pdf_brief.jpg)
- [`stage4_dispatch_390.jpg`](media/stage4_dispatch_390.jpg)

## 13. Offline performance

Offline, first call after start, from `exports/offline/comparison.json` (MacBook) and the CI job log (GitHub runner):

| Call | macOS | CI runner |
|---|---|---|
| Server start to ready | 3 s | 4 s |
| Forecast, all wards (2/3/4 weeks) | 15-32 ms | 32-50 ms |
| Ward forecast with drivers | 221 ms | 613 ms |
| Forward forecast into 2025 (model inference) | 200 ms | 1,067 ms |
| Supply allocation | 15-22 ms | 36-161 ms |
| Hospital overflow | 15-63 ms | 37-165 ms |
| Vector-control simulator | 92-96 ms | 272-297 ms |
| Dispatch brief (all formats) | 117 ms | 334 ms |
| PDF ward brief / multi-ward PDF | 43 / 65 ms | 88 / 118 ms |
| Whole browser workflow (12 steps) | 7.0 s | 25.5 s |

## 14. Commits and CI

| Commit | Content |
|---|---|
| `172830f` | version-onsite-final: implement deterministic ward dispatch with printable and PDF briefs |
| `04b359b` | version-onsite-final: implement offline launch and dependency validation |
| `620c469` | version-onsite-final: integrate ward dispatch workspace and offline status |
| `2b7f9a8` | version-onsite-final: verify network-disconnected operational workflows |
| this commit | version-onsite-final: document offline operation, sample exports and crew totals by city |

CI on `2b7f9a8`: https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45956574258. Python tests, frontend build and the
kill-switch job passed; see the Stage 4 report message for the final result of the browser job and of this commit's run.

## 15. Remaining limitations

- **One-time setup needs the internet.** `scripts/setup.sh` installs Python packages and npm modules and fetches the datasets. A fully
  air-gapped machine needs a prepared copy: a Python environment with `requirements.txt` installed (for example from a wheelhouse),
  `frontend/out` and `data/raw`. `node_modules` is not needed at run time.
- **Paths.** The launch scripts are bash (macOS, Linux, WSL); Windows needs the manual commands in section 2.
- **Bangla PDF** would need an embedded Bengali font; Bangla is provided in HTML and text instead.
- **Map tiles** need the internet; routing and facilities do not.
- **Copilot** answers need OpenAI; offline it shows locally retrieved sources only.
- **macOS automation.** The kill-switch on macOS relies on `sandbox-exec`, which Apple marks as deprecated but still ships. For
  judges, switching Wi-Fi off is the reference procedure.
- **Model limits carry over.** All Stage 1-3 limitations remain: illustrative capacity, assumed intervention effects, synthetic data,
  and forecast error at peaks.

## 16. Technical Q&A

1. **How does DengueShield work offline?** One local FastAPI process serves the built dashboard and every engine from files on disk.
   Offline mode refuses every non-loopback connection, so anything that worked passed through no network.
2. **Which data and model artifacts are local?** See section 3: both datasets (checksummed), the replay forecasts, the deployed
   bundle, the resource rules, evidence files, road graphs and facilities, and the built dashboard.
3. **How do you prove forecasts do not leak target outcomes?**
   - Historical plans use only the replay (each season forecast by models fitted on earlier seasons).
   - In-sample bundle output is refused by every decision tool.
   - 2025 rows are dropped as bytes before parsing.
   - Responses carry no observed values. All of this is tested.
4. **How are resource allocations kept consistent?** One engine per stage. The dashboard sections, the dispatch briefs and the
   kill-switch all call the same cached functions, the UI shares one plan state, and the tests compare dispatch numbers with each
   engine.
5. **How does dispatch preserve the exact scenario?**
   - A scenario id hashes every setting and the data and model fingerprints; a content hash covers the brief.
   - Exports use the displayed snapshot's own query and are refused if the server answers for another scenario.
6. **What if Firebase, AppLink or OpenAI is down?** Nothing core changes: Firebase is not needed for the public tools, AppLink is not
   used, and Copilot falls back to local retrieval. The status endpoint and header say so honestly.
7. **Why is SMS generated rather than sent?** Sending would need a gateway, credentials, recipients and approval, and would turn a
   planning estimate into an action. Officers review and send through their own channels.
8. **What scientific assumptions are included?** Stock level, crew budget, illustrative capacity (the 90th percentile of past weekly
   bed need, scaled), and the assumed intervention effect (presets, sensitivity, one deployment). Every brief lists them with values.
9. **How is reproducibility verified?**
   - Byte-identical exports across runs.
   - 21 result hashes identical online and offline, on macOS and on Linux CI.
   - A deterministic PDF writer.
   - Scenario ids that change with any setting.
10. **What if an offline dependency is missing?** The launch stops before starting the server, lists exactly what is missing (with
    checksum failures named) and the command that restores it. Nothing is downloaded or fabricated.

## 17. Requirements for Stage 5

1. Merging into `main` and deployment: done for `main` (PR #6) and the backend; the production frontend redeploy is tracked in
   [`FINAL_RELEASE.md`](FINAL_RELEASE.md) section 9b.
2. A final submission README section that points to `scripts/setup.sh`, `scripts/launch_offline.sh`, the kill-switch procedure and
   `exports/`.
3. Optional: an embedded Bengali font for Bangla PDFs; a Windows launch script; a packaged offline bundle (venv, `frontend/out`,
   data) for air-gapped machines.
4. Keep the CI kill-switch job as the regression guard for offline operation.
