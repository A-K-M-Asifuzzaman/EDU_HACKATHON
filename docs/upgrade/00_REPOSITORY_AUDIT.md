# Phase 0 — Repository and production audit

Audit date 27 November 2026. The upgrade branch starts at `2124600fc55ea07a37a77b22ec46059a8895e7bf` in a separate local checkout. The official submission and both existing working trees were preserved.

| Ref fetched from the official repository | Revision | Relationship to main |
| --- | --- | --- |
| `main` | `2124600fc55ea07a37a77b22ec46059a8895e7bf` | Upgrade base and Vercel Git revision |
| `ops-engine` | `8718c85eecbd7d8a5c3a33f37a7be4165c3e096b` | Ancestor. Main has five additional commits and no unique Operations Engine commits remain outside it. |
| `version-onsite-final` | `57be72a1b20dfa30b4586dedbbddf02086fad2c0` | Ancestor. Main has seven additional commits and includes the verified Forecast Lab animation. |

## Observed behavior

- The [public frontend](https://we-are-hack-squad.vercel.app/) served Vercel deployment `dpl_646YykxSpPTa5qVAqkoBMzULPxc2` in READY state. The health endpoint identified backend `4ce4801`. Dataset, bundle, replay, and research artifacts were loaded. The frontend and backend revisions differ. The public app returned compatible forecasts and completed allocation, overflow, intervention, and dispatch queries.
- Anonymous Chromium loaded the landing, Command Center, Forecast Lab, Geography, Model Evidence, Provenance, Climate, and Sign-in pages with HTTP 200 and a visible heading. Response loaded and rendered a brief at 390, 768, and 1440 px. The sampled pages emitted no uncaught browser exceptions. Response had zero document overflow at the sampled widths.
- A deep link to `DNCC_Ward_19` showed a Dhaka South brief at every sampled width. It chose `DSCC_Ward_04` at 390 and 1440 px and `DSCC_Ward_01` at 768 px. The direct API honored `DNCC_Ward_19`. The dispatch component maintains independent city and ward state and can pick the fallback list before allocation ranking returns. The Operations Engine also keeps a city setting separate from the global selection. These are Phase 1 integration gaps.
- Changing controls produces different debounce windows for allocation, overflow, vector control, and dispatch. Request cancellation and retry handling already exist in `useAsync`. The current view can show an older snapshot during a debounce interval, and the dispatch actions use the visible snapshot regardless of staleness. The report rail currently carries each stage's own stale flag without a common scenario contract.
- Production is online. Its backend offline manifest reports 19 of 21 artifacts available. The two expected local HTML files live on the separately hosted frontend. Use the local manifest and the network-isolated CI job as offline evidence. This audit did not disconnect physical Wi-Fi.
- One warm serial request per historical endpoint ranged from 380 to 617 ms from the audit host. These measurements include HTTP and provider latency and do not establish percentiles or throughput. The one reported inference probe was 610.2 ms. The baseline JSON retains raw observations.

## Implementation and evidence reviewed

| Area | Existing implementation | Gap to resolve |
| --- | --- | --- |
| Resource allocation | `allocation.py` allocates integer supplies independently per city, applies the scarcity floor, and maximizes weighted fulfillment for residual supply under its stated assumptions. The browser exposes four resource channels including crews and a flow diagram. | Preserve the original objective. Evaluate optional resource-specific supply, reserves and joint demand scenarios against identical budgets before adding a solver. |
| Hospital overflow | `overflow.py` computes within-city maximum transfer volume analytically, water-fills spare capacity and constructs integer flows. The Operations Engine adds an abstract network and a separate OSM map. | Test secondary objectives with independent references. Illustrative ward beds and actual facilities represent separate datasets. |
| Vector control | `intervention.py` derives coverage, delayed effect and diminishing marginal benefit. It includes an exact marginal allocation rule under separability and three forecast horizons. | Separate policy baseline and sensitivity evidence. Report assumed effects and avoid causal or monetary claims without inputs. |
| Dispatch | `run_scenario` invokes the existing engines, hashes normalized settings and artifacts, and links previews/downloads with scenario and content hashes. The eight sample families under `exports/` cover text and documents for wards and cities. | Bind the brief to the joint selection. English PDF and Bangla HTML are implemented. Embedded, shaped Bangla PDF and independently checked structured exports remain future work. |
| Authentication and storage | Firebase credentials are verified server-side, roles and audit events are stored in SQLite, and officer/admin endpoints use server-side role dependencies. Public plan features run without sign-in. | Verify workflow transitions, persistent scenario versions, and continuity after restart. Existing Firebase sign-in needs provider connectivity. This audit used source and existing local regression tests only. |
| Forecasting | Research notebooks 01–09 cover data, temporal splits, baselines, features, tournament, peaks, and onsite inputs. `reports/MODEL_COMPARISON.md` records a predeclared simplicity rule and selected Ridge Poisson with F8. | Reuse the tournament and benchmark protocol. Peak error grows with horizon. The 2019–2024 development figures have different information availability and horizons from weather-only nowcasts. No cross-protocol superiority is established. |
| Offline and build | Static Next export, local FastAPI engines, a 21-artifact manifest, bundled fonts and workers, and a loopback-only CI check already exist. Reviewed setup, CI and deployment flow, architecture, and onsite handoffs. | Repeat from a clean machine and after each scenario or persistence change. The local webpack baseline built successfully. |
| Frontend quality | Operations Engine already has shared controls, sticky summary rail, mobile sheet, keyboard controls, and reduced-motion support. | Resolve correctness before extending motion or adding more workspaces. This is a responsive smoke sample. A full accessibility and performance audit remains separate. |

## Baseline verification

- Public API sample uses the historical origin 5 August 2024, horizon three, and the all-city planning pool. At 30% stock the engine allocated 528 of 1,767 saline bags, 256 of 864 kits, and 65 of 224 regional-stock beds. At 120% illustrative capacity, nine patients moved within cities and 16 remained unresolved. The default intervention model estimated 63.188 fewer cases across weeks 2–4 under its assumptions.
- Parent GitHub CI for `57be72a` completed successfully. Exact-main and Operations Engine CI are recorded separately in the baseline metrics. The tests here use the cached official local inputs from the existing onsite setup. No 2025 outcomes were used, and no forecast model or release configuration was changed.
- The first local test invocation found missing authentication dependencies and a runner loopback restriction, alongside 298 successes. A correctly configured rerun is recorded in the baseline metrics. The upgraded work will use local build and browser output rather than the older release guide as its runtime reference.

Source notes are in [the rubric matrix](00_RUBRIC_TRACEABILITY.md), [the implementation plan](00_IMPLEMENTATION_PLAN.md), and [the measured baseline](00_BASELINE_METRICS.json).
