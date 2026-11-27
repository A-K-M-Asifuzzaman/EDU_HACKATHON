# Phase 2 onsite, Stage 3: vector-control impact and intervention ROI simulator (Problem 3)

Stage 3 only; Stage 4 is not started. This is an assumption-driven scenario simulator built on the saved forecasts. It is not a measured
or validated causal model: the organizer data contain no spraying or larvicide records and no intervention outcomes.

Unless stated, every number below comes from `GET /api/intervention/simulate` on the local API with these settings:

| Setting | Value |
|---|---|
| Forecast issued | 2024-08-05; target weeks 2024-08-19, 2024-08-26 and 2024-09-02, all from the validated replay |
| Planning horizon for supplies and hospital | 3 weeks, at the upper end of the 80% range |
| Crews | 20 crews, at most 3 per ward |
| Effect | the "Moderate" illustrative preset (E 30%, a 35%, d 1 week, w 2 weeks) |
| Stock and capacity | 60% stock, 100% of the illustrative bed capacity |

The checks are in `tests/test_intervention.py`, `tests/test_intervention_api.py` (20 tests) and `frontend/tests/e2e/vector.spec.ts` (8 tests).

## What was built

| Part | File |
|---|---|
| Response model and crew optimiser | `dengueshield/intervention.py` |
| API (forecasts, deployment, ROI, sensitivity, resources, hospital) | `GET /api/intervention/simulate` in `dengueshield/api/main.py` |
| Shared Stage 2 capacity helper; Stage 1 engine accepts fractional cases and fixed supply | `ward_capacity()` in `dengueshield/api/main.py`; `allocation.plan(..., supply=)` |
| Scenario workstation on Response Intelligence | `frontend/components/vector-control.tsx` |
| One plan state for Stages 1 to 3 (city, service level, stock, crews, capacity) | `usePlanState()` in `frontend/components/supply-allocation.tsx` |

## 1. What is measured and what is assumed

| Category | What it is | Where it comes from |
|---|---|---|
| Observed data | Weekly cases, weather and resource needs, 2016-2024 (synthetic organizer data) | trains and replays the forecasts; sets the illustrative bed capacity; target weeks never read; 2025 sealed |
| Saved forecasts | Expected weekly cases per ward at 2, 3 and 4 weeks | validated replay for 2019-2024 targets, deployed model only past its training window, via `decision_forecast()`; model unchanged |
| Assumptions | E, a, d, w, sensitivity multipliers, crews per ward | set by the user; presets are illustrative and are never shown as efficacy |
| Scenario estimates | Scenario cases, cases prevented, resource and hospital changes | counterfactual outputs of the response model under those assumptions |
| Limitations | listed in section 10 and in the UI's "Sources and limits" tab | |

## 2. Response equations

For ward i, horizon h in {2, 3, 4} and k_i crews deployed at the forecast origin:

    coverage    C(k)   = 1 - (1 - a)^k
    timing      T(h)   = min(1, max(0, (h - d) / w))
    reduction   R(k,h) = E * C(k) * T(h)
    scenario    mu'_ih = (1 - R(k_i, h)) * mu_ih
    prevented   P_ih   = R(k_i, h) * mu_ih
    quantiles   q'_ih  = (1 - R(k_i, h)) * q_ih   (median, upper 80%, upper 90%)

Parameters:
- mu_ih is the forecast of expected weekly cases (fractional).
- a is the share of a ward one crew treats (5-100%).
- d is the delay before any effect reaches reported cases (0-3 weeks).
- w is the number of weeks to full effect (1-3).
- E is the largest share of a ward's projected cases the intervention could avert at full coverage (0-80%).

Rationale:
- **Coverage.** Crews treat overlapping parts of a ward at random, so each extra crew treats a share a of what is still untreated. This
  gives diminishing returns, and coverage never reaches 100% with finite crews. The model doesn't assume one crew can cover a whole ward
  unless a = 100%.
- **Timing.** Killing larvae or adult mosquitoes changes reported cases only after new adults fail to emerge, infections already
  incubating have surfaced, and the extrinsic and intrinsic incubation periods have passed. So nothing changes for d weeks, then the
  effect builds linearly over w weeks.
