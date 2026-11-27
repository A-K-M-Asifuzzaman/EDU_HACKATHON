# Hospital preparedness and emergency surge engine

Code: `dengueshield/preparedness.py` (engine), `dengueshield/api/main.py` (`/api/preparedness/*`),
`frontend/components/hospital-preparedness.tsx` (Response page, section `#prepare`). Fixture: `app_data/preparedness/planning_hospitals.json`.

## Mentor questions and where the answer is

| Mentor question | Answer on screen | Computed by |
|---|---|---|
| If an outbreak occurs, what should hospitals do? | Preparation plan (ordered actions with quantity, timing, reason, trigger) | `actions()` |
| How many beds will be required? | "What shortage?" tile, bed boards, timeline (`peak_needed`) | daily occupancy with every arrival admitted |
| How many beds does each hospital have? | Bed boards (one cell per bed) | fixture `functional_beds` (fictional) |
| How many are occupied, how many by non-dengue patients? | Bed boards, "What shortage?" sub-line (`other_now`, `dengue_now`) | fixture × scenario scales |
| How many are available for dengue? | Bed boards (dark cells = free below the reserve), `free_now`, `routine_limit` | capacity − occupied − reserve |
| How many additional beds to prepare? | "Extra beds" tile, plan item 1 | `max(peak_needed − routine_limit, 0)` per hospital |
| How much saline? | "Supplies to order" tile, inventory panel | organizer multiplier × cases; procurement formula below |
| What if saline, kits or beds run short? | Alerts (Critical / Emergency Surge), unmet demand, patients without a bed, response state | inventory and occupancy accounting |
| How do thresholds change with the situation? | Status pills per hospital; rules below | `alerts()` |
| Sudden outbreak? | Outbreak shock (+25 … +200%), crisis laboratory (baseline / crisis / response) | `plan_state()` × 3 |
| Nearest hospital full? Alternatives? Other districts? | Referral network (planning hospitals) and "Real hospitals" tiers (OSM, by road) | `referral_lp()`, `/api/preparedness/referrals` |
| Ambulance numbers? | 999 (includes ambulance), 16263, facility phones from OSM where tagged | `EMERGENCY`, `/api/preparedness/contacts` |
| Offline? | All of the above run on local data; kill-switch parity includes six preparedness calls | `scripts/offline_verify.py` |

## Model (deterministic, integer, daily for 28 days)

Weekly city cases for weeks 2-4 come from the origin-safe forecast at the chosen service level. The model has no 1-week horizon, so
week 1 = (observed cases in the origin week + forecast week 2) / 2, labelled scenario-derived.

For each planning hospital *i* with catchment share *s_i*, shock *k* and assumed prevented share *p_w* (Stage 3, optional):

