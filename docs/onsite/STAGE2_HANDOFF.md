# Phase 2 onsite, Stage 2: hospital surge and cross-ward overflow (Problem 2)

Stage 2 only; the vector-control simulator (Stage 3) is not started. Every number below comes from `GET /api/overflow/plan` on the local
API and is checked by `tests/test_overflow.py` (173 tests) and `frontend/tests/e2e/hospital.spec.ts` (6 browser tests). Unless stated,
the forecast is issued 2024-08-05, 3 weeks ahead (target week 2024-08-26, the 2024 peak), planned at the upper end of the 80% range.

## What was built

| Part | File |
|---|---|
| Overflow engine (capacity baseline, scaling, routing, city metrics) | `dengueshield/overflow.py` |
| API, plus the origin-safe forecast guard shared with Stage 1 | `GET /api/overflow/plan`, `decision_forecast()` in `dengueshield/api/main.py` |
| UI | "Hospital surge and overflow" on Response Intelligence (`frontend/components/hospital-surge.tsx`) |
| Shared plan state (city, service level, stock) | `frontend/app/response/page.tsx`, `frontend/components/supply-allocation.tsx` |
| Forecast provenance label on every page with the source control | `frontend/lib/provenance.ts`, `frontend/components/controls.tsx` |
| Tests | `tests/test_overflow.py`, `frontend/tests/e2e/hospital.spec.ts` |

## 1. Mathematical objective

For each city separately, with projected bed demand d_i and configured capacity c_i for each ward:

    deficit  u_i = max(0, d_i - c_i)        headroom  v_j = max(0, c_j - d_j)

A ward is a sender (u > 0), a receiver (v > 0) or neither, never both. Network: source -> sender i (capacity u_i); sender i -> receiver j
(uncapacitated); receiver j -> sink (capacity v_j). Every sender-receiver pair in a city is admissible and none is cheaper, because the
60 ward IDs are synthetic and have no locations, distances or travel times; none were invented.

Lexicographic objective:

1. Maximise transferred patients T = sum f_ij (maximum flow). T* = min(U, V), U = sum u_i, V = sum v_j: the cut around the source has
   capacity U, the cut around the sink V, and any other cut crosses an uncapacitated arc.
2. Among maximum flows, minimise sum_i r_i^2 + sum_j e_j^2, where r_i = u_i - out_i is the ward's unresolved overflow and e_j = v_j - in_j
   its remaining headroom. In words: relieve the most overloaded ward first, and draw on the ward with the most spare beds first.

Why: with no distances, the only defensible differences between plans are how many patients get a bed (step 1) and how the remaining
burden is spread (step 2). Squared terms spread it: no ward keeps a large unresolved overflow while another is relieved completely, and
no ward is filled to the last bed while another stays empty.

Ties (common, since ward deficits are a few beds) do not change the objective. They are broken by forecast risk: among equally overloaded
wards the one with the higher outbreak probability is relieved first; among equally spare wards the one with the lower outbreak
probability receives first, so high-risk wards keep their spare beds. Remaining ties go by ward ID.

City identity: unresolved shortage = U - T* = max(0, D - C), with D = sum d_i and C = sum c_i, because U - V = D - C. City bed use after
transfers = min(D, C) / C.

## 2. Capacity assumptions

The dataset has weekly bed requirements but no hospital capacity. Capacity is therefore a configurable planning scenario, labelled
"Illustrative capacity" in the UI, the API and exports. It is never described as a hospital inventory.

- Default (owner decision): the 90th percentile of the ward's weekly `hospital_beds_required` over the weeks strictly before the forecast
  origin. Start-of-week convention: a forecast issued on the Monday of week t uses data through week t-1, so week t and later never
  enter.
- Rule: sort the n past weekly values and take the k-th smallest, k = ceil(9n/10), computed as (9n + 9) // 10 in integers (inverted
  empirical CDF). The result is an observed integer, so no interpolation or rounding is involved.
- Source: the onsite file's own `hospital_beds_required` column through `load_onsite_development_panel()`, which drops 2025 rows as
  bytes before parsing.
- Scenario controls:
  - Capacity percentage p, 0-300% in whole percent, for all cities or per city (`city_pct=City:p`). Scaling is c = floor(b x p / 100 + 1/2),
    computed as (2bp + 100) // 200 in integers (round half up).
  - A typed per-ward value (`override=WARD:n`, 0-500) replaces the scaled figure.
- Baseline at several origins (all 60 wards, sum of capacity): 165 beds on 2019-01-07 (157 weeks of history), 168 on 2020-06-01 (230),
  170 on 2022-09-05 (348), 171 on 2024-08-05 (448), 171 on 2024-12-30 (469).

