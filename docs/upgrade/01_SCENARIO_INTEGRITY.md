# Phase 1 — Scenario integrity

Starting commit `b1f3696`. The audit reproduced a Dispatch ward mismatch on the public frontend at three widths. Version 1 of the local upgrade binds the command controls, decision stages, and brief to the current selection.

- The planner has typed settings with documented defaults. The link represents the forecast origin, horizon, source, ward, city, service level, stock, crews, priorities, capacity, ward overrides, and intervention assumptions. Manual assignments and overrides use sorted keys. The parser bounds numeric fields and verifies ward IDs against the loaded ward directory.
- The planning city controls all three engines and narrows the available wards. In the all-city pool, choosing a brief city changes the selected ward while retaining the planning pool. The same ward appears in the command controls, Dispatch, and URL. Legacy links restore sensible values. An unrecognized version gives a visible default-settings notice.
- A settled edit creates one browser-history entry. Copy-link, reload, Back, Forward, and reset reproduce the scenario. These links work on a compatible local build without external services.
- Each operation tracks the exact inputs used for its result. During debounce and in-flight changes, previous results remain labeled while newer inputs are pending. Dispatch and stage CSV controls reject previous snapshots. Dispatch cancels a download when the selected snapshot changes and verifies the ID and content hash before saving.
- The dispatch API accepts optional `scenario_v=1` and returns the contract version. Legacy callers receive the same normalized scenario and can continue omitting the version. Unknown versions receive HTTP 422. The existing deterministic `S-…` fingerprint remains derived from normalized settings and artifact hashes. The same fingerprint and content hash accompany both the preview and matching document downloads.

## Verification

| Check | Result |
| --- | --- |
| Backend regression | 270 passed in 13.39 s across allocation, overflow, intervention API, dispatch, and offline tests. The version test covers default compatibility and unsupported versions. |
| Browser regression | 40 passed in 1.1 min with retries disabled. The suite covers shared ward and city, populated links, Back and Forward, reset, a held stock request, forecast-source guards, stage timing, mobile, PDF/HTML and bilingual notices. It includes light and dim axe checks on vector control and Dispatch. |
| Local build | TypeScript passed. Next.js webpack compiled the static export with 19 pages. |
| Network isolation | The repository macOS kill-switch passed. 21 of 21 API and export checks matched the normal-network instance, and the Chromium operations workflow passed while outbound network access was denied. All 21 required artifacts were present and the server reported zero refused optional requests. |
| Measured local timings | In the single-sample offline comparison, ward forecast was 295.4 ms, 30% allocation 35.9 ms, 120% hospital overflow 36.1 ms, default intervention 143.9 ms, and ward PDF 72.7 ms. These are loopback observations from one run. |

Reproduce the unit tests with `pytest -q tests/test_dispatch.py tests/test_offline.py tests/test_intervention_api.py tests/test_overflow.py tests/test_allocation.py`. Build with `npm run typecheck -- --incremental false` and `npm run build -- --webpack` in `frontend`. Against the local API, run Playwright on `scenario.spec.ts`, `allocation.spec.ts`, `hospital.spec.ts`, `vector.spec.ts`, `dispatch.spec.ts`, and `ops-engine.spec.ts` with `--retries=0`. The isolation run used `scripts/offline_verify.py` and `scripts/killswitch.sh`. The first local browser attempt exposed an early city-selection hydration race and the test server also exited. Controls now wait for scenario restoration, and the final run used the verified local Python environments with one thread per native solver library.

No forecast model, resource equations, or capacity assumptions changed. No new solver or dependency was introduced. Existing Next.js build and FastAPI lifespan warnings remain. Phase 1 improves organizer traceability for allocation, overflow, vector control, dispatch, and offline operation. The broader persistent officer workflow and independent solver checks remain separate stages.