- dengue admissions demand, week *w*: `A_w = round(cases_w · k · (1 − p_w) · s_i · a)`, where *a* is the admission rate per case
  (default the organizer's bed multiplier 0.2984); spread over the 7 days exactly (largest remainder).
- other-illness arrivals: steady inflow `round(7 · other_now / LOS_other)` per week.
- existing patients leave evenly over their stay; each new patient stays exactly its LOS (dengue 5 d, other 6 d by default).
- daily order: discharges, then other-illness admissions, then dengue, while `census < capacity − reserve`.
  `capacity = functional − closed + surge opened`, `reserve = ceil(functional · reserve%)`.
- identities checked on every row: `census_d = census_{d−1} + admitted_d − discharged_d`; `arrivals_d = admitted_d + unresolved_d`;
  admitted patients never push the census above the open beds. Patients who cannot be admitted are counted as unresolved, never as
  occupying a bed; demand is never silently capped.
- `peak_needed` comes from a second run that admits everyone (the beds the demand would need). Reserve breach = first day
  `needed > capacity − reserve`; bed shortage = first day `needed > capacity`; reported as a forecast week, not a false exact date.

Inventory per resource (saline bags, diagnostic kits): daily demand = organizer multiplier × the hospital's share of all cases.

- `closing = opening + received − fulfilled`, `fulfilled = min(demand, opening + received)`, `unmet = demand − fulfilled` (kept apart);
  stock is never negative; a delivery counts only from its arrival day.
- dynamic reorder point `ROP = lead_time · mean daily demand + safety stock`.
- procurement needed so stock never falls below the safety stock: `max_d(cum_demand_d + reserve − stock_0 − cum_receipts_d)`.
- latest order day = first safety-stock breach − lead time (0 or less = already late).

## Crisis laboratory

- **Baseline**: forecast, fixture settings (and the same assumed crew effect if crews are set).
- **Crisis**: the user's scenario (shock, other-illness load, closures, stock, lead time, LOS, reserve, admission rate).
- **Optimized response**: crisis + configured surge beds opened + orders for the computed procurement placed today (arriving after
  the lead time, so earlier stockouts stay visible) + referrals inside the planning network.

Referral plan at the network's worst day: senders = beds needed above their routine limit, receivers = free beds below their own
reserve, edges = same city or any city → Regional Referral Simulation Center. Stage 1 LP maximises patients placed (bipartite
transport polytope, integral optimum); stage 2, at that total, prefers same-city receivers. An independent `scipy` max-flow must give
the same total (`certificate`). The remaining gap is reported as "still without a bed". This is separate from the official
ward-level overflow engine (`/api/overflow/plan`), which is unchanged and keeps its same-city rule.

## 28-day referral program (primary) and peak-day plan (fallback)

`referral_time_expanded()` plans referrals day by day over the 28 days as an integer program (HiGHS via `scipy.optimize.milp`):

- variables per hospital *i* and day *d*: own admissions `a`, unresolved `u`, and referrals `r` on allowed links (same city, or any
  city to the Regional Referral Simulation Center);
- `arrivals_{i,d} = a_{i,d} + Σ_j r_{i→j,d} + u_{i,d}` (no patient counted twice, none hidden);
- for every hospital *j* and day *t*: `fixed_{j,t} + Σ_{d=t−LOS+1..t} (a_{j,d} + Σ_i r_{i→j,d}) ≤ routine limit_j`, where `fixed` is the
  census without any new dengue admission (other-illness patients keep their beds; existing dengue patients leave on schedule) and a
  referred patient occupies the receiver for its whole stay;
- stage 1 minimizes Σu; stage 2, at that minimum, minimizes referrals (same city cost 1, regional centre 3);
- verified by re-simulating the chosen plan day by day (split identity, beds within limits, allowed links only, objective equals the
  re-simulated count). The like-for-like baseline is the same program with no referral links.

If the solver fails or a check fails, the page shows the peak-day plan (LP + independent max-flow), which is always computed.

## Emergency redistribution of saline and kits

On day 1, a hospital can give only `min_d(closing_d) − safety stock` of its own projection (so it stays above its safety stock on every
day); units arrive after a 1-day transfer and help only unmet days on or after arrival. Transport LP (integral), same-city links or the
regional centre as donor; then re-simulated for donors and receivers. Four policies are compared: no action, procurement only,
redistribution only, redistribution + procurement (orders sized after redistribution, arriving after the lead time).

## Alert rules (planning rules, not clinical triage or official warning levels)

| Rule | Severity | Condition |
|---|---|---|
| `beds_physical` | Critical | patients needing a bed exceed open beds within 4 weeks |
| `beds_physical` | Emergency Surge | … and exceed functional − closed + every configured surge bed |
| `beds_reserve` | Warning | patients needing a bed reach the protected reserve |
| `saline_stockout`, `kits_stockout` | Critical | demand exceeds stock + confirmed deliveries |
| `saline_reserve`, `kits_reserve` | Warning | stock falls below safety stock (no stockout) |
| `saline_reorder`, `kits_reorder` | Watch | opening stock at or below the dynamic reorder point |

A hospital's status is its most severe alert; the network status is the most severe hospital. Each alert carries its condition,
value, threshold, day, week, explanation, action, source and assumption status. The response state also reports
`status_after_response` (Emergency Surge if a bed gap remains, Critical if supplies stay unmet, Warning if it relies on referrals).
Warnings come before shortages because the reserve and safety-stock rules trigger earlier. Alerts are a pure function of the
scenario and the page debounces control changes, so a status cannot flicker between two values for one scenario; no shortage is
ever suppressed.

"Unknown" is used for real facilities: their capacity and availability are not in any bundled data and are shown as
"Actual hospital capacity unavailable." and "Bed availability unconfirmed — contact hospital."

## Data and provenance

| Data | Category | Note |
|---|---|---|
| Weekly cases (weeks 2-4) | organizer_synthetic + model_estimate | origin-safe forecast of the SYNTHETIC dataset; 2025 sealed; city totals sum ward-level upper bounds, which is not a calibrated joint city bound |
| Week 1 cases | model_estimate (scenario-derived) | interpolation; not a model horizon |
| Resource multipliers | organizer_synthetic | `app_data/resource_rules.json` |
| Planning hospitals, beds, occupancy, stock, deliveries, lead times | synthetic_demo | fictional; sized from each city's observed week-0 cases (260 beds for Dhaka North) |
| LOS, admission rate, reserve, shock, closures | planning_assumption | user-set; defaults above |
| 914 facilities, roads, 59 phone tags | verified_public (OpenStreetMap, community-mapped) | identity and location only |
| 999, 16263 | verified_public | rechecked 27 Nov 2026 (national press, ITU WSIS record, DGHS/WHO material); 16263 continuity questioned in the press |
| Outbreak signal | historical replay | EWMA and CUSUM on the organizer's series up to the origin; never live |

Real hospital coverage: 914 OSM facilities (631 hospitals, 283 clinics) in Dhaka (715), Chattogram (162), Gazipur (32) and
Narayanganj (5); road graphs for Greater Dhaka and Chattogram only. 59 facilities carry a phone tag, none a beds tag, none an
emergency tag. No district outside these four is covered; no hospital-owned ambulance number is bundled.

## Mentor demonstration (one click)

Response page, `#prepare`, **Mentor demonstration**: Dhaka North, forecast issued 5 Aug 2024 (upper 80%), shock +100%, other illnesses
+5%, saline and kits at 60%, lead time 10 days, 20 crews (Stage 3 simulated effect: 5.5%, 11.0%, 11.0% fewer cases in weeks 2-4).
Engine output on the final build (scenario `P-832984af0b34`):

| | Baseline | Crisis | Response |
|---|---:|---:|---:|
| Status | Critical | Emergency Surge | Critical after response |
| Peak patients needing a bed / open beds | 233 / 260 | 299 / 260 | 299 / 296 |
| Other-illness / dengue patients now | 171 / 33 | 179 / 33 | 179 / 33 |
| Extra beds to keep the reserve | 8 | 66 | 31 |
| Reserve reached / beds run out | week 1 / week 4 | week 1 / week 1 | week 1 / week 3 |
| Saline to procure (to keep safety stock) | 89 | 2,669 | 176 more after orders |
| First saline stockout | day 27 | day 8 | day 9 |
| Patients without a bed over 28 days (28-day program) | | | 60 without referrals → 0 with 60 referrals |
| Saline unmet: no action / procurement only / redistribution / both | | | 2,511 / 116 / 1,991 / 58 |
| Kits unmet: no action / procurement only / redistribution / both | | | 1,227 / 58 / 1,007 / 29 |

Response actions: open 66 surge beds, 60 referrals over the four weeks, move 520 saline bags and 220 kits from the regional centre on
day 1, order 2,149 saline bags and 1,083 kits (2,149 + 520 = 2,669), expect 58 bags and 29 kits short until orders land.

## Tests

`tests/test_preparedness.py` (22, including the 28-day program, redistribution, scenario-id coverage and the brief): flow and split identities across scenarios, no double counting of existing patients, beds never
above capacity and reserve protected, zero capacity, surge and closures, inventory conservation with zero stock and a delayed
delivery, reorder point and procurement, alert rules Normal→Emergency, LP vs max-flow with receiver limits and city rules,
fixture labelling, historical signal label, API determinism, forecast unchanged by bed settings, sealed-year refusal, brief
consistency and safety, referral cards (unknown capacity, phones only from OSM), contact directory.
`frontend/tests/e2e/preparedness.spec.ts` (9, including the restore race, playback, 28-day evidence, stockout countdown and the Geography separation): mentor demonstration numbers equal the API, shock/reset, real-facility tiers,
brief scenario id, 360 and 390 px.