## 3. Flow constraints (all tested)

| Constraint | How |
|---|---|
| No inter-city transfers | one network per city; no arc joins two cities |
| Whole, non-negative patients | integer capacities; greedy unit steps |
| Sender sends at most its deficit | out_i <= u_i |
| Receiver gets at most its spare beds | in_j <= v_j |
| No duplicated patients | a ward is sender or receiver, never both; each unit leaves one sender once |
| Exact flow conservation | sum of a sender's links = out_i; sum of a receiver's links = in_j; total sent = total received |
| Deterministic | tie order (risk, then ward ID); result independent of row order |
| Unresolved overflow reported | per ward, city and region; alert in the UI |
| Correct city bed use | min(D, C) / C after transfers; "no beds" when C = 0 |

## 4. Algorithm and complexity

1. U, V and T* = min(U, V).
2. Send amounts: take T* units one at a time from the sender with the largest remaining deficit (heap, tie order above).
3. Receive amounts: place T* units one at a time into the receiver with the largest remaining headroom.
4. Pairing: north-west-corner rule over senders and receivers sorted by volume, then tie order. This routes the same totals over at most
   m + n - 1 sender-receiver links (m senders, n receivers).

Steps 2 and 3 are exact for the objective. With uncapacitated middle arcs, any send vector 0 <= out <= u and receive vector
0 <= in <= v with equal totals can be routed. Step 2 of the objective therefore splits into two separable convex integer problems under
one sum constraint, where unit-by-unit greedy is optimal (marginal gain 2r - 1 falls as r falls).

Cost per city: O(T* log n) for the two water-fills plus O(n log n) sorting, with T* bounded by a few dozen beds. Capacity baseline:
O(W x h log h) per origin for W = 60 wards and h weekly values each, computed once per origin and cached. A full plan takes a few
milliseconds.

## 5. Worked example: Chattogram at 120% capacity

| Ward | Risk | P(outbreak) | Bed demand | Baseline | Capacity (120%) | Over | Spare | Sent | Received | No bed |
|---|---|---|---|---|---|---|---|---|---|---|
| CCC_Ward_03 | Critical | 0.877 | 6 | 4 | 5 | 1 | 0 | 1 | 0 | 0 |
| CCC_Ward_10 | High | 0.143 | 3 | 2 | 2 | 1 | 0 | 1 | 0 | 0 |
| CCC_Ward_02 | High | 0.077 | 3 | 2 | 2 | 1 | 0 | 0 | 0 | 1 |
| CCC_Ward_05 | High | 0.065 | 3 | 2 | 2 | 1 | 0 | 0 | 0 | 1 |
| CCC_Ward_09 | Medium | 0.054 | 3 | 2 | 2 | 1 | 0 | 0 | 0 | 1 |
| CCC_Ward_06 | High | 0.246 | 3 | 3 | 4 | 0 | 1 | 0 | 1 | 0 |
| CCC_Ward_07 | High | 0.453 | 4 | 4 | 5 | 0 | 1 | 0 | 1 | 0 |
| CCC_Ward_01, 04, 08 | | | 5, 4, 4 | 4, 3, 3 | 5, 4, 4 | 0 | 0 | 0 | 0 | 0 |

How the plan is built:

- Capacity: floor(2 x 1.2 + 0.5) = 2, floor(4 x 1.2 + 0.5) = 5, floor(3 x 1.2 + 0.5) = 4.
- U = 5 over-capacity patients and V = 2 spare beds, so T* = 2.
- All five deficits are 1, so ties decide. The two highest-risk senders are relieved: CCC_Ward_03 (0.877) and CCC_Ward_10 (0.143).
- Pairing: CCC_Ward_03 -> CCC_Ward_06 and CCC_Ward_10 -> CCC_Ward_07, one patient each.
- Unresolved: 3 = max(0, 38 - 35).
- City bed use goes from 33/35 to 35/35.

## 6. City-wide utilization (all cities)

| Capacity | Demand / capacity | Transferred | No bed in own city | Bed use before -> after |
|---|---|---|---|---|
| 100% (baseline) | 224 / 171 | 0 | 53 | 100% -> 100% |
| 120% | 224 / 208 | 9 | 16 | 95.7% -> 100% |
| 130% | 224 / 230 | 3 | 0 | 96.1% -> 97.4% |
| 150% | 224 / 268 | 0 | 0 | 83.6% -> 83.6% |

Per city at 120%:

