# Technical Q&A: 100 questions (English, বাংলা)

Short answers; file references in backticks. Numbers come from README, `app_data/metrics_canonical.json` and the final build.

## A. Forecasting (1-15)

1. **Which model and why?** Ridge Poisson GLM, one per horizon: within 0.05 MAE of the best of 28 variants and the simplest, most stable and explainable. — Ridge Poisson GLM; ২৮টি variant-এর মধ্যে best-এর 0.05 MAE-এর ভেতরে, সবচেয়ে সরল ও stable।
2. **Why Poisson?** Weekly cases are non-negative counts; a log link keeps predictions positive and effects multiplicative. — Case হলো count; log link-এ prediction positive থাকে।
3. **Why Ridge?** 24 correlated weather and lag features; L2 shrinkage stabilizes coefficients. — Feature-গুলো correlated; L2 coefficient stable রাখে।
4. **How many features?** 24 (F8 set), chosen from 204 candidates by ablation. (`dengueshield/features/`) — ২০৪টি থেকে ২৪টি।
5. **Why rainfall lags of 2-4 weeks?** Breeding plus incubation delay; the lag analysis peaks there. — মশার প্রজনন ও incubation-এর delay।
6. **Accuracy?** MAE 1.107 / 1.393 / 1.512 at h = 2/3/4 on validation seasons 2022-2024 (validation, not a blind test). — h=2/3/4-এ MAE 1.107/1.393/1.512; validation result।
7. **Interval coverage?** 80%: 0.854, 90%: 0.911 overall; at peak weeks only 0.57 / 0.71. — Overall ঠিক, peak week-এ under-cover।
8. **Alert performance?** Pooled replay recall 0.758, precision 0.508. — Recall 0.758, precision 0.508।
9. **Leakage prevention?** Features use only data available at the origin; season-level CV; calibration on earlier seasons only. — Origin-এর পরের data feature-এ ঢোকে না।
10. **Sealed 2025?** Dropped at load time; never used to fit, select, calibrate or score; decision tools refuse 2025 origins (422). — 2025 কোথাও ব্যবহার হয়নি।
11. **Why no 1-week forecast?** The champion is validated only for 2-4 weeks; week 1 in planning is a labelled interpolation. — Model ২-৪ সপ্তাহের জন্য validated।
12. **Service levels?** Median, upper 80%, upper 90% per ward; planners choose. — Median বা upper bound বেছে নেওয়া যায়।
13. **Is the city upper-80% total an 80% bound?** No. It sums ward upper bounds; that is not a calibrated joint city bound, only a conservative planning level. — না; ward upper bound-এর যোগফল joint bound নয়।
14. **In-sample protection?** Bundle forecasts for trained weeks are refused in decision tools. — Trained সপ্তাহের forecast refuse করা হয়।
15. **Is the data real?** No. The organizer's synthetic dataset; nothing is live surveillance. — না, synthetic dataset।

## B. Data integrity and provenance (16-25)

16. **Which categories label data?** organizer_synthetic, model_estimate, synthetic_demo, planning_assumption, verified_public, unknown. — প্রতিটি উৎসের label আছে।
17. **Are planning hospitals real?** No: 15 fictional hospitals and a Regional Referral Simulation Center (`app_data/preparedness/planning_hospitals.json`). — না, fictional।
18. **How were they sized?** From each city's observed cases in the week of 5 Aug 2024 (260 beds for Dhaka North); shares and stock are assumptions. — Observed case থেকে scale।
19. **Real hospital capacity?** Unknown: none of the 914 OSM facilities has a beds tag. We show "Actual hospital capacity unavailable." — অজানা, তাই তাই লিখি।
20. **Real availability?** Unknown: "Bed availability unconfirmed — contact hospital." — অজানা; hospital-এ ফোন করতে হবে।
21. **Phone numbers?** Only 59 OSM phone tags (community-mapped), 999 and 16263; none invented. — কোনো নম্বর বানানো হয়নি।
22. **Emergency numbers verified?** Rechecked 27 Nov 2026: 999 (police-run, includes ambulance), 16263 (DGHS health line; continuity questioned in press). — 27 Nov 2026-এ যাচাই।
23. **Scenario id?** Hash of every input: settings, fixture, dataset and model bundle; same inputs, same id and bytes. — সব input-এর hash।
24. **Do exports match the screen?** Yes; tests compare the id and values in CSV/HTML with the page. — হ্যাঁ, test আছে।
25. **Deterministic?** Yes; no random draws in planning engines; fixtures fixed. — হ্যাঁ, deterministic।

