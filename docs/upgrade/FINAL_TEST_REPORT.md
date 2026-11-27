# Final test report (closure sprint)

Development laptop (macOS), 27 Nov 2026, branch `upgrade/championship-engine-v2`. Browser runs with retries off, frontend built with the
CI placeholder environment, local API with `FIREBASE_PROJECT_ID=demo-dengueshield-e2e`.

| Gate | Result | Notes |
|---|---|---|
| Python, full (runtime venv, empty weather cache, without `test_models.py`) | 628 passed, 1 failed | the failure is `test_deploy_config` needing `yaml`, absent from that venv; it passed in the research venv |
| Python, research venv (`test_models.py`, `test_deploy_config.py`) | 34 passed | needs xgboost, catboost, optuna, yaml |
| Browser, full | 142 passed, 1 skipped, 0 failed | after the last UI fix, `preparedness.spec.ts` re-run: 8 passed |
| Preparedness unit tests | 22 passed | after the referral-consistency fix |
| Offline kill-switch (macOS sandbox, loopback only) | 28/28 identical, offline browser test passed, 0 outbound attempts | |
| Fresh clone (`--depth 1` of the pushed branch at `12dda5f`) | `scripts/setup.sh` completed; 266 tests passed (preparedness, offline, overflow, allocation); `launch_offline.sh`: 28/28 identical to that clone's online baseline; Response 200; offline readiness `artifacts_ok: true` | the fresh clone downloaded and checksum-verified the datasets |
| GitHub CI | see PROGRESS_CHECKPOINT.md for the final run id | earlier runs on this branch: 45999833899 (`a7f37b9`) all four jobs green, 140 browser tests passed |

Fixed in this sprint: the shared-scenario restore race (an edit made in the first ~300 ms was overwritten; now re-applied, with a test);
the executive tile, status-after-response and text brief used the peak-day referral count while the 28-day plan said otherwise (now the
28-day plan everywhere, the peak-day plan labelled as a cross-check).

Not run: physical Wi-Fi-off on the judging laptop; a screen-reader pass (automated axe only).
