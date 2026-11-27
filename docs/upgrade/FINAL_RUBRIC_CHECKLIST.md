# Official rubric evidence matrix

Base marks 100 (up to 10 discretionary bonus, capped at 100). Weights from the organizer PDF as recorded in
[00_RUBRIC_TRACEABILITY.md](00_RUBRIC_TRACEABILITY.md). This lists evidence only; scores are the judges' decision.

| Criterion (weight) | Implementation | Tests / evidence | Demo step (JUDGE_DEMO_SCRIPT_7MIN) | Status |
|---|---|---|---|---|
| Constrained resource allocation (15) | `dengueshield/allocation.py`, `/api/allocation/plan`, `/api/allocation/uncertainty`; `supply-allocation.tsx`, `allocation-flow.tsx` | `tests/test_allocation.py`, `tests/test_allocation_uncertainty.py`; `allocation.spec.ts`, `allocation-uncertainty.spec.ts` | 4:35-5:20 | PASS (tests) |
| Cross-ward hospital overflow (10) | `dengueshield/overflow.py`, `/api/overflow/plan`; `hospital-surge.tsx`, `surge-network.tsx`, `surge-map.tsx` | `tests/test_overflow.py` (brute force + max-flow); `hospital.spec.ts`, `ops-engine.spec.ts` (exact links, none at baseline) | 4:35-5:20 | PASS |
| Vector control (10) | `dengueshield/intervention.py`, `/api/intervention/simulate`; `vector-control.tsx` | `tests/test_intervention*.py`; `vector.spec.ts` | 6:00-6:30 | PASS (simulated effect, labelled) |
| Offline resilience (15) | `scripts/setup.sh`, `scripts/launch_offline.sh`, `dengueshield/offline.py`, `scripts/offline_verify.py`, `scripts/killswitch.sh` | macOS kill-switch 28/28 + offline browser test, 0 outbound; fresh clone 28/28; Linux kill-switch in CI | 0:00-0:25, 6:30-7:00 | CONDITIONAL: physical Wi-Fi-off run on the judging laptop not done ([WIFI_OFF_CHECKLIST.md](WIFI_OFF_CHECKLIST.md)) |
| Repository, live URL, architecture, AI disclosure, dispatch exports (10) | README, ARCHITECTURE.md, footer disclosure; `/api/dispatch/*`, `/api/preparedness/brief` | `tests/test_dispatch.py`, `dispatch.spec.ts`; brief tests | 6:00-6:30 | **FAIL until the backend is deployed**: the live frontend (from PR #9) calls endpoints the old backend does not have ([FINAL_RELEASE_CHECKLIST.md](FINAL_RELEASE_CHECKLIST.md)) |
| Seven-minute uncut video (10) | run sheet | script verified against engine outputs | all | NOT RUN: not recorded |
| Technical Q&A (30) | [JUDGE_QA_100.md](JUDGE_QA_100.md) (100, English + বাংলা), [JUDGE_QA_BANGLA.md](JUDGE_QA_BANGLA.md) | — | live | Prepared; judged live |
| Bonus innovation (≤10) | `dengueshield/preparedness.py`, `/api/preparedness/*`, `hospital-preparedness.tsx` (mixed-patient occupancy, inventory + redistribution, dynamic alerts, 28-day referral program, real-facility tiers); Operations engine | `tests/test_preparedness.py` (22); `preparedness.spec.ts` | 0:55-5:20 | Judges' decision |
