# Rubric checklist (requirement → evidence)

Organizer base marks 100 (bonus up to 10, capped at 100). Weights from [00_RUBRIC_TRACEABILITY.md](00_RUBRIC_TRACEABILITY.md).
Scores are the judges' decision; this lists evidence only.

| Criterion | Weight | Evidence on this branch | Status |
|---|---:|---|---|
| Constrained resource allocation | 15 | Stage 01 (`/api/allocation/plan`, allocation instrument, `tests/test_allocation.py`); Codex's matched-budget comparison (`/api/allocation/uncertainty`, 65 tests passed) | PASS (tests) |
| Cross-ward hospital overflow | 10 | Stage 02 (`/api/overflow/plan`, same-city max-flow, ward network: 0 links at baseline, 9 at +20%), unchanged | PASS (tests) |
| Vector control | 10 | Stage 03 (`/api/intervention/simulate`); its prevented share now feeds hospital demand in the preparedness engine | PASS (tests) |
| Offline resilience | 15 | macOS kill-switch 28/28 identical incl. 6 preparedness calls, offline browser test, 0 outbound attempts ([OFFLINE_VERIFICATION.md](OFFLINE_VERIFICATION.md)) | CONDITIONAL: physical Wi-Fi-off run on the judging laptop not yet done |
| Repository, live URL, architecture, AI disclosure, exports | 10 | Branch pushed; dispatch HTML/PDF/SMS/WhatsApp and preparedness HTML/CSV/text briefs; ARCHITECTURE and README sections | CONDITIONAL: production not updated (needs owner approval); repo visibility is the owner's call |
| Seven-minute uncut video | 10 | [JUDGE_DEMO_SCRIPT_7MIN.md](JUDGE_DEMO_SCRIPT_7MIN.md) | NOT RUN: not recorded |
| Technical Q&A | 30 | [JUDGE_QA_BANGLA.md](JUDGE_QA_BANGLA.md) (46 answers) | Prepared; judged live |
| Bonus innovation | ≤10 | Hospital preparedness engine (mixed-patient occupancy, inventory, dynamic alerts, crisis states, LP + max-flow referrals, real-facility tiers), Operations engine | Judges' decision |

Mentor questions → answers: table at the top of [HOSPITAL_PREPAREDNESS.md](HOSPITAL_PREPAREDNESS.md).
