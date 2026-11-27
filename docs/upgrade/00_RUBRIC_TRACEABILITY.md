# Phase 0 — Organizer rubric traceability

Source is the supplied `Hackathon_Phase2_Problemset.pdf`, pages 1–3, SHA-256 `ad6f63702044a726e51933a2532db784588afb54531bf778a778ff251700b415`. Base marks total 100. The organizer describes up to 10 discretionary bonus points subject to a strict 100-point maximum. This table records engineering evidence and does not assign judges' marks.

| Organizer criterion | Base weight | Baseline engineering status | Evidence and next check |
| --- | ---: | --- | --- |
| Interactive constrained resource allocation | 15 | PASS | Forecast-based supply and crew allocation across 60 wards. 30% stock deficits reproduced publicly. Keep conservation, city isolation, and fairness regression tests. |
| Cross-ward hospital overflow | 10 | PASS | 120% scenario returned nine same-city transfers and 16 unresolved projected patients. The capacities are illustrative. |
| Vector control | 10 | PASS | Optimized estimates span weeks 2–4, with intervention effect and downstream resource assumptions disclosed. Validate alternate policies on identical budgets before ranking them. |
| Offline resilience | 15 | CONDITIONAL | Native local engines and network-isolated CI are in place. Physical network disconnection at judging and clean-clone recovery were not run in this baseline. |
| Continuous Phase 1 repository, live URL, architecture, AI disclosure and dispatch exports | 10 | CONDITIONAL | Official history remains intact. Production was reachable and version-attributed. Existing architecture, AI disclosure, and sample exports are present. The brief selection discrepancy affects consistent demonstrations. |
| Seven-minute uncut walkthrough with voiceover | 10 | NOT RUN | Existing run-sheet is present. This audit did not verify a recording or upload. |
| Technical Q&A | 30 | NOT RUN | Stage handoffs contain engineering explanations. Judge responses and scores are unassessed. |
| Bonus domain-relevant innovation | Up to 10, capped as above | CONDITIONAL | Existing Operations Engine, ward flow visualizations and deterministic exports are demonstrable. Bonus decisions belong to judges. |

## Upgrade verification

[Phase 1 evidence](01_SCENARIO_INTEGRITY.md) covers scenario synchronization, cross-engine inputs, and dispatch faithfulness on the upgrade branch. The macOS kill-switch verified 21 of 21 matching outputs. The baseline below describes the original public build at audit time.

## Acceptance gate baseline

| Gate | Status | Baseline evidence |
| --- | --- | --- |
| 01 Existing functionality | CONDITIONAL | Core read-only API and nine page routes smoke-tested. |
| 02 Scenario synchronization | FAIL | The public deep-linked ward and dispatch ward differ. |
| 03 Allocation | PASS | Public conservation sample and existing unit suite. |
| 04 Hospital flow | PASS | Intra-city public sample and existing reference solver checks. |
| 05 Intervention | PASS | Weeks 2–4 scenario and existing mathematical invariants. |
| 06 Cross-engine consistency | FAIL | Separate UI scope and stale timing can produce a mixed view. |
| 07 Persistent decisions | CONDITIONAL | SQLite officer flows exist. Versioned scenario restoration and restart behavior remain to be verified. |
| 08 Dispatch faithfulness | CONDITIONAL | Direct API IDs and formats work. Deep-link ward selection must be fixed. |
| 09 ML evaluation integrity | CONDITIONAL | Temporal invariants and source review support the development lock. No new modeling or full experiment reproduction was performed. |
| 10 Offline execution | CONDITIONAL | Existing CI and application-level guard are available. Physical and cross-platform recovery are untested. |
| 11 Security | CONDITIONAL | Existing auth dependencies and controls reviewed. Full defensive audit remains. |
| 12 Performance | CONDITIONAL | Five serial request timings only. |
| 13 Device usability | CONDITIONAL | Response smoke passed at 390, 768, and 1440 px. |
| 14 Accessibility and motion | CONDITIONAL | Existing test coverage, reduced-motion behavior, and the verified Forecast Lab hunk are present. Current full-route audit is pending. |
| 15 Visual quality | CONDITIONAL | Operations Engine already integrated. A full comparative review is pending. |
| 16 Fresh-clone reproducibility | NOT RUN | Used existing data, Python environments and cached browser dependencies. |
| 17 CI | PASS | Exact-main and Operations Engine PR CI passed. Run references are in the baseline JSON. |
| 18 Documentation | CONDITIONAL | Existing architecture and handoffs cover the submission. Upgrade evidence grows with each stage. |
| 19 Build compatibility | PASS | Current source built with Next.js webpack. |
| 20 Official rubric traceability | PASS | All criteria mapped to organizer PDF wording. |