| City | Demand / capacity | Transferred | No bed |
|---|---|---|---|
| Chattogram | 38 / 35 | 2 | 3 |
| Dhaka North | 72 / 67 | 3 | 5 |
| Dhaka South | 74 / 69 | 4 | 5 |
| Gazipur | 22 / 22 | 0 | 0 |
| Narayanganj | 18 / 15 | 0 | 3 |

Service level at 120%:

| Service level | Bed demand | Transferred | No bed |
|---|---|---|---|
| Median | 149 | 0 | 0 (nothing over capacity) |
| Upper 80% | 224 | 9 | 16 |
| Upper 90% | 243 | 1 | 35 |

## 7. Unresolved shortages

At the baseline capacity the 2024 peak is a city-wide surge: every ward is over its own 90th percentile at once. No ward has a spare bed,
so cross-ward routing cannot help, and 53 patients (Chattogram 9, Dhaka North 17, Dhaka South 17, Gazipur 5, Narayanganj 5) have no bed
in their own city. The UI says so and points to a capacity scenario.

This is a property of the data: in this synthetic dataset the wards of a city rise and fall together, so routing within a city helps
mainly when capacity is close to demand (the 120% and 130% scenarios). The binding constraint at a peak is city capacity, which the
identity unresolved = max(0, D - C) makes exact.

Across 2024 origins at baseline capacity, overflow appears only in the epidemic weeks (June to early September at the upper 80%). It is
always city-wide except at the turning points, where a single transfer occurs (2024-06-10 and 2024-06-24 at the upper 80%, 2024-09-02 at the median).

## 8. Integration with Stage 1

- Projected bed demand is Stage 1's `hospital_beds_required.demand`, computed by the same function from the same forecast. A test checks
  equality ward by ward at all three service levels.
- City, service level and stock are one shared state on the Response page, so both sections always plan on the same demand.
- Six quantities are kept apart in the API (`scenarios`) and the UI ("Six bed numbers, kept apart"):
  - projected bed demand
  - illustrative ward capacity
  - transferable headroom
  - allocated transfers
  - unresolved shortage
  - regional bed supply scenario
- The regional bed supply (Stage 1 stock x demand) is reported per city and never added to ward capacity. Both describe the same beds:
  Stage 1 answers "how much bed stock can the region field", Stage 2 "where do patients fit". Adding them would count beds twice. A test
  checks that capacity does not change with stock.

## 9. Scientific correction: forecast-source audit

Findings:

- The deployed bundle is trained on 2016-2024 (cutoff 2024-12-31). The API already flagged its output as `in_sample` for targets up to
  that date. Only the Command page showed it, though, and `source=bundle` at any 2019-2024 origin was served without comment elsewhere.
- Origins before the replay (before 2019) silently used the in-sample bundle under the default source.
- The replay has no forecasts whose target falls in the next season (for example 2023-12-18 at h=3), since each season was replayed by
  models fitted on earlier seasons. The error message then advised `source=bundle`, which is in-sample there.

Corrections:

- Both decision endpoints (`/api/allocation/plan`, `/api/overflow/plan`) go through `decision_forecast()`, which refuses any in-sample
  forecast (422, with the reason and the valid origins). Historical plans therefore use the validated replay only; the bundle is used
  only for January 2025 targets from December 2024 origins.
- The replay-gap error now explains the gap and states that the bundle would be in-sample.
- On every page with the source control, the controls bar shows a red label for in-sample and replay-gap selections, with a one-click
  fix (switch to the replay, or move to the last valid origin). The decision sections show the same reason instead of a plan.
- Display endpoints still serve in-sample bundle output (useful to compare models), now visibly labelled.
- Sealed 2025 outcomes are never read: history comes from the byte-filtered loader, and responses carry no observed values (tested).

## 10. Tests and solver verification

`tests/test_overflow.py` (173 tests; synthetic ward graphs are marked as test fixtures):

- 150 random cities against every invariant, plus an independent Edmonds-Karp max-flow written in the test file.
- 120 small cities against brute-force enumeration of all integer transfer matrices: same maximum and same optimal cost, with random
  risk tie-breaks.
- Scenario cases:
  - zero beds available
  - excess demand (partial relief, rest reported)
  - excess headroom (emptiest ward drawn first)
  - fully satisfied overflow
  - impossible transfers (single ward; every ward over capacity)
  - tie order by risk and by ward ID, independent of input order
  - city isolation (100 spare beds in another city stay unreachable)
- Capacity: the order statistic and round-half-up scaling. At five origins (2019-01-07 to 2024-12-30) it matches numpy's inverted-CDF
  quantile on past weeks only, and setting the origin week and all later weeks to 999 changes nothing.
