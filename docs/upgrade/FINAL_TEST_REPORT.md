# Final test report (championship sprint)

Development laptop (macOS), 27 Nov 2026, branch `upgrade/championship-engine-v2`. Local API on port 8300 from this worktree,
`FIREBASE_PROJECT_ID=demo-dengueshield-e2e`, frontend built with the CI placeholder environment. Retries off for every browser run.

| Suite | Result | Notes |
|---|---|---|
| `tests/test_preparedness.py` (new) | 17 passed | occupancy, inventory, alerts, LP vs max-flow, provenance, API contract |
| Python, full | 646 passed, 9 failed in the run with the onsite venv; the 9 then passed in the right environment | 6 need research libraries (`xgboost`, `catboost`, `optuna`, `yaml`): 34 passed with the research venv; 1 build-stamp test compared a commit made during the run: passed on rerun; 1 weather test fails whenever a fresh weather cache exists: `tests/test_offline.py` 10 passed with an empty `DENGUESHIELD_CACHE`; auth tests need `google-auth`: 13 passed with the onsite venv |
| Browser, full (`frontend/tests/e2e`) | 139 passed, 1 skipped, 1 failed | the failure was the new cursor test against a build made before the cursor existed |
| Browser after rebuild | 40 passed (cursor, scenario, preparedness, ops-engine, v4) + 31 passed (landing, every route, axe light and Dim) | includes Codex's scenario test, fixed by renaming the preparedness reset button |
| Offline kill-switch (macOS sandbox, loopback only) | 28 of 28 results identical, offline browser test passed, 0 outbound attempts | [OFFLINE_VERIFICATION.md](OFFLINE_VERIFICATION.md) |

Fixed during the run: a duplicate "Reset scenario" button name (now "Reset preparedness"); two preparedness tests that changed the city
before the shared scenario URL finished restoring (they now open Dhaka North by URL). Known behaviour, not changed: a city chosen in the
first moment after page load can be overwritten when the shared scenario restores from the URL.

Not run here: GitHub CI on this branch (dispatched after the final push; see the run link in the PR), a fresh-clone setup, a physical
Wi-Fi-off run on the judging laptop.
