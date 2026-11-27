# Phase 2 onsite, Stage 1: constrained resource allocation (Problem 1)

Stage 1 only. Hospital overflow (Problem 2) and vector-control simulation are not started. Every number below comes from
`GET /api/allocation/plan` on the local API (origin 2024-08-05, 3 weeks ahead, target week 2024-08-26, the 2024 peak) and is
checked by `tests/test_allocation.py` (61 tests) and `frontend/tests/e2e/allocation.spec.ts` (4 browser tests).

## What was built

| Part | File |
|---|---|
| Engine (demand, priority, allocation, crews, statuses) | `dengueshield/allocation.py` |
| Runtime resource rule, identified on 2016–2018 only | `app_data/resource_rules.json` (written by `notebooks/09_onsite_dataset_and_resource_audit.ipynb`) |
| API | `GET /api/allocation/plan` in `dengueshield/api/main.py` |
| UI | "Supply allocation" section on Response Intelligence (`frontend/components/supply-allocation.tsx`, `frontend/app/response/page.tsx`) |
| Tests | `tests/test_allocation.py`, `frontend/tests/e2e/allocation.spec.ts` |

Controls: regional stock 30–100% (step 5), total spraying crews 0–120 in the UI (API accepts up to 1,000), forecast horizon 2–4
weeks and forecast origin (existing page controls), city (all five or one), service level (median, upper end of the 80% range,
upper end of the 90% range), weight on outbreak risk versus density, fairness floor, cases per extra crew, most crews per ward.
Every change recomputes the plan (250 ms debounce, results cached per setting).

## 1. Objective

For each city c and resource r (saline bags, diagnostic kits, hospital beds), choose integer allocations x_i for the city's wards:

    maximise   sum_i w_i * x_i
    subject to f_i <= x_i <= d_i                     for every ward i in c
               sum_i x_i = min(S_cr, sum_i d_i)

w_i is the ward's priority (section 4), d_i its projected demand, S_cr the city's configured supply and f_i the fairness floor.

Why this objective: when stock is short, each extra unit should go where the planner's stated priority (outbreak risk and crowding)
is highest, while every ward keeps a guaranteed minimum share. The objective is linear, so its optimum is easy to verify and to
explain: "after the floor, wards are filled in priority order".

Tradeoffs, stated rather than hidden:

- Concentration. A linear objective fills the top wards completely before the next ward gets more than its floor. At 60% stock
  the 21 highest-priority wards are fully supplied and the other 39 hold roughly their floor. A proportional rule would spread the
  shortfall evenly instead; the fairness floor is the control between the two (floor 0 = pure priority, floor = stock level =
  proportional allocation).
- The floor buys fairness with priority-weighted coverage. At 30% stock with no floor, 44 wards get no saline at all; with the
  default 25% floor, none do.
- Optimal means optimal for this objective and these constraints only. The plan is not claimed to be the best public-health
  decision. The weights, the floor and the crew rule are policy choices, and the crew assignment is a stated rule with no optimality
  claim (section 2).

## 2. Constraints

| Constraint | How it is enforced | Test |
|---|---|---|
| Non-negative integers | demand is an integer rule; allocations are integer floors plus integer fills | LP test (40 seeds), stock-level tests |
| Exact conservation | sum of allocations = min(supply, demand) in every city and resource; nothing created, nothing lost | LP test, `test_stock_levels_conserve_supply_per_city` |
| No ward above its demand | x_i <= d_i | same |
| No stock or crew budget violation | per-city supply never exceeded; crews assigned <= crews available | same, crew test |
| Deterministic tie-breaking | equal priorities ordered by `ward_id`, independent of input order | `test_ties_are_broken_by_ward_id...`, determinism test |
| Explicit unmet demand | every ward and city reports `demand`, `allocated`, `unmet`; cities also `supply` and `surplus` | stock-level tests |
| Risk and density prioritisation | priority score (section 4) | two toy tests (risk only, density only) |
| Fairness against starvation | floor f_i = floor(phi * d_i) with phi = min(floor setting, S / total demand) | `test_low_risk_wards_are_not_starved_by_the_floor` |
| City isolation | each city is its own pool; no supply crosses cities | `test_city_pools_are_isolated` |
| Crews | one regional pool; assigned <= min(crews, total need); a ward never gets more than it needs | crew tests |

Crew rule (a stated rule, not an optimum): a ward's need is 0 with no forecast cases, otherwise
min(most per ward, 1 + floor(cases / cases per extra crew)). Crews go out in rounds: one crew to every ward that needs one, in
priority order, then second crews, then third. Coverage first was chosen so that a ward with any forecast cases is visited before any
ward gets a second team.