- **Bound.** 0 <= R <= E <= 0.8, so scenario cases are never negative and never below 20% of the forecast.
- **Exactness.** k = 0 gives C = 0, and E = 0 gives R = 0. Either way the forecast is reproduced exactly, which a test checks with array
  equality.
- **Monotone.** C rises with k, so for fixed assumptions more crews never reduce the modelled reduction.
- **Precision.** Cases stay fractional through the model; the first rounding is the resource rule floor(m x cases + 0.5). Totals are
  summed unrounded and rounded only for display (3 decimals in the API).

## 3. Crew constraints

- Budget K: the shared crew count from Supply allocation (0-1000). Changing it in either section changes both.
- At most k_max crews per ward (shared, 1-10). Integers only, and the sum of k_i is at most K.
- Three deployment modes:
  - **Optimized:** marginal-value greedy (section 4).
  - **Manual:** the officer adds or removes crews per ward. It starts from the optimized plan, and the API refuses plans over budget,
    over k_max, or naming wards outside the view.
  - **Supply plan:** Stage 1's coverage-first crews, unchanged.
- Crews worth nothing under the model are left unassigned and reported, for example in wards with no projected cases or once every
  ward is at k_max. With 1,000 crews, 180 are assigned (60 wards x 3) and 820 are unassigned.
- A city view spends the budget on that city's wards only.

## 4. Optimisation objective and algorithm

The plan maximises modelled cases prevented over the forecast window:

    maximise  sum_i sum_h P_ih  =  sum_i E * W_i * C(k_i),   W_i = sum_h T(h) * mu_ih
    subject to  sum_i k_i <= K,  0 <= k_i <= k_max,  k_i integer

The marginal value of the k-th crew in ward i is g_i(k) = E * W_i * a * (1 - a)^(k - 1), which does not increase with k. The objective
is therefore a sum of concave functions of integers under a single budget. The greedy rule is exact: give each next crew to the largest
available marginal value, using a priority queue. Ties go to the higher outbreak probability, then the ward ID. Exchange argument:
any plan that leaves a larger marginal value unused while spending a crew on a smaller one can be improved by moving that crew.

The API returns this as a checkable certificate: the weakest assigned crew's value is at least the best unused option's value. For the
default plan, 2.622 >= 2.604 cases. Tests compare the optimiser with brute-force enumeration and an independent dynamic-programming
knapsack on 120 random small cases.

ROI is modelled cases prevented per crew over the window. It is reported per ward along with the value of the last crew and of the next
one.

## 5. Results by week (20 crews, Moderate)

| Target week | Effect timing T(h) | Forecast | Scenario | Prevented (low to high) |
|---|---|---|---|---|
| +2 weeks, 2024-08-19 | 50% | 378.7 | 369.9 | 8.8 (4.4 to 13.2) |
| +3 weeks, 2024-08-26 | 100% | 513.0 | 489.2 | 23.8 (11.9 to 35.7) |
| +4 weeks, 2024-09-02 | 100% | 661.8 | 631.2 | 30.6 (15.3 to 45.9) |
| Window | | 1,553.5 | | 63.2 (31.6 to 94.8), 3.2 per crew |

The effect grows across horizons for two reasons. The timing factor delays it (T = 0.5 at +2 weeks). And the forecast itself rises
towards the peak, so the same reduction share prevents more cases later.

Worked example, CCC_Ward_03 (Critical, outbreak probability 0.877, one crew):

- Forecasts: mu = 10.447, 13.766 and 17.666.
- W = 0.5 x 10.447 + 13.766 + 17.666 = 36.656.
- Value of the first crew: g(1) = 0.30 x 36.656 x 0.35 = 3.849 cases. A second crew would add g(2) = 3.849 x 0.65 = 2.502.
- Prevented at +2 weeks: 0.0525 x 10.447 = 0.548.
- Saline at +3 weeks, upper 80%:
  - forecast quantile 19, so floor(2.3844 x 19 + 0.5) = 45
  - scenario quantile 19 x (1 - 0.105) = 17.005, so 41
- Beds: 6 -> 5.

## 6. Intervention ROI ranking (20 crews)