- API:
  - the peak surge, and the 120% scenario with same-city transfers only
  - the city-filter result equals the full plan
  - overrides and city percentages
  - bed demand and regional supply shared with Stage 1
  - determinism
  - 13 invalid inputs (422) and an unknown city (404)
  - in-sample, pre-replay and replay-gap forecasts refused by both decision endpoints, with the January 2025 forward plan accepted
  - no observed values in responses
  - offline run with sockets disabled

`frontend/tests/e2e/hospital.spec.ts` (6 tests):

- city-wide surge alert, then same-city transfers at +20%
- typed capacity recompute and clear
- service level shared with Supply allocation
- in-sample label, refusal and one-click fix, with no in-sample request sent
- no sideways scroll at 360 and 390 px

Full results on this branch: pytest 591 passed; Playwright 99 passed with no retries, built and served as in CI (demo Firebase project,
placeholder map key), including the axe accessibility checks on the Response page.

## 11. Offline behaviour

The engine, the capacity baseline and the API use only local files: the bundle, the replay, the onsite CSV and the resource rules. A test
runs the endpoint with sockets disabled. If the onsite file is missing, the endpoint answers 503 with the fix (`scripts/fetch_data.py`)
instead of guessing capacity. The UI is part of the static export served by the same API.

## 12. Limitations

- Capacity is illustrative. The p90 rule describes past demand, not beds; real capacity can be typed per ward.
- There is no geography. Transfers between synthetic wards have no distance or travel time, so the plan says how many patients move
  between which wards, not how or how far.
- The data are synchronised within cities, so cross-ward routing has little effect at baseline capacity.
- The squared spread objective and the risk tie-break are choices. Alternatives (relative overload, keeping buffers in high-risk wards by
  their upper-90 demand) are easy to swap in and are not claimed to be better.
- Forecast error carries into the plan: largest at peaks, with under-prediction documented in Phase 1. Upper 80% and 90% are the hedge.
- Bed demand counts are small integers (0.298 beds per forecast case), so rounding matters more than for saline or kits.

## 13. Git and CI

| Commit | Content |
|---|---|
| `2670da6` | version-onsite-final: implement hospital overflow engine and invariants |
| `e412951` | version-onsite-final: integrate hospital surge dashboard and tests |
| this document | version-onsite-final: document capacity assumptions and flow optimization |

All are on `version-onsite-final` in the official repository; nothing was merged into `main` or deployed. CI on the code commit `e412951`:
https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON/actions/runs/45943040291, all three jobs passed (frontend typecheck and build,
Python tests, Playwright browser tests).

## 14. Dependencies for Stage 3 (vector-control simulator)

1. The origin-safe forecast path `decision_forecast()`: replay for 2019-2024 targets, bundle only past its training window.
2. Ward demand functions: Stage 1 resource demand and crews; Stage 2 bed demand and capacity.
3. A scenario effect on forecast cases (for example a reduction from larvicide or fogging) can flow through both engines unchanged:
   change the cases, recompute demand, allocation and overflow. The effect size must be a labelled assumption, since no measured
   efficacy is in the data.
4. Stage 1 crews are the intervention budget a simulator would spend.
5. Owner decisions still open: intervention effect sizes and their ranges, how long an effect lasts, and whether crews limit coverage.

## 15. Technical Q&A talking points

- **Why max-flow and not min-cost flow with distances?** There are no distances for the synthetic ward IDs, so every in-city pair costs
  the same. Max-flow decides how many patients are placed; a convex spread cost decides how the rest is shared.
- **Is it optimal?** For the stated objective, yes. The flow value is min(U, V) by the cut argument; the spread is optimal by separable
  convexity; brute force and an independent max-flow confirm both on small graphs. Nothing is claimed beyond that objective.
- **Why do no transfers happen at the peak?** Every ward is over capacity at once, so there are no spare beds. Routing cannot create
  beds: unresolved = max(0, D - C).
- **Can later data leak into capacity?** No. Only weeks strictly before the origin are used, and a test sets the origin week and all
  later weeks to 999 at five origins with no change.
- **Why not add Stage 1's beds to capacity?** They are the same beds in two scenarios; adding them would double count.
- **Why refuse the bundle for 2024 plans?** It was trained on those weeks, so its forecasts there would look better than any real
  forecast could. Historical plans use the replay, where each season was forecast by models fitted on earlier seasons only.
- **How are ties broken?** Higher outbreak probability is relieved first; lower outbreak probability receives first; then ward ID. The
  result does not depend on row order.