## 3. Formulas

- Forecast cases c_i: the champion forecast at the chosen service level (`median_cases`, `upper_80` or `upper_90`) for the target
  week origin + horizon. Observed target-week cases and the dataset's resource columns are never inputs.
- Demand: d_ir = floor(m_r * c_i + 1/2), with m_saline = 2.3843582887700534, m_kits = 1.1642156862745099,
  m_beds = 0.2984375, identified on 2016–2018 only (before every replay origin, 2019 onwards) and reproducing all 28,200
  development rows of 2016–2024 exactly.
- City supply: S_cr = floor(stock * sum of the city's d_ir). Stock is a configured assumption; the dataset holds no inventory.
- Floor: phi = min(floor setting, S_cr / sum d_ir), f_i = floor(phi * d_ir). Because sum f_i <= phi * sum d_ir <= S_cr, the floors
  always fit.
- Fill: remaining supply goes to wards in descending priority (ties by `ward_id`), each up to its demand.
- Optimality: with one budget row and box bounds this is a fractional knapsack with unit costs, so the greedy fill is an optimal LP
  solution, and it is integral because every bound and the budget are integers. Verified against scipy's HiGHS LP solver
  (40 random instances, ties included) and brute-force enumeration (60 small instances).

## 4. Priority score

    w_i = alpha * P(outbreak)_i + (1 - alpha) * density_i / 74,252

P(outbreak) is the champion model's outbreak probability for the ward and target week. density_i is the dataset's
`population_density_sqkm`; 74,252 is the largest of the 60 wards, so both terms lie in [0, 1]. alpha (weight on outbreak risk)
defaults to 0.7. No population, hospital capacity or stock figure is invented.

Top five wards at the peak by alpha: 0 (density only) DSCC_Ward_04, DNCC_Ward_12, GCC_Ward_01, NCC_Ward_01, DNCC_Ward_05;
0.7 (default) DSCC_Ward_04, CCC_Ward_03, DNCC_Ward_12, CCC_Ward_01, DNCC_Ward_19; 1 (risk only) DSCC_Ward_04, CCC_Ward_03,
CCC_Ward_01, DNCC_Ward_19, DNCC_Ward_12.

## 5. Allocation example: Narayanganj saline, 60% stock, upper 80%, floor 25%

Demand 145 bags, supply floor(0.6 * 145) = 87. phi = min(0.25, 87/145) = 0.25.

| Rank | Ward | Tier | P(outbreak) | Density | Priority | Cases | Demand | Floor | Allocated | Unmet | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | NCC_Ward_05 | High | 0.683 | 40,043 | 0.640 | 16 | 38 | 9 | 38 | 0 | met |
| 2 | NCC_Ward_01 | High | 0.438 | 65,612 | 0.571 | 13 | 31 | 7 | 31 | 0 | met |
| 3 | NCC_Ward_04 | High | 0.143 | 54,774 | 0.321 | 10 | 24 | 6 | 6 | 18 | critical |
| 4 | NCC_Ward_02 | High | 0.193 | 20,324 | 0.217 | 11 | 26 | 6 | 6 | 20 | critical |
| 5 | NCC_Ward_03 | High | 0.187 | 18,945 | 0.207 | 11 | 26 | 6 | 6 | 20 | critical |

Floors use 34 bags; the remaining 53 fill NCC_Ward_05 (+29) and NCC_Ward_01 (+24). Total 87 = supply.

## 6. Scarcity comparison (all 60 wards, upper 80%, floor 25%, alpha 0.7)

| Stock | Saline allocated / needed (short) | Kits | Beds | Wards fully supplied | Critical |
|---|---|---|---|---|---|
| 30% | 528 / 1,767 (1,239) | 256 / 864 (608) | 65 / 224 (159) | 2 | 58 |
| 50% | 882 / 1,767 (885) | 431 / 864 (433) | 112 / 224 (112) | 14 | 46 |
| 60% | 1,059 / 1,767 (708) | 516 / 864 (348) | 132 / 224 (92) | 21 | 39 |
| 75% | 1,322 / 1,767 (445) | 646 / 864 (218) | 166 / 224 (58) | 33 | 27 |
| 100% | 1,767 / 1,767 (0) | 864 / 864 (0) | 224 / 224 (0) | 60 | 0 |

Service level at 60% stock: median needs 1,197 / 582 / 149 (saline / kits / beds) and 77 crews; upper 80% needs 1,767 / 864 / 224
and 110 crews; upper 90% needs 1,978 / 965 / 243 and 122 crews. Crews at the peak (110 needed): 20 crews reach the 20 top wards;
60 crews give every ward one crew; 110 meet all need; 200 leave 90 unassigned.

## 7. Deficit calculation

- Ward: unmet_ir = d_ir - x_ir for each resource; fill rate = the lowest allocated/demand ratio over the three resources (1 when
  demand is 0).
- Status: met (no resource short); critical (a shortfall and either fill rate below 0.5 or tier High/Critical); deficit (any other
  shortfall).
- City and region: demand, supply, allocated, unmet and surplus per resource; crews needed, assigned, unassigned and unmet need;
  counts of met, deficit and critical wards. The UI lists the critical wards in priority order.
- Consequence of the linear objective: with the default 25% floor, a ward that is not fully supplied usually holds only its floor,
  so its fill rate is below 0.5 and it shows as critical. The plain deficit status then appears only for a ward that receives the
  last partial fill with a fill rate of at least 0.5 and a Low or Moderate tier (at the 2024 peak, none). Raising the floor to 50%
  moves Low and Moderate wards from critical to deficit.

## 8. Complexity

Per city and resource: one sort of n wards, O(n log n), then a linear fill. All pools: O(R * N log N) with R = 3 and N = 60. Crews:
O(K * N) with K = most crews per ward (at most 10). The forecast for an origin and horizon is computed once and cached; a full plan
then takes a few milliseconds, so every slider change recomputes immediately.

## 9. Tests

`tests/test_allocation.py` (61 tests): demand rule against the dataset rule and all development rows; LP optimality, integrality,
conservation and floor on 40 seeded instances against scipy HiGHS; brute force on 60 small instances; stable ties independent of
input order; input validation; risk and density prioritisation; zero demand; crew conservation and coverage-first; stock 30, 50, 75
and 100% with all 60 wards and per-city conservation; monotone scarcity and ordered service levels; city isolation; determinism;
ranking and critical flags; non-starvation; extreme inputs (422) and unknown city (404); a 2025 origin refused (422), the forward
forecast from 2024-12-30 served from the bundle with no observed values in the response, and a source scan showing the engine never
reads the panel or the onsite CSV; offline execution with sockets disabled.

`frontend/tests/e2e/allocation.spec.ts` (4 tests): demand, supply and shortfall shown, critical alert, recompute at 100% stock; city
filter; a 2025 origin is refused in the UI and no request is sent, with a one-click switch to 2024-12-30; no sideways scroll at
390 px.

Results on this branch: pytest 418 passed; Playwright 93 passed with no retries, built and served the way CI does (demo Firebase
project, placeholder map key), including the axe accessibility checks on the Response page.

## 10–12. Commits, push, CI

Commits on `version-onsite-final` start with `version-onsite-final:`. The engine, API and tests were committed first, then the UI,
browser tests and this document. The branch is pushed to the official repository only (not to `main`, which deploys production);
CI is dispatched on the branch. Hashes and the CI run are reported in the Stage 1 handoff message.

## 13. Remaining issues

- Bundle forecasts on historical origins are in-sample (the bundle was trained on 2016–2024). Resolved in Stage 2: both decision
  endpoints now refuse in-sample forecasts, and every page with the source control labels them (see STAGE2_HANDOFF.md, section 9).
- The plan inherits the forecast's error, largest at outbreak peaks, where Phase 1 documented under-prediction. Upper 80% and 90%
  service levels are the hedge.
- Weights, floor, crew rule and stock levels are policy assumptions, not measured; the defaults (alpha 0.7, floor 25%, 10 cases per
  extra crew, at most 3 crews per ward) need sign-off by the team.
- Crew assignment uses a stated rule, not an optimiser, and crews have no travel or capacity model (the 60 ward IDs are synthetic,
  without geometry).
- Resource rules for counts above 41 cases are extrapolated by the same rule (Stage 0, section C).

## 14. Dependencies for Problem 2 (hospital overflow)

1. Projected bed requirement: `hospital_beds_required.demand` per ward from this endpoint (same origin, horizon and service level).
2. Configured regional availability: `hospital_beds_required.supply` per city and `allocated` per ward are a supply scenario from the
   stock slider, not hospital capacity.
3. Illustrative local capacity (owner decision 4): a per-ward default from the ward's own weekly bed demand history, for example the
   90th percentile, computed only from weeks before the forecast origin (never later seasons), labelled as an editable scenario
   assumption, not measured capacity.
4. No double counting: Problem 2 compares the projected bed requirement with illustrative local capacity. It must not add Problem 1's
   allocated beds on top of local capacity, because both describe the same beds; Problem 1's bed allocation stays a regional supply
   view. The API's assumptions list states this.
5. Owner decisions still open: the default capacity rule (p90 proposed) and whether transfers stay inside the city pool (as here).