| Rank | Ward | Crews | Prevented per crew | Next crew would add |
|---|---|---|---|---|
| 1 | CCC_Ward_03 | 1 | 3.849 | 2.502 |
| 2 | DSCC_Ward_04 | 1 | 3.808 | 2.475 |
| 3 | CCC_Ward_01 | 1 | 3.634 | 2.362 |
| 4 | DNCC_Ward_12 | 1 | 3.606 | 2.344 |
| 5 | DNCC_Ward_19 | 1 | 3.570 | 2.321 |
| 6 | DSCC_Ward_06 | 1 | 3.356 | 2.182 |
| 7 | GCC_Ward_02 | 1 | 3.347 | 2.176 |
| 8 | DNCC_Ward_18 | 1 | 3.229 | 2.099 |

With 20 crews every first crew in the top 20 wards beats any second crew, so the plan spreads one crew per ward.

Budget curve (window cases prevented, optimized vs Supply-plan crews):

| Crews | Optimized | Supply plan | Per crew | Weakest assigned / best unused |
|---|---|---|---|---|
| 10 | 34.8 | 34.8 | 3.48 | 3.193 / 3.164 |
| 20 | 63.2 | 62.7 | 3.16 | 2.622 / 2.604 |
| 40 | 110.8 | 107.8 | 2.77 | 2.176 / 2.176 |
| 60 | 150.6 | 143.2 | 2.51 | 1.815 / 1.815 |
| 110 | 228.8 | 225.9 | 2.08 | 1.282 / 1.268 |
| 180 | 296.9 | 225.9 | 1.65 | 0.583 / none (all wards at 3) |

Diminishing returns are visible at budget level as well: the cases prevented per crew fall as the budget grows. The Supply-plan rule
stops at 225.9 because its own crew-need rule caps the crews it asks for at 110.

## 7. Resource demand changes (planning horizon +3 weeks, same 60% stock)

| Resource | Stock (unchanged) | Projected demand | Change | Short under the same stock | Stock not needed |
|---|---|---|---|---|---|
| Saline bags | 1,059 | 1,767 -> 1,690 | -77 | 708 -> 631 | 0 |
| Diagnostic kits | 516 | 864 -> 833 | -31 | 348 -> 317 | 0 |
| Hospital beds (regional stock scenario) | 132 | 224 -> 215 | -9 | 92 -> 83 | 0 |

- The allocation is recomputed with Stage 1's engine, the same priorities and floor, and the stock fixed at the baseline figure. The
  scenario lowers demand; it creates no supply, and lower demand is not presented as stock freed, delivered or redistributed.
- "Stock not needed" stays zero at the peak because demand still exceeds stock.
- Demand rounds once, through the dataset's rule, after scaling the forecast quantile, so the savings are not inflated by intermediate
  rounding.

## 8. Hospital overflow changes (same illustrative capacity, 100%)

| City | Capacity | Bed demand | Over capacity | Transfers | No bed in own city |
|---|---|---|---|---|---|
| Chattogram | 29 | 38 -> 36 | 9 -> 8 | 0 -> 1 | 9 -> 7 |
| Dhaka North | 55 | 72 -> 71 | 17 -> 16 | 0 | 17 -> 16 |
| Dhaka South | 57 | 74 -> 71 | 17 -> 14 | 0 | 17 -> 14 |
| Gazipur | 17 | 22 -> 20 | 5 -> 3 | 0 | 5 -> 3 |
| Narayanganj | 13 | 18 -> 17 | 5 -> 4 | 0 | 5 -> 4 |
| All | 171 | 224 -> 215 | 53 -> 45 | 0 -> 1 | 53 -> 44 |

Chattogram's demand falls by 2 beds: one in an over-capacity ward (over capacity 9 -> 8) and one in CCC_Ward_07, which was exactly full.
That freed bed takes the city's first transfer (CCC_Ward_03 -> CCC_Ward_07), so its shortage falls by 2 (9 -> 7).

Combined with Stage 2's 120% capacity scenario and 40 crews, the regional shortage falls from 16 to 1 and transfers rise from 9 to 22.

Throughout:
- Capacity is Stage 2's illustrative capacity through the shared `ward_capacity()` helper. It is not a bed inventory.
- Stage 1's bed stock is never added to it.
- Transfers stay inside each city.

## 9. Sensitivity (same 20 crews; window cases prevented)

