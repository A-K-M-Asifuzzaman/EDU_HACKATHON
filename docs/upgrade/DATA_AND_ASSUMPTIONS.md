# Data and assumptions

The full table is in [HOSPITAL_PREPAREDNESS.md, "Data and provenance"](HOSPITAL_PREPAREDNESS.md#data-and-provenance). In short:

- **organizer_synthetic**: the competition dengue dataset (2016-2024 used; 2025 sealed) and its resource multipliers.
- **model_estimate**: origin-safe forecasts at weeks 2-4; week 1 is scenario-derived (interpolated) and labelled so.
- **synthetic_demo**: the 15 planning hospitals and the Regional Referral Simulation Center in
  `app_data/preparedness/planning_hospitals.json`, with beds, occupancy, stock, deliveries and lead times. Fictional; sized from each
  city's observed cases in the week of 5 Aug 2024. Deterministic: the same file and settings always give the same numbers.
- **planning_assumption**: length of stay, admission rate, protected reserve, shocks, closures, surge availability, stock levels.
- **verified_public**: 914 OpenStreetMap facilities (community-mapped), the road graphs, 59 OSM phone tags, and the national numbers
  999 and 16263. Identity and location only.
- **unknown**: real hospital capacity, occupancy, availability, ambulance availability and arrival times. Shown as unknown.

Never done: real bed counts or availability for named hospitals, invented phone numbers, live detection claims, patient dosage.
