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

## Closure sprint (done)

| Unit | Commit |
|---|---|
| Restore race fixed (edits before URL restore re-applied; tests no longer work around it) | `0724c98` |
| 28-day time-expanded referral program (peak-day fallback), emergency redistribution + 4 policies, integrity labels, scenario id covers data/model | `dcffa45` |
| Playback, gauges, stockout countdown, inventory policies, 28-day network, action "where", Geography separation, 999/16263 rechecked | `12dda5f` |
| Referral numbers consistent (28-day plan everywhere), final docs, 100 Q&A | final commit |

## Open

- **Production is partly broken** (owner action): PR #9 merged `f9372e5` into `main`, Vercel published it, the backend deploy was
  skipped (no `HF_TOKEN`). See FINAL_RELEASE_CHECKLIST.md "Fix now".
- This sprint is not merged or deployed.
- Judging-laptop Wi-Fi-off run, 7-minute video, submission destination, repository access: not done.

## Acceptance gates

Unchanged from the previous table except: 9 now includes the 28-day program and redistribution (PASS); 17 PASS locally (CI: see run
id in the final report to the owner); 16 PASS on the macOS sandbox and a fresh clone, physical Wi-Fi NOT RUN; **live production: FAIL**
until the backend is deployed.

## Next exact step

Owner: deploy the backend from `main` (restores the live preparedness section), then review and merge this sprint's PR and deploy
backend-first.
