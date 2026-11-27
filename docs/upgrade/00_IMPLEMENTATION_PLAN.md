# Phase 0 — Dependency-ordered implementation plan

Base `2124600fc55ea07a37a77b22ec46059a8895e7bf`. Changes stay on `upgrade/championship-engine-v2`. Each stage records acceptance tests, actual evidence and a targeted commit. Use [the baseline audit](00_REPOSITORY_AUDIT.md) and [the matrix](00_RUBRIC_TRACEABILITY.md) to distinguish verified incumbent features from work still required.

| Phase | First gap and acceptance check |
| --- | --- |
| 01 Scenario integrity | Start with a shared typed scenario, aligned ward and planning city, deterministic share links and history restoration. Keep current engines and endpoint clients. Verify deep links, manual settings, stale results and dispatch hashes against real local APIs. |
| 02 Command engine | Audit existing sticky rail, mobile sheet, graph and supply flow. Expand only where scenario status, operational consequences, or presentation controls are missing. Test with keyboard, reduced motion, mobile and tablet. |
| 03 Robust allocation | Establish joint historical demand residuals and matched-budget baselines before choosing an uncertainty objective. Require conservation and independent reference checks on small fixtures. |
| 04 Hospital intelligence | Preserve maximum transferred patients as the first objective. Benchmark added objectives only on defensible capacities and transfer constraints. |
| 05 Intervention | Compare manual, optimized, historical and seeded baselines with matched crew budgets and explicitly assumed effects. Protect zero-crew and zero-effect invariance. |
| 06 Stress testing | Reuse the scenario validator and engines. Compare transparent shocks and bind each recommendation to a tested objective. |
| 07 Geospatial | Extend distinct OSM navigation and abstract ward network views. Require source attribution and a usable offline fallback. |
| 08 Digital twin | Reuse canonical scenarios and stage data for comparison, replay and export. Use abstract networks for synthetic wards. |
| 09 Officer workflows | Inspect existing Firebase, permission gates, SQLite and review lifecycle before adding versioned scenario records and migration tests. Keep local workflows usable with external providers unavailable. |
| 10 Dispatch | Expand structured exports and Bengali PDF only with verified safe serialization, a usable font and measured rendering quality. Assert scenario, values and hash consistency. |
| 11 ML research | Reproduce the existing coverage comparisons before tuning. Analyze peak undercoverage and historical baselines on chronological development folds. The sealed 2025 outcomes stay outside selection and evaluation. |
| 12 Copilot | Verify allowed read-only tools and cost caps. Ground scenario explanations in returned values and provide a deterministic local fallback. |
| 13 Design | Audit the existing visual system route by route. Fix measured workflow and accessibility gaps before adding motion. |
| 14 Offline | Extend the 21-artifact readiness and network-isolation baseline to new features and persistence. Measure startup and compare numerical output. |
| 15 Security and performance | Review source and run defensive regressions for access control, validation and bounds. Benchmark approved workloads on a local instance. |
| 16 Mathematical evidence | Publish formulations and reproducible reference checks for the implemented algorithms and documented limits. |
| 17 Release candidate | Evaluate all 20 gates against actual evidence, prepare the script and Q&A, and preserve the frozen submission. Production and organizer submissions require separate authorization. |

Do not add a dependency until a tested requirement needs it. Verify source compatibility and rollback boundaries before considering a future release.
