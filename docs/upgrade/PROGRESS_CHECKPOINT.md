# Progress checkpoint (championship sprint)

Resume here. Keep this file short; update after every unit.

## Where

- Branch `upgrade/championship-engine-v2` (pushed to origin), worktree `/Volumes/ssd(mac)2/EDU_HACKATHON_CHAMP` (a worktree of
  `/Volumes/ssd(mac)2/EDU_HACKATHON_ONSITE`). Base `2124600` (= `main`). `main`, Vercel and the HF Space are untouched.
- Codex's original clone (left untouched): `~/.codex/visualizations/2026/11/21/01a1fdd0-eb1f-7053-a40e-0db26c6611ae/championship-upgrade`, tip `4aa668f`.
- Python with every runtime dependency (google-auth, scipy 1.18) and pytest: `/Volumes/ssd(mac)2/EDU_HACKATHON_ONSITE/.venv/bin/python`.
  (`/Volumes/ssd(mac)2/EDU_HACKATHON/.venv` lacks google-auth: auth tests fail there for that reason only.)
- `data/raw` copied from the onsite worktree (gitignored). Local server: port 8300 from this worktree with `FIREBASE_PROJECT_ID=demo-dengueshield-e2e`.

## Done

| Unit | Commit | Evidence |
|---|---|---|
| Codex phases 0-2 (audit, scenario integrity, command engine review/presentation) | `b1f3696`, `2d02af1`, `4aa668f` | Codex reports |
| Recovered Codex phase 3 (allocation uncertainty comparison) | `bab676e` | 65 tests passed |
| Map framing fix from `ops-engine` | `c6cdc6c` | CI green on `ops-engine` |
| Hospital preparedness engine + API | `c030e03` | `tests/test_preparedness.py` 17 passed; allocation/overflow/intervention/dispatch 267 passed |
| Preparedness command workspace (`#prepare`) | `797a3cf` | `preparedness.spec.ts` 6 passed |
| Offline parity incl. 6 preparedness calls | `994bf57` | macOS kill-switch: 28/28 identical, offline browser test passed, 0 outbound attempts |
| Docs: method, data, thresholds, offline, rubric, release, 7-min script, Bangla Q&A; README/ARCHITECTURE | `f7ee003` | — |
| Optional mosquito cursor + flight sound (off by default, footer toggles); full regression fixes | `a7f37b9` | `mosquito-cursor.spec.ts` passed; FINAL_TEST_REPORT.md |

## Open

- CI run 45999833899 on `a7f37b9` (see FINAL_TEST_REPORT.md for the local runs).
- Not done: physical Wi-Fi-off run on the judging laptop, fresh-clone setup, video recording, production deploy (needs owner
  approval), 3D mosquitoes on other pages (only the existing landing intro), real hospital capacity data (none exists in the bundle),
  more districts (OSM data and road graphs cover Dhaka, Gazipur, Narayanganj, Chattogram only).

## Acceptance gates

| Gate | Status | Evidence |
|---|---|---|
| 1 Codex work recovered | PASS | `bab676e`, 65 tests |
| 2 Existing functionality preserved | PASS (local) | full Python and browser runs, FINAL_TEST_REPORT.md |
| 3 Mixed-patient occupancy | PASS | flow/split checks on every row, 17 unit tests |
| 4 Bed capacity and reserve accounting | PASS | capacity, reserve, zero capacity, surge, closure tests |
| 5 Inventory | PASS | conservation, zero stock, delayed delivery, ROP, procurement tests |
| 6 Dynamic thresholds | PASS | Normal→Emergency rule tests; scenario changes move statuses |
| 7 Sudden outbreak simulation integrated | PASS | three states; Stage 3 prevented share feeds demand |
| 8 Resource allocation preserved | PASS | allocation suites unchanged and passing |
| 9 Hospital network optimization | PASS | LP vs independent max-flow, receiver limits, city rules |
| 10 Verified alternatives where coverage permits | CONDITIONAL | OSM tiers by road time in 4 districts; capacity unknown everywhere |
| 11 Verified ambulance and emergency information | CONDITIONAL | 999 and 16263 only (pre-existing sources, not re-verified); 59 OSM phone tags; no ambulance-provider numbers |
| 12 Synthetic and real data separated | PASS | provenance labels, tests that real cards never carry capacity |
| 13 Brief and dispatch consistency | PASS | scenario id equal on screen and in files (API and browser tests) |
| 14 Premium hospital command UI | PASS (screenshots) | `#prepare` workspace; owner review pending |
| 15 Immersive visuals optional and performant | CONDITIONAL | cursor and sound opt-in, idle-safe; no new 3D placements |
| 16 Offline core execution | PASS (macOS sandbox) | 28/28; physical Wi-Fi run NOT RUN |
| 17 Regression tests | PASS (local) / CI pending | see above |
| 18 Accessibility and responsive | PASS (automated) | axe light and Dim on /response/, 360/390 px tests |
| 19 Build and scenario compatibility | PASS | build, scenario.spec |
| 20 Official rubric evidence | PASS | FINAL_RUBRIC_CHECKLIST.md |
| 21 Video readiness | CONDITIONAL | script ready; not recorded |
| 22 Technical Q&A readiness | PASS | JUDGE_QA_BANGLA.md, 46 answers |

## Next exact step

Owner review of the branch; then the release checklist (FINAL_RELEASE_CHECKLIST.md): judging-laptop offline run, video, deploy approval.
