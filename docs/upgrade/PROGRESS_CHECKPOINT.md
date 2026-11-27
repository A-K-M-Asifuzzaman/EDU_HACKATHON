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
| Docs: method, data, thresholds, offline, rubric, release, 7-min script, Bangla Q&A; README/ARCHITECTURE | pending commit | — |
| Optional mosquito cursor + flight sound (off by default, footer toggles) | pending commit | `mosquito-cursor.spec.ts` |

## Open

- Full regression rerun on the onsite venv (first run: 652 Python passed, 3 env/interference failures; browser 135 passed,
  4 failed: Codex's scenario test vs a duplicate "Reset scenario" button name (renamed), two preparedness tests racing the URL
  scenario restore (now open Dhaka North by URL), Firebase test needing google-auth in the server venv (server switched)).
- Not done: physical Wi-Fi-off run on the judging laptop, video recording, production deploy (needs owner approval), 3D mosquito
  placement across pages (existing landing intro mosquito only), real hospital capacity data (none bundled).

## Next exact step

Read the rerun results, fix anything real, rebuild, run `preparedness`, `scenario`, `mosquito-cursor`, `v4` specs, commit docs and the
cursor, push, write FINAL_TEST_REPORT.md with the actual numbers.
