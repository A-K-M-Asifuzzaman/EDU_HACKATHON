"""Compare policies on four 2024 development weeks using only prior-season errors for fitting.

Run from the repository root: python -m scripts.benchmark_allocation_uncertainty
"""
from collections import defaultdict
import json

from fastapi.testclient import TestClient

from dengueshield import allocation
from dengueshield.api import main

ORIGINS = ["2024-05-06", "2024-06-03", "2024-08-05", "2024-10-07"]


def benchmark():
    client = TestClient(main.app)
    evaluated = []
    for origin in ORIGINS:
        truth = main.forecast_frame(origin, 3, "replay").merge(
            main.S.wards[["ward_id", "population_density_sqkm"]], on="ward_id", validate="one_to_one",
        ).set_index("ward_id")
        assert truth.target_date.str.startswith("2024-").all()
        truth["weight"] = allocation.priority(
            truth.p_outbreak, truth.population_density_sqkm, main.S.wards.population_density_sqkm.max(), 0.7,
        )
        for resource, multiplier in main.alloc_rules().items():
            response = client.get("/api/allocation/uncertainty", params={
                "origin": origin, "horizon": 3, "stock": 0.6, "reserve_pct": 10, "source": "replay", "resource": resource,
            })
            response.raise_for_status()
            comparison = response.json()
            assert all(week < "2024" for week in comparison["prior_replay_weeks"])
            weighted, units = defaultdict(float), defaultdict(int)
            statuses, times = [], []
            for pool in comparison["cities"]:
                statuses.append(pool["solver"]["status"])
                times.append(pool["solver"]["runtime_ms"])
                for ward in pool["wards"]:
                    actual = truth.loc[ward["ward_id"]]
                    observed_need = int(allocation.demand(actual.actual_cases, multiplier))
                    for policy, amount in ward["allocations"].items():
                        deficit = max(0, observed_need - amount)
                        weighted[policy] += deficit * actual.weight
                        units[policy] += deficit
            full_candidate = all(status == "optimal" for status in statuses)
            if not full_candidate:
                weighted.pop("tail_risk", None)
                units.pop("tail_risk", None)
            evaluated.append({
                "origin": origin, "resource": resource, "prior_weeks": len(comparison["prior_replay_weeks"]),
                "all_pools_optimal": full_candidate, "slowest_city_solver_ms": max(times),
                "realized_weighted_shortage": {key: round(val, 5) for key, val in sorted(weighted.items())},
                "realized_unmet_units": dict(sorted(units.items())),
            })
    return evaluated


if __name__ == "__main__":
    print(json.dumps(benchmark(), indent=2))