## C. Resource allocation (26-35)

26. **Demand rule?** `floor(multiplier × cases + 0.5)` per resource, organizer multipliers. — Organizer multiplier।
27. **Supply?** Each city gets `floor(stock% × its demand)`; cities never share. — City pool আলাদা।
28. **Priority?** Risk weight × outbreak probability + rest × density (normalized). — Risk + density।
29. **Fairness?** Floor φ = min(setting, stock share) of each ward's demand first. — আগে fairness floor।
30. **Optimal?** Priority-ordered fill after floors maximizes priority-weighted supply; checked against an exact solver. — Exact solver দিয়ে যাচাই।
31. **Crews?** Rounds: first crew to each needing ward by priority, then second, capped per ward. — Coverage-first নিয়ম।
32. **Conservation?** Pool = placed + left over; shown per lane. — হিসাব মেলে।
33. **Uncertainty comparison?** Matched-budget policies over prior-season residuals (`/api/allocation/uncertainty`). — Codex-এর comparison।
34. **Critical deficit?** High/Critical ward with any shortfall, or under half covered. — Definition fixed।
35. **City isolation tested?** Yes, unit and browser tests. — হ্যাঁ।

## D. Official ward overflow (36-43)

36. **Algorithm?** Same-city maximum flow, then relieve the most overloaded, then fill the most spare. — Same-city max-flow।
37. **Capacity basis?** 90th percentile of past weekly bed need, scaled by %; illustrative. — Illustrative capacity।
38. **Why zero transfers at baseline?** No ward has spare beds in the peak week (city-wide surge). — কোথাও খালি bed নেই।
39. **At +20%?** 9 same-city transfers; 16 still without a bed. — ৯টি transfer।
40. **Verified?** Brute force and an independent max-flow in tests. — Test-এ যাচাই।
41. **Cross-city?** Never in the official task. — না।
42. **Ward locations?** None; the network is abstract, ordered by ward ID. — কোনো location নেই।
43. **Stock vs beds?** Stage 1 stock is never added to Stage 2 capacity. — আলাদা রাখা।

## E. Vector control (44-50)

44. **Effect model?** Coverage C(k) = 1 − (1 − a)^k; reduction = E × C × timing ramp. — Assumed effect model।
45. **Measured?** No: simulated, not observed or causal. — Simulated।
46. **Crew placement?** Greedy marginal gain (ROI), checked as optimal. — ROI-ভিত্তিক।
47. **Sensitivity?** Low/high effect bands and delays shown. — Sensitivity দেখানো হয়।
48. **Effect on hospitals?** Prevented share for weeks 2-4 scales preparedness demand. — Hospital demand কমে।
49. **Zero crews?** Exactly the forecast (tested). — Forecast অপরিবর্তিত।
50. **Why weeks 2-4 only?** Forecast horizons; no week-1 effect assumed. — ২-৪ সপ্তাহ।

## F. Hospital occupancy (51-62)

51. **Cases vs occupancy?** Cases are a weekly flow; occupancy is a stock: `census_d = census_{d−1} + admitted − discharged`. — Flow বনাম stock।
52. **Admissions?** `round(cases × rate)`; default rate = organizer bed multiplier 0.2984. — Planning assumption।
53. **Length of stay?** Dengue 5 days, other 6 days (adjustable assumptions). — Default 5/6 দিন।
54. **Non-dengue patients?** Existing census, discharging over their stay, with steady inflow. — আলাদা হিসাব।
55. **Existing dengue patients?** Leave on schedule; never admitted again. — Double count হয় না।
56. **Patients who cannot be admitted?** Counted as unresolved, never as occupying a bed. — Unresolved।
57. **Capacity?** Functional − closed + surge opened. — Functional bed।
58. **Protected reserve?** Beds kept for emergencies (default 10%); routine admissions stop there. — Reserve রক্ষা।
59. **Extra beds needed?** `max(peak need − routine limit, 0)`. — Formula।
60. **Shortage timing?** First day need exceeds limit or capacity, reported as a week. — Week হিসেবে।
61. **Checks?** Flow, split and capacity identities re-derived on every row. — প্রতিটি row যাচাই।
62. **Why daily steps?** Integer, exact conservation; weekly totals derived. — Exact হিসাব।

## G. Inventory (63-70)

