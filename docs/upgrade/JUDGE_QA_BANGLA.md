# Technical Q&A (বাংলা, English technical terms রাখা হয়েছে)

সংখ্যাগুলো README, `app_data/metrics_canonical.json` এবং engine output থেকে; উত্তর দেওয়ার আগে একবার মিলিয়ে নিন।

## Forecasting

1. **কেন Ridge Poisson GLM?** — Count data, তাই Poisson। 28টি model variant ও 5টি baseline একই season fold-এ তুলনা করা হয়েছে। নিয়ম আগে থেকেই ঠিক ছিল: best MAE-এর 0.05-এর মধ্যে যা আছে, তার মধ্যে সবচেয়ে সরলটি। XGBoost/LightGBM/CatBoost/ensemble অর্থবহভাবে ভালো করেনি; GLM সবচেয়ে stable, explainable (log-rate contribution) এবং 11 KB bundle। (`reports/MODEL_COMPARISON.md`)
2. **Ridge কেন?** — 24টি correlated feature (rain lag, temperature, humidity, seasonality, past cases); L2 penalty variance কমায় এবং coefficient stable রাখে।
3. **Feature engineering?** — 204টি candidate থেকে 24টি (F8 set) বাছাই; rainfall-এর 2-4 সপ্তাহের lag dengue-এর biological delay (মশার প্রজনন + incubation) ধরে। (`dengueshield/features/`)
4. **Temporal leakage কীভাবে আটকেছেন?** — Origin convention: forecast origin-এর পরের কোনো observation feature-এ ঢোকে না; season-level cross-validation; calibration শুধু আগের দুই validation season-এ।
5. **Sealed holdout?** — 2025 fit, selection, calibration, scoring কোথাও ব্যবহার হয়নি; loader 2025-এর row parse করার আগেই বাদ দেয়। Decision tool 2025 origin প্রত্যাখ্যান করে (422)।
6. **Accuracy?** — MAE 1.107 / 1.393 / 1.512 (h = 2/3/4, validation 2022-2024)। এগুলো validation result, blind test নয়।
7. **Uncertainty?** — Negative-binomial interval; 80% coverage 0.854, 90% 0.911 overall, কিন্তু peak week-এ মাত্র 0.57 / 0.71। তাই planning-এ upper 80% বা 90% ব্যবহার করার option আছে।
8. **1-week forecast কেন নেই?** — Champion শুধু 2-4 সপ্তাহের জন্য validated। Preparedness timeline-এ week 1 = (observed week 0 + forecast week 2)/2, যা "scenario-derived" হিসেবে লেবেল করা।

## Hospital preparedness (mentor-এর প্রশ্ন)

9. **Weekly case আর hospital occupancy কি এক?** — না। Weekly case হলো flow; occupancy হলো stock। Admission = round(case × admission rate), প্রতিটি রোগী LOS দিন থাকে। `census_d = census_{d−1} + admitted − discharged`। (`dengueshield/preparedness.py`)
10. **Non-dengue রোগী কীভাবে ধরেছেন?** — প্রতিটি planning hospital-এ existing other-illness occupancy আছে; তারা LOS অনুযায়ী ধীরে ধীরে discharge হয় এবং steady inflow আসে। Dengue-এর সাথে একই bed share করে।
11. **Existing dengue রোগী double-count হয় না তো?** — না। তারা scheduled discharge-এ বের হয়; নতুন admission শুধু forecast demand থেকে আসে। Test: `test_existing_patients_are_not_admitted_again...`।
12. **Admission rate আর LOS কোথা থেকে?** — Planning assumption। Default admission rate = organizer-এর bed multiplier (0.2984 per case), dengue LOS 5 দিন, other 6 দিন। User বদলাতে পারে, আর সব জায়গায় assumption হিসেবে লেবেল করা।
13. **Functional আর licensed bed-এর পার্থক্য?** — Licensed কাগজে; functional = বাস্তবে খোলা। Engine functional − closed + opened surge দিয়ে capacity গোনে।
14. **Protected reserve কী?** — Emergency-র জন্য খালি রাখা bed (default 10%)। Routine admission reserve-এ ঢোকে না। Demand reserve ছুঁলে Warning।
15. **Bed না পেলে রোগী কোথায় যায়?** — "Unresolved" হিসেবে গোনা হয়, কখনো occupied bed হিসেবে নয়। Demand cap করে shortage লুকানো হয় না।
16. **Additional beds required?** — `max(peak_needed − (capacity − reserve), 0)`, যেখানে peak_needed আসে একটি run থেকে যেখানে সবাইকে admit করা হয়।
17. **Shortage কবে?** — প্রথম যে দিনে needed > capacity (shortage) বা > capacity − reserve (reserve breach); সপ্তাহ হিসেবে দেখানো হয়, কারণ daily precision-এর evidence নেই।
18. **Real hospital-এর bed count কোথায়?** — নেই। Bundled 914টি OSM facility-এর কোনোটিতেই beds tag নেই। তাই দেখাই "Actual hospital capacity unavailable." Planning hospital-গুলো fictional (synthetic_demo)।

## Inventory

19. **Saline কত লাগবে?** — Organizer multiplier × case (saline 2.384, kit 1.164 per case), hospital-এর catchment share অনুযায়ী। এটা aggregate planning, কোনো রোগীর dosage নয়।
20. **Inventory conservation?** — `closing = opening + received − fulfilled`; `fulfilled = min(demand, available)`; unmet আলাদা; stock কখনো negative নয়।
21. **Future shipment কি আগে গোনা হয়?** — না, arrival day থেকেই। Test: delayed resupply case।
22. **Dynamic reorder point?** — `ROP = lead time × daily demand + safety stock`; demand বা lead time বদলালে ROP বদলায়।
23. **কত order করতে হবে?** — `max_d(cum_demand + reserve − stock_0 − cum_receipts)`, যাতে stock কখনো safety stock-এর নিচে না নামে। Latest order day = প্রথম breach − lead time।