| Effect | Delay 0 | Delay 1 (current) | Delay 2 | Delay 3 |
|---|---|---|---|---|
| 50% of E | 36.0 | 31.6 | 21.2 | 7.6 |
| 100% of E | 72.0 | 63.2 | 42.5 | 15.3 |
| 150% of E | 108.0 | 94.8 | 63.7 | 22.9 |

Presets at 20 crews:

| Preset | E, a, d, w | Prevented | Range |
|---|---|---|---|
| Cautious | 15%, 25%, 1, 2 | 22.7 | 11.4 to 34.1 |
| Moderate | 30%, 35%, 1, 2 | 63.2 | 31.6 to 94.8 |
| Strong | 45%, 50%, 1, 1 | 154.3 | 77.1 to 231.4 |

The spread is wide, roughly 7 to 1 between Strong and Cautious. That is the honest message: without intervention data the answer
depends mainly on the assumed effect, so the UI shows the range next to every central estimate.

## 10. Scientific limitations

- **No causal effect is estimated.** The dataset has no intervention records or outcomes, so efficacy cannot be identified from it. E, a,
  d and w are assumptions, and the presets are illustrative.
- **One deployment at the origin.** It is assumed to persist through week 4. Waning, repeat rounds, resistance and spill-over between
  neighbouring wards are not modelled. Wards have no area, geometry or breeding-site data, so every ward is treated alike.
- **Proportional scaling.** The reduction scales the forecast proportionally, including its quantiles. That approximates a change in the
  mean of a count distribution, not an exact quantile transform. Transmission feedback (fewer cases now, fewer infections later) is not
  simulated beyond the forecast window.
- **Forecast error** carries into every estimate and is largest at outbreak peaks.
- **Windows can be partial.** Near a replay gap (late December), horizons without an out-of-time forecast are dropped and reported. The
  window then covers fewer weeks, and the UI says so.

## 11. Offline verification

The simulator reads only local artefacts: the replay table, the deployed model bundle (January 2025 targets only), the onsite CSV for
capacity, and the resource rules. The optimiser, the Stage 1 allocation and the Stage 2 overflow are local Python.

A test runs the endpoint with sockets disabled. There are no OpenAI, Firebase, AppLink, weather API or remote inference calls. The UI is
part of the static export served by the same API.

## 12. Automated tests

`tests/test_intervention.py` (7 tests, model and optimiser):
- zero crews and zero effect reproduce the forecast exactly
- bounds and non-negativity (300 random settings)
- diminishing returns, concave coverage and monotone crews
- delay and build-up across horizons
- effect cap and invalid parameters
- optimiser equals brute force and dynamic programming on 120 random cases, with budget conservation
- tie order, unassigned crews and full-coverage saturation

`tests/test_intervention_api.py` (13 tests):
- baselines equal the origin-safe forecasts at each horizon, and window totals equal the sum of the horizons
- zero crews change nothing downstream
- optimality certificate, and optimized >= Supply-plan rule and manual plans
- Supply-plan mode uses Stage 1's crews
- ROI ranking, maximum budget and per-ward cap
- resource demand follows the dataset rule at the planning horizon, with supply unchanged
- hospital overflow equals Stage 2's engine on the scenario demand, with the same capacity
- city isolation and determinism
- sealed 2025, in-sample refusal and partial horizons
- 14 invalid parameter sets (422) and an unknown city (404)
- offline run with sockets disabled

`frontend/tests/e2e/vector.spec.ts` (8 tests):
- headline, supplies, hospital and disclosure tabs
- zero effect and zero crews reproduce the forecast, with the crew budget shared with Supply allocation
- manual steppers within budget, and the "can be improved" warning
- in-sample refusal
- axe (WCAG 2 A/AA) on every tab in light and dim mode
- 360 and 390 px without sideways scroll, with 44 px touch targets

Full results on this branch: pytest 611 passed (was 591); Playwright 107 passed with no retries (was 99), built and served as in CI.

## 13. Git and CI

| Commit | Content |
|---|---|
| `9bfacb7` | version-onsite-final: implement intervention response model and invariants |
| `07a8cd7` | version-onsite-final: add crew optimization and downstream impact calculations |
| `48b418a` | version-onsite-final: integrate vector-control scenario workspace |
| `36f3eeb` | version-onsite-final: keep scenario sections mounted while they recompute |
| this document | version-onsite-final: document intervention assumptions and technical defense |