63. **Saline demand?** Organizer multiplier × hospital share of all cases; aggregate units, not dosage. — Aggregate, dosage নয়।
64. **Conservation?** `closing = opening + received − fulfilled`; unmet separate; never negative. — হিসাব মেলে।
65. **Shipments?** Count only from arrival day. — Arrival day থেকে।
66. **Reorder point?** `lead × daily demand + safety stock`. — Dynamic ROP।
67. **Procurement?** `max_d(cum demand + reserve − stock0 − cum receipts)`. — Formula।
68. **Order-by day?** First safety-stock breach − lead time; ≤ 0 means late. — Deadline।
69. **Redistribution?** Day-1 transport LP; donors keep safety stock every day; helps only unmet days after arrival. — Donor-এর safety stock রক্ষা।
70. **Four policies?** No action, procurement only, redistribution only, both; demo saline unmet 2,511 / 116 / 1,991 / 58. — চারটি policy তুলনা।

## H. Thresholds and crisis (71-80)

71. **Why not fixed 80%?** Risk depends on reserve, surge, stock and lead time, not utilization alone. — Fixed নয়।
72. **Levels?** Watch, Warning, Critical, Emergency Surge, Normal; Unknown for real facilities. — পাঁচ স্তর।
73. **Warning before shortage?** Reserve and safety-stock rules trigger first. — আগে Warning।
74. **Clinical triage?** No; operational planning rules. — Clinical নয়।
75. **Oscillation?** Status is a pure function of the scenario; controls are debounced. — Debounce।
76. **Shock?** Dengue demand × 1.25 to × 3; with closures, stock, lead time, LOS. — Hypothetical shock।
77. **Three states?** Baseline, crisis, response; remaining shortages shown. — তিনটি state।
78. **Response?** Surge beds, redistribution, orders, 28-day referrals. — Response steps।
79. **Detection?** Live detection unavailable; historical EWMA/CUSUM only. — Live নয়।
80. **Mentor demo?** One click, drives the real engines; nothing hard-coded. — আসল engine চালায়।

## I. Network optimization (81-86)

81. **28-day referral model?** Integer program: arrivals = admitted + referred + unresolved; beds per day over each LOS window ≤ limit. — Time-expanded IP।
82. **Objective?** Minimize unresolved, then referrals (same city first). — Lexicographic।
83. **Verification?** Day-by-day re-simulation; baseline is the same program without links. — Re-simulation।
84. **Demo result?** 60 → 0 patients without a bed, 60 referrals. — ৬০ থেকে ০।
85. **Fallback?** Peak-day LP checked by independent max-flow. — Peak-day fallback।
86. **Real transfers?** Never: fictional hospitals; real transfers need clinical coordination and confirmation. — বাস্তব transfer নয়।

## J. Geospatial and emergency (87-92)

87. **Routing?** A* on the OSM road graph, verified by Dijkstra. — A* + Dijkstra।
88. **Coverage?** Greater Dhaka (Dhaka, Gazipur, Narayanganj) and Chattogram only. — চারটি district।
89. **Cross-region?** Straight-line distance only, labelled; no invented route. — Straight-line।
90. **Tiers?** Nearby ≤15 min, wider city ≤30 min, district, neighbouring districts, other region. — Tier।
91. **Ambulance?** 999 includes ambulance; no provider numbers or arrival times invented. — 999।
92. **Map offline?** Blank basemap; facilities and routes still draw. — Basemap ছাড়া চলে।

## K. Engineering and offline (93-100)

93. **Offline proof?** Kill-switch: 28/28 results identical, browser test passed, 0 outbound attempts. — ২৮/২৮।
94. **Fresh clone?** `scripts/setup.sh` completed in about 1 minute on the dev laptop; offline check 21 artifacts. — Fresh clone কাজ করে।
95. **Stale responses?** Requests abort on change; tests prove the last setting wins. — শেষ setting জেতে।
96. **Restore race?** Edits before URL restore are re-applied on top (tested). — Fix করা হয়েছে।
97. **Idle performance?** No timers or loops at rest; tested with zero DOM mutations. — Idle loop নেই।
98. **Accessibility?** axe (WCAG 2 A/AA) light and Dim, keyboard navigation, reduced motion. — Accessibility test।
99. **Security?** Input bounds, CSV injection guard, HTML escaping, no secrets in pages (tested). — Security test।
100. **Main limitation?** Synthetic data, fictional hospitals, unknown real capacity, four districts, peak under-coverage. — Synthetic data ও অজানা real capacity।
