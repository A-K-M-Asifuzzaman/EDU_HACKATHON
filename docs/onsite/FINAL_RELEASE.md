# DengueShield AI: Phase 2 onsite final release guide

For the team lead, the presenter and the judges.

The work is on branch `version-onsite-final` of the official repository https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON.
Stage 4 was merged into `main` by the owner (PR #6, merge commit `7cf8e0d`; its tree is identical to `4ce4801`). The backend runs
`4ce4801`, and the Vercel project is live. Production still serves the older frontend: see section 9b.

## 1. Release blockers (owner decisions)

| # | Blocker | Why it matters | Needed from the owner |
|---|---|---|---|
| B1 | **Production frontend is older than `main`** | `main` (`7cf8e0d`) contains Stage 4, but Vercel's production build of it (`dpl_EvweXZEAUx6WMfPi6ijfDZgt54L6`) is BLOCKED: it was created at 14:30, while the project was still paused. Production therefore still serves `85fe10d` (Stages 1-3, no dispatch desk, no build stamp, footer linking the practice repository). Details in section 9b. | Confirm the release target (section 9b), then redeploy |
| B2 | **Older address unassigned** | `dengueshield-ai.vercel.app` returns 404; the project's domain is `we-are-hack-squad.vercel.app` | Submit `we-are-hack-squad.vercel.app` |
| B3 | **The official repository is private** | Judges must read the code, `ARCHITECTURE.md` and `/exports`. Teammates have access; judges may not. | Make it public, or add the judges' GitHub accounts, before submission |
| B4 | **Submission destination unknown** | The problem set (SHA-256 `ad6f6370…`, 3 pages) states the criteria but no submission link or form. The organizers' email could not be read: the Gmail connector session expired. | Confirm the submission form, link or channel, and the video upload deadline |
| B5 | **The 7-minute uncut video is not recorded yet** | Criterion 6 is 10 points; a commit hash mismatch scores 0 | Record after the final commit, following section 4. The footer shows the build commit. |
| B6 | **Teammates' onsite contributions are not recorded** | Criterion 5 values continuous history; `CONTRIBUTORS.md` now states that onsite commits came from the lead's account with AI assistance | Add real teammate contributions with links, if any; never invented ones |
| B7 | **Commit convention or tag** | The rubric says "follow version-onsite-final for each commit" and the criterion title says "Tagged". Every onsite commit uses the prefix `version-onsite-final:` on branch `version-onsite-final`. | Optional: approve a git tag `version-onsite-final` on the final commit |

Everything else below is complete and tested.

## 2. Official requirements and evidence

From `Hackathon_Phase2_Problemset.pdf` (scoring, 100 points plus up to 10 bonus):

| Criterion | Points | Evidence | Status |
|---|---|---|---|
| 1. Constrained resource allocation | 15 | Supply allocation: 30-100% stock slider, crew budget, risk-and-density priority (`population_density_sqkm`), live critical-deficit alerts; optimum checked against an LP solver ([Stage 1](STAGE1_HANDOFF.md)) | done |
| 2. Hospital overflow routing | 10 | Intra-city maximum-flow transfers, net deficits, remaining headroom and bed use per city ([Stage 2](STAGE2_HANDOFF.md)) | done |
| 3. Vector-control simulator | 10 | Forecast-driven 2-4 week counterfactual, cases, beds and saline, ROI ranking; effect labelled as an assumption ([Stage 3](STAGE3_HANDOFF.md)) | done |
| 4. Offline resilience | 15 | Offline launch, kill-switch passing on macOS and in CI (network namespace) with 21 of 21 results identical online and offline ([Stage 4](STAGE4_HANDOFF.md)) | done |
| 5. Repo, live URL, ARCHITECTURE.md, AI disclosure, `/exports` | 10 | Phase 1 repository extended with `version-onsite-final:` commits; `ARCHITECTURE.md` has an onsite section; AI disclosure updated in `README.md`; `/exports` holds SMS, WhatsApp, HTML and PDF samples | **live URL blocked (B1)**, repo access (B3) |
| 6. Uncut 7-minute video with voiceover | 10 | Run-sheet in section 4 | **to record (B5)** |
| 7. Technical Q&A | 30 | Section 6 and the Q&A in each stage handoff | prepared |
| Bonus (domain-relevant extras) | up to 10 | Bangla notices, fairness floor, optimality certificates, scenario hashing, deterministic PDFs, offline status chip, sensitivity analysis | judges' call |

## 3. Exact setup (judging laptop)

Prerequisites: git, Python 3.12, Node.js 22 (only for setup), about 2 GB of disk. Once, while online:

```bash
git clone -b version-onsite-final https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON.git && cd EDU_HACKATHON
./scripts/setup.sh
```

The script creates `.venv`, installs `requirements.txt`, fetches and checksum-verifies both datasets, runs `npm ci` and builds the
dashboard, then runs the readiness check. It should end with "Ready for offline use: 21 artifacts and modules present". On this machine it
took 44 s with warm package caches; a fresh laptop takes several minutes.

For the demonstration:

```bash
./scripts/launch_offline.sh          # Wi-Fi off; serves http://127.0.0.1:8000
PORT=8100 ./scripts/launch_offline.sh  # if port 8000 is busy
python scripts/offline_check.py      # readiness only (what is present, what is missing, how to restore it)
```

Windows (without bash):
1. `py -3.12 -m venv .venv` and `.venv\Scripts\pip install -r requirements.txt`
2. `python scripts\fetch_data.py`
3. `cd frontend && npm ci && npm run build`
4. Offline: `set DENGUESHIELD_OFFLINE=1`, `python scripts\offline_check.py`, `python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port 8000`

Before judging, check:
- `git rev-parse --short HEAD` matches the commit you will submit.
- The landing-page footer shows the same build (no `-dirty` suffix).
- `python scripts/offline_check.py` exits 0.

## 4. Demonstration path (fits the 7-minute uncut video)

Open http://127.0.0.1:8000. Every number below was produced by the rehearsal, with the internet cut off and the default scenario:
forecast issued 5 Aug 2024 (the 2024 peak), 3 weeks ahead.

| Time | Step | What to show and say | Expected |
|---|---|---|---|
| 0:00 | Offline proof | Wi-Fi off; terminal `./scripts/launch_offline.sh` printing "Ready for offline use"; header chip "Offline mode: local engines" | chip visible |
| 0:30 | Build | Landing footer "Build <hash>" next to `git rev-parse --short HEAD` | same hash |
| 0:45 | Forecasts | Command Center, ward DSCC_Ward_04, switch 2, 3, 4 weeks; the forecasts come from the validated replay (models fitted on earlier seasons) | answer card each time |
| 1:30 | Problem 1 | Response Intelligence, Supply allocation: stock 60% then 40%; deficit alert; ward table by priority | at 40%: saline 705 of 1,767 |
| 2:30 | Problem 2 | Hospital surge: baseline city-wide surge, then "+20% surge beds"; transfer table and flow chart; all transfers stay in one city | 53 without a bed, then 16, with 9 transfers |
| 3:30 | Problem 3 | Vector control: Optimized, Moderate preset; cases prevented by week with range; ROI table; Supplies and Hospital tabs; say the effect is an assumption, not measured | 63.2 cases prevented over weeks 2-4 (range 31.6-94.8) |
| 4:45 | Problem 4 | Dispatch briefs: same scenario id in the snapshot, SMS, WhatsApp; switch to বাংলা (UCS-2, 7 segments); download PDF and HTML and open them; say nothing is sent | scenario id identical in all |
| 6:00 | Problem 5 | Terminal: `curl -s http://127.0.0.1:8000/api/system/offline` (offline mode, artifacts OK, 0 refused connections); mention the CI kill-switch | blocked_count 0 |
| 6:30 | Limits | Synthetic data; illustrative capacity; assumed intervention effect; planning estimates, not orders | |

Rules for the recording: one take, no slides, no cuts. Record from the submitted commit, and upload on time.

## 5. Architecture in one paragraph

- One FastAPI process on loopback serves the built Next.js dashboard and every engine from local files.
- Forecasts come from `decision_forecast()`. It uses the season-by-season replay for 2019-2024 targets and the deployed Ridge Poisson
  bundle only past its training window; in-sample output is refused and 2025 stays sealed.
- The dataset's own resource rule turns forecast cases into saline, kits and beds. Stage 1 allocates them per city under a stock scenario.
  Stage 2 routes overflow patients inside each city by maximum flow. Stage 3 applies an assumed crew response and feeds scenario cases
  back to Stages 1 and 2. The dispatch engine copies the numbers into one canonical brief per ward, rendered as SMS, WhatsApp, HTML and PDF.
- Offline mode refuses every outbound connection. Details: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#phase-2-onsite-operational-engines).

## 6. Technical Q&A (short answers; full versions in the stage handoffs)

| Question | Answer |
|---|---|
| How do you avoid target leakage? | Replay forecasts come from models fitted on earlier seasons; in-sample output is refused; capacity uses only weeks before the forecast date; 2025 is dropped as bytes before parsing. All of this is tested. |
| Why greedy allocation? Is it optimal? | One budget row with box bounds: filling by priority after the fairness floor is LP-optimal and integral. It is checked against SciPy HiGHS and brute force. Optimal for the stated objective only. |
| Why maximum flow for overflow? | No distances exist for synthetic wards, so every in-city pair is equal. Maximum flow places the most patients; a convex spread rule picks among equal plans. The unresolved shortage is exactly max(0, demand - capacity) per city. |
| Why no transfers at the peak? | Every ward is over its capacity at once; routing cannot create beds. More capacity (+20%) enables 9 transfers. |
| Is the simulator causal? | No. The data contain no interventions, so the effect is a user-set assumption (presets, sensitivity range). Zero crews reproduce the forecast exactly. |
| Is the crew plan optimal? | For the stated concave objective, yes: greedy by marginal value, checked against brute force and dynamic programming, with a certificate in the UI. |
| How do resources follow case reductions? | The scenario scales the forecast quantile; the dataset's rule floor(m x cases + 0.5) converts it once; stock stays fixed (demand falls, nothing is created). |
| How does dispatch keep one scenario? | A scenario id hashes every setting and the data and model fingerprints; downloads use the displayed snapshot and are refused on mismatch; outputs are byte-identical. |
| Why generate SMS instead of sending it? | Sending needs a gateway, credentials, recipients and approval, and would turn an estimate into an action. Officers send through their own channels. |
| How does it run offline? | Local files only; the offline guard refuses outbound connections; the kill-switch test (macOS sandbox and Linux namespace) shows 21 of 21 results identical online and offline, and across both platforms. |
| What if a file is missing? | The launch stops before serving and lists each missing item with the command that restores it. Nothing is fabricated. |
| What if OpenAI, Firebase or AppLink is down? | Nothing core changes: Copilot falls back to local retrieval, public tools need no sign-in, and AppLink is not used. |

## 7. Evidence

**Tests**

| Suite | Result |
|---|---|
| Python (pytest) | 633 passed (611 before Stage 4) |
| Browser (Playwright) | 118 passed with no retries, 1 skipped (the kill-switch workflow, which runs only with the internet cut off) |
| Recent CI browser jobs | 0 flaky tests, except run 45962769047 (2 flaky; root cause found and fixed, see below) |
| Kill-switch | macOS sandbox and Linux CI network namespace: 21 of 21 results identical online and offline; the full browser workflow passed |

**Cross-platform.** All 21 result hashes from CI's Linux run equal the macOS run, including the deployed model's 2025 inference.

**CI on GitHub Actions**

| Commit | Run | Result |
|---|---|---|
| `2b7f9a8` | https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45956574258 | all four jobs passed |
| `b95b566` | https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45957777217 | all four jobs passed |
| `1eb3ac2` (Stage 4 tip) | https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45959166287 | all four jobs passed; 115 browser tests, 0 flaky |
| `0b378d3` (build stamp, rehearsal tests) | https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45961155193 | all four jobs passed |
| `ed05526` (release docs) | https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45962769047 | all four jobs passed, but the browser job needed its retry for 2 tests |
| the fix commit after `ed05526` | see the release report | |

The two flaky tests (Dim-mode accessibility on Response, vector manual deployment) exposed a real defect.
- **Cause.** `useDebounced` depended on object identity, so the vector-control section re-rendered about 7 times a second while
  idle. Each cycle could abort a slow simulator request, and a refresh could catch text in its dimmed state.
- **Fix.** The debounce now depends on content, and refreshes no longer dim text.
- **Regression test.** A new browser test checks that every decision section is idle when nothing changes. It fails on the old code and
  passes now.

**Rehearsal.** I did not switch Wi-Fi off on this machine, because the session needs the network. The same workflow ran in a sandbox
that blocks all non-loopback traffic for the server and the browser, after a real `./scripts/setup.sh` and with the default
`./scripts/launch_offline.sh`. It covered:
- forecasts at 2, 3 and 4 weeks
- allocation at 40%
- overflow at baseline and +20%
- vector control
- English and Bangla SMS and WhatsApp copied
- PDF and Bangla HTML downloaded and checked
- one scenario id across every output
- offline status, 21 artifacts present, 0 refused connections
- the footer build stamp

The page tried to reach no external host except the test's own probe. Judges should repeat it with Wi-Fi physically off (section 4).

**Screenshots.** [`media/`](media/): offline header chip, supply, hospital, vector control and dispatch taken offline, PDF page, and
the 390 px dispatch view.

## 8. Known limitations

- **Synthetic data and model limits.** The data are synthetic, and the forecasts under-predict outbreak peaks (documented in Phase 1).
- **Assumptions, not data.** Stock, crews, ward capacity and intervention effect are not in the data; they are labelled settings.
- **No geography.** Ward IDs are synthetic, so transfers carry no distance or route.
- **Language.** PDFs are English; Bangla is in HTML, SMS and WhatsApp.
- **Internet needed for:** first-time setup, map tiles and Copilot answers.
- **Platform.** Bash launch scripts; Windows uses the manual commands above.

## 9. Release plan (only with owner approval)

**Rollback points recorded now**

| Component | Rollback point |
|---|---|
| Vercel | `dpl_4pCH8xzSEAEawPZqxaJdWmxagqD9` (commit `938ff3b`, 22 Nov), the frontend that matches the current backend |
| Hugging Face Space `AsifZaman1912/dengueshield-ai-api` | revision `57c8afa4ebe2195c8a213881762f08417f9047ed` |
| GitHub `main` | `85fe10d` |

**Steps, in this order**

1. **Freeze.** Record the release commit (the tip of `version-onsite-final` with green CI). Optionally tag it `version-onsite-final` (B7).
2. **Backend first.** From the release commit, run `HF_TOKEN=... python scripts/deploy_space.py`. It writes `app_data/BUILD_COMMIT`, and
   the image fetches both datasets at build time.
   - Smoke test the backend directly: `curl https://asifzaman1912-dengueshield-ai-api.hf.space/api/health` should show `build_commit`
     equal to the release commit.
   - Run `python scripts/offline_verify.py --base https://asifzaman1912-dengueshield-ai-api.hf.space --compare killswitch/baseline.json`,
     with a baseline written from a local server at the same commit. Expect 21 of 21 identical. The new backend keeps every old route,
     so the paused frontend stays compatible.
3. **Merge.** Open a pull request `version-onsite-final` into `main`, wait for green CI, then merge. This triggers a Vercel build.
4. **Unpause** the Vercel project only after steps 2 and 3 succeed. Confirm the newest production deployment is READY for the merge commit
   (redeploy it if Vercel blocked it while paused).
5. **Smoke test the live URL.**
   - `python scripts/offline_verify.py --base https://we-are-hack-squad.vercel.app --compare killswitch/baseline.json` should give 21 of 21.
   - Run `npx playwright test tests/e2e/allocation.spec.ts tests/e2e/hospital.spec.ts tests/e2e/vector.spec.ts tests/e2e/dispatch.spec.ts`
     with `E2E_BASE_URL=https://we-are-hack-squad.vercel.app`.
   - The landing footer should show the release commit.
6. **Submit** the live URL only after step 5 passes.

**Rollback**
- In Vercel, promote `dpl_4pCH8xz…` (or pause the project again).
- Re-upload Hugging Face revision `57c8afa` (check out that tree, run `deploy_space.py`), or revert in the Space's history.
- Revert the merge on `main` with a pull request.
- The local offline demonstration stays available throughout.

## 9a. Release performed (27 Nov 2026, owner-approved: "deploy the backend and unpause vercel")

**Backend.** Deployed from `4ce4801` with `python3 scripts/deploy_space.py`.
- Hugging Face Space commit `9ea3e06`; it built in about 2 minutes and runs with `build_commit` `4ce4801`.
- Smoke test against the Space: 21 of 21 results identical to the local baseline. Each call took 1-2 s from Dhaka, network included.
- Every route used by the live frontend answers 200: metadata, canonical metrics, auth config, allocation, overflow, simulator and risk.
- `/api/system/offline` on the Space lists the two `frontend/out` pages as missing. That is expected: the backend image serves the API only.

**Vercel.** The project was unpaused. Production deployment `dpl_9r8U4v4MNnTFzFX9k4qCLvwbPfSN` (frontend `85fe10d`) is live at
https://we-are-hack-squad.vercel.app, and `/api` routes to the new backend.

Live smoke tests:

| Check | Result |
|---|---|
| 21 API results through the live URL | identical to the baseline |
| `allocation.spec.ts` and `hospital.spec.ts` against the live URL | 10 of 10 passed, no retries |
| Vector-control headline | 63.2 cases prevented, the same as locally |
| Page errors | none |

**Not live at that point.** The Stage 4 dispatch desk and footer build stamp were not yet on `main`. The owner has since merged them
(section 9b).

**Rollback.** Nothing changes from section 9. The previous Hugging Face revision is `57c8afa`. The previous Vercel production deployments are
`dpl_J26oSwxiT7mf7aL6VQ5Y445mRgdD` (`9c99f0c`) and `dpl_4pCH8xzSEAEawPZqxaJdWmxagqD9` (`938ff3b`). The project can also be paused again.

## 9b. Production verification after the merge (27 Nov 2026)

**SHAs**

| Item | SHA |
|---|---|
| Official `main` | `7cf8e0d` (PR #6 merge); tree identical to `4ce4801`. Main CI https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45966183377 passed all four jobs, kill-switch included. |
| Hugging Face backend | Space revision `9ea3e06`, built from `4ce4801`; `/api/health` reports `build_commit` `4ce4801` |
| Vercel production frontend | `85fe10d` (`dpl_9r8U4v4MNnTFzFX9k4qCLvwbPfSN`), the Stage 3 merge |

The production build of `7cf8e0d` (`dpl_EvweXZEAUx6WMfPi6ijfDZgt54L6`) exists but is BLOCKED, because it was created while the project
was paused. The GitHub Deploy workflow reported success, but its provider steps were skipped, so it did not deploy anything.

**Anonymous browser check of the live site** (fresh context, no account)

| Check | Result |
|---|---|
| Home and navigation | pass |
| Forecasts at 2, 3 and 4 weeks | pass |
| Supply allocation | pass: saline 1,059 of 1,767 at 60% |
| Hospital overflow | pass: 53 without a bed in their own city |
| Vector control | pass: 63.2 cases prevented |
| Sealed-year refusal | pass |
| Provenance page | pass |
| 360 and 390 px | pass, no sideways scroll |
| Page errors, API 5xx | none |
| Dispatch desk, SMS and WhatsApp previews, download buttons, footer build stamp | **absent** (older frontend) |
| Footer source link | points at the practice repository (older frontend) |
| Offline-mode chip | absent: by design it appears only when the server runs in offline mode (`launch_offline.sh`), and production runs online |

**Live API through the production domain**

| Check | Result |
|---|---|
| `/api/health` | ok, build `4ce4801`, dataset, bundle, replay and artifacts all OK |
| `/api/system/offline` | 200 |
| `/api/dispatch/brief` | 200 |
| `/api/dispatch/document` (PDF and HTML) | 200 |
| 2025 origin | 422 |
| In-sample forecast | 422 |

A PDF brief downloaded from production is byte-identical to `exports/brief_CCC_Ward_03.pdf` (scenario `S-94fbd8367d09`).

**Release target awaiting the owner's confirmation**
- Promote or redeploy the production build of `main` `7cf8e0d`.
- What changes for visitors: the dispatch desk with SMS and WhatsApp previews and HTML and PDF downloads, the footer build stamp and
  official-repository link, the idle re-render fix, crews by city, and the in-sample label in the controls bar.
- The backend does not change; it already runs the same code.
- For a build stamp equal to the `main` SHA, redeploy the backend from a checkout of `7cf8e0d` (same code, stamp `7cf8e0d`). Otherwise
  the footer will show `4ce4801`, which has an identical tree.
- After the release, re-run the anonymous check above and `scripts/offline_verify.py` against the live URL.

## 10. Checklists

**Submission**
- [ ] Repository access for judges (B3)
- [ ] Final commit on `version-onsite-final`, green CI on that commit
- [ ] `ARCHITECTURE.md` onsite section and AI disclosure in `README.md` reviewed by the team
- [ ] `/exports` present (SMS, WhatsApp, HTML, PDF, city summary, multi-ward)
- [ ] Live URL released and smoke-tested (section 9), or a decision to present locally
- [ ] Video recorded from the final commit, uploaded on time (B5)
- [ ] Teammates' real contributions recorded (B6)
- [ ] Submission link and form completed (B4)

**Release authorization (owner, explicit)**
- [x] Deploy the backend to the Hugging Face Space (27 Nov, `4ce4801`)
- [x] Merge the pull request into `main` (owner, PR #6, `7cf8e0d`)
- [ ] Redeploy the production frontend from `main` (section 9b)
- [x] Unpause the Vercel project (27 Nov; production frontend still `85fe10d`, section 9b)
- [ ] Create the tag (optional)
- [ ] Change repository visibility or add judges

## 11. Emergency recovery during judging

| Problem | Action |
|---|---|
| Port busy | `PORT=8100 ./scripts/launch_offline.sh` |
| Launch stops with MISSING | Run the command it prints. Without internet, use the backup laptop prepared the same way (keep one). |
| Dataset checksum differs | Re-run `python scripts/fetch_data.py` (online), or copy `data/raw/` from the backup laptop |
| Page blank or old | Hard-reload; the API answers at `/api/health`; check `frontend/out` exists (`offline_check.py`) |
| Live URL fails | Switch to the local offline demonstration; it is the reference for criterion 4 anyway |
| Build stamp shows `-dirty` or another hash | `git status`, `git checkout <submitted commit>`, restart the server |
| PDF viewer missing | Open the HTML brief (same scenario id) in the browser |
| Bangla shows boxes | The OS lacks a Bengali font; the HTML still carries the text; use another laptop for the Bangla part |
| Something in a stage misbehaves | Tests in `tests/` and `frontend/tests/e2e/` reproduce each guarantee; `exports/` shows the expected outputs |