All are on `version-onsite-final` in the official repository; nothing was merged into `main` or deployed.

CI on `48b418a` failed in the browser job (https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45946686802). The CI
traces showed two real defects:

1. The shared Loading component renders a different element tree while refreshing, so the Stage 1-3 sections remounted on every control
   change. Tables lost scroll and sort, a typed capacity could lose focus, and a stepper detached while the phone test measured it.
2. An existing dialog test clicked "the first table on the page". While Priority wards was still loading, that could be a Stage 1-3
   table. The same test had flaked once on Stage 2's final run.

`36f3eeb` fixes both: the sections keep one stable, dimmed and interactive wrapper during recompute, and the test targets the Priority
wards table. A stress run of the affected tests (3 repeats, 4 workers) passed 60 of 60. CI on `36f3eeb`:
https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45948937692, all three jobs passed (frontend typecheck and build,
Python tests, 107 of 107 browser tests with no flaky retries).

## 14. Technical Q&A

1. **How does the intervention-response model work?** Crews raise a ward's treated share C(k) = 1 - (1 - a)^k. The effect reaches
   reported cases after a delay and build-up, T(h). The forecast is scaled by 1 - E x C(k) x T(h). Everything else (prevented cases,
   supplies, beds, transfers) follows from the scaled forecast through the Stage 1 and Stage 2 engines.
2. **What is measured and what is assumed?** Measured: past cases, weather and resource needs in the organizer data. Model outputs: the
   saved forecasts. Assumed: E, a, d, w and the sensitivity range. Scenario estimates: everything computed from those assumptions.
3. **Why does the effect change across 2-4 weeks?** The delay and build-up keep the effect partial early (T(2) = 0.5 by default), and
   the forecast itself changes week to week, so the same share prevents a different number of cases.
4. **How are diminishing returns represented?** Each extra crew treats a share a of what is still untreated, so each crew adds
   a(1 - a)^(k-1): 35%, 22.8% and 14.8% of a ward for the first three crews at a = 35%.
5. **Why is the crew algorithm appropriate?** The objective is a sum of concave functions of integer crews under one budget. Greedy by
   marginal value is exact for that structure, it is easy to explain ("each crew goes where it prevents the most"), and it runs in
   O(K log n).
6. **Is the ROI ranking optimal?** The deployment is optimal for the stated objective, as verified by brute force, dynamic programming
   and the certificate. The ROI table ranks the result; it is not itself the optimiser. Optimality holds only under the stated model;
   no real-world optimality is claimed.
7. **How do case reductions affect saline, kits and beds?** The forecast quantile at the planning horizon is scaled by the same
   reduction, then converted with the dataset's own rule, floor(m x cases + 0.5), with m = 2.384 (saline), 1.164 (kits) and 0.298
   (beds). Stock stays at the baseline figure.
8. **How does the simulator alter hospital overflow?** Scenario bed demand goes through Stage 2's routing with the same illustrative
   capacity. Lower demand can open spare beds and enable same-city transfers; unresolved shortage = max(0, demand - capacity) per city.
9. **Why doesn't the simulator establish causal efficacy?** The data have no intervention records, so there is no variation in
   treatment from which an effect could be estimated. Every effect here is an input, not an output.
10. **How does everything run offline?** Local forecasts and model, local rules, local optimiser and local overflow engine, with no
    network calls, as tested with sockets disabled.

## 15. Dependencies for Stage 4

1. The shared plan state and three endpoints (`/api/allocation/plan`, `/api/overflow/plan`, `/api/intervention/simulate`), all using
   `decision_forecast()` and refusing in-sample forecasts.
2. Scenario parameters are explicit and deterministic, so they can be saved, shared and replayed.
3. Any further offline work should keep the network-free test pattern and build on the Stage 0 note about `scripts/launch.sh`
   needing an offline path (`npm ci` needs the network).
4. Open owner decisions:
   - effect presets and ranges to present to judges
   - whether repeat deployments or waning should be modelled
   - whether the crew budget should be split by city
