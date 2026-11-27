# Progress checkpoint (championship sprint)

Resume here. Keep this file short; update after every unit.

## Where

- Branch `upgrade/championship-engine-v2`, worktree `/Volumes/ssd(mac)2/EDU_HACKATHON_CHAMP` (a worktree of `/Volumes/ssd(mac)2/EDU_HACKATHON_ONSITE`).
- Codex's original clone (left untouched): `~/.codex/visualizations/2026/11/21/01a1fdd0-eb1f-7053-a40e-0db26c6611ae/championship-upgrade`, branch tip `4aa668f`. Its branch was never pushed to GitHub.
- Base `2124600` (= `main`, PR #8). Production and `main` are not touched by this sprint.
- Python: `/Volumes/ssd(mac)2/EDU_HACKATHON/.venv/bin/python` (has pytest, scipy 1.18). `data/raw` copied from the onsite worktree (gitignored).

## Done

| Unit | Commit | Evidence |
|---|---|---|
| Codex phases 0-2 (audit, scenario integrity, command engine review/presentation) | `b1f3696`, `2d02af1`, `4aa668f` | Codex reports; not re-run in full |
| Recovered Codex phase 3 (allocation uncertainty comparison, uncommitted in Codex clone) | `bab676e` | `tests/test_allocation_uncertainty.py` + `tests/test_allocation.py`: 65 passed |
| Map framing fix from `ops-engine` (`95bb47e`, CI green there) | `c6cdc6c` | cherry-pick |

## In progress

Hospital preparedness and emergency surge engine (mentor scope): `dengueshield/preparedness.py`, fixture
`app_data/preparedness/planning_hospitals.json` (synthetic_demo), API `/api/preparedness/*`, UI section `#prepare` on the Response page.

## Next exact step

Write `dengueshield/preparedness.py` (daily mixed-patient occupancy, inventory, threshold rules, crisis states, referral LP), then tests.

## Facts found

- Real facilities: 914 OSM records (631 hospitals, 283 clinics; Dhaka 715, Chattogram 162, Gazipur 32, Narayanganj 5); 59 carry an
  OSM phone tag; 0 carry a beds tag; 0 carry an emergency tag. Road graphs: Greater Dhaka and Chattogram only.
- Verified emergency numbers already in the app: 999 (National Emergency Service, includes ambulance) and 16263 (DGHS Shasthya Batayon).
  No hospital-owned ambulance numbers exist in the bundled data.