## Dynamic thresholds

24. **Fixed 80% threshold নয় কেন?** — একই utilization-এ ঝুঁকি আলাদা হতে পারে। Rule-গুলো projected demand, reserve, surge, stock, lead time একসাথে দেখে।
25. **Category কীভাবে নির্ধারিত?** — Watch (stock ≤ ROP), Warning (reserve বা safety stock breach), Critical (bed shortage বা stockout), Emergency Surge (সব surge bed খুললেও demand বেশি)। সবচেয়ে severe alert-ই status। (`docs/upgrade/HOSPITAL_PREPAREDNESS.md`)
26. **এগুলো কি clinical triage?** — না। Operational planning rule; official warning level-ও নয়।

## Sudden outbreak

27. **Shock simulation?** — Dengue demand × 1.25 থেকে × 3; সাথে closure, stock, lead time, other-illness load বদলানো যায়। তিনটি state: baseline, crisis, optimized response।
28. **Optimized response-এ কী হয়?** — Surge bed খোলা, আজকে order (lead time পরে পৌঁছায়), তারপর network referral। যা মেটে না তা "still unmet" হিসেবে দেখানো হয়।
29. **Actual outbreak detection?** — Live data নেই, তাই লেখা থাকে "Live outbreak detection unavailable"। Historical replay-এ EWMA ও CUSUM দেখাই; shock হলো hypothetical stress test।

## Optimization এবং network

30. **Resource allocation objective?** — প্রতিটি city-র নিজস্ব stock pool; প্রথমে fairness floor (প্রতিটি ward demand-এর একটা অংশ পায়), তারপর priority (risk weight + density) ক্রমে পূরণ। এটা priority-weighted supply maximise করে; exact solver দিয়ে test করা। (`dengueshield/allocation.py`)
31. **Fairness?** — Floor φ = min(floor setting, stock share), তাই floor সবসময় supply-তে fit করে।
32. **Maximum flow কোথায়?** — Official ward overflow: same-city max-flow, সর্বোচ্চ রোগী place করে, তারপর সবচেয়ে overloaded ward আগে relieve করে। Brute force এবং independent max-flow দিয়ে test করা। (`dengueshield/overflow.py`)
33. **Preparedness referral LP?** — Stage 1: রোগী place করা maximise (bipartite transportation LP, integral)। Stage 2: একই total রেখে same-city receiver আগে। `scipy` maximum_flow দিয়ে certificate।
34. **Same-city rule কি ভাঙা হয়েছে?** — Official ward task-এ না। Preparedness network আলাদা feature: শুধু fictional hospital, regional referral center-এ cross-city referral।
35. **A* আর Dijkstra?** — Real OSM road graph-এ; A* admissible heuristic দিয়ে কম node expand করে; প্রতিটি route Dijkstra দিয়ে verify হয়। (`dengueshield/routing.py`)
36. **Cross-district referral?** — Real facility tier: nearby (≤15 min), wider city, district, neighbouring district (একই road graph), তারপর অন্য region (Chattogram) straight-line distance-এ, কারণ region-এর মধ্যে road graph bundled নেই।
37. **Estimated availability কেন confirmed নয়?** — কোনো live বা hospital-reported data নেই। Missing মানে unknown, "full" নয়; transfer-এর আগে hospital-এর confirmation লাগবে।
38. **Ambulance নম্বর?** — শুধু 999 (ambulance সহ) ও 16263 (DGHS), আর যে 59টি OSM facility-তে phone tag আছে। কোনো নম্বর বানানো হয়নি; arrival time দাবি করা হয় না।

## Intervention, offline, integrity

39. **Vector control effect কি measured?** — না। Dataset-এ কোনো intervention record নেই; effect, coverage, delay assumption। Output "scenario estimate"।
40. **Intervention কীভাবে hospital-এ প্রভাব ফেলে?** — Crew দিলে Stage 3 simulator-এর prevented share সপ্তাহ 2-4-এর case কমায়, যা admission ও saline demand কমায়।
41. **Offline কীভাবে প্রমাণ করলেন?** — macOS sandbox-exec kill-switch (outbound বন্ধ, শুধু loopback): 28টির মধ্যে 28টি result online baseline-এর সাথে byte-identical, যার 6টি preparedness; browser workflow pass; 0 outbound attempt। Linux CI-তে network namespace।
42. **Scenario synchronization?** — একটি shared plan state ও URL; dispatch ও brief-এর scenario id deterministic hash; একই setting দিলে একই file।
43. **Stale response race?** — Request abort হয় dependency বদলালে; test-এ ইচ্ছাকৃত slow response দিয়ে দেখানো হয়েছে শেষ setting-ই জেতে।
44. **Mathematical verification?** — Occupancy, split ও inventory identity প্রতিটি row-এ engine নিজেই re-derive করে (`checks`), LP vs max-flow certificate, pytest-এ property-style test।
45. **Synthetic বনাম real data কীভাবে আলাদা?** — প্রতিটি উৎসের provenance label: organizer_synthetic, model_estimate, synthetic_demo, planning_assumption, verified_public। Planning সংখ্যা কখনো real hospital marker-এ বসানো হয় না।
46. **Limitations?** — Synthetic dataset; peak-এ interval under-cover করে; planning hospital fictional; real capacity ও availability অজানা; শুধু চারটি district-এর OSM data ও দুটি road graph; live surveillance নেই।
