# Dynamic threshold methodology

Rules, formulas and severities: [HOSPITAL_PREPAREDNESS.md, "Alert rules"](HOSPITAL_PREPAREDNESS.md#alert-rules-planning-rules-not-clinical-triage-or-official-warning-levels).

Why "dynamic": each threshold is recomputed from the scenario, not fixed at a utilization percentage.

| Threshold | Formula | Moves with |
|---|---|---|
| Routine admission limit | `functional − closed + surge opened − ceil(functional · reserve%)` | closures, surge, reserve |
| Reserve breach | first day `needed > routine limit` | forecast, shock, other-illness load, LOS, admission rate |
| Bed shortage | first day `needed > open beds` | same, plus surge |
| Emergency Surge | `peak needed > functional − closed + all configured surge beds` | same |
| Reorder point | `lead time · mean daily demand + safety stock` | lead time, demand, shock |
| Safety-stock breach and order-by day | first day `stock < safety stock`; minus lead time | stock, deliveries, lead time |

Warnings therefore appear before physical shortages (reserve and safety stock trigger first). Statuses are a pure function of the
scenario; the page debounces control changes, so one scenario cannot flicker, and no shortage is ever suppressed for stability.
These are operational planning rules, not clinical triage or official government warning levels. Tests: `tests/test_preparedness.py`
(`test_alert_rules_from_normal_to_emergency`, `test_reorder_point_and_procurement_keep_the_safety_stock`).
