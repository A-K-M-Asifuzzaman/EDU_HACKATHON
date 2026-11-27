"""Check the proposed allocation policy independently of the solver, and against a real development replay."""

from itertools import product

import numpy as np
from fastapi.testclient import TestClient

from dengueshield.allocation_uncertainty import compare_pool, solve
from dengueshield.api.main import app


def test_integer_tail_solution_matches_exhaustive_search():
    nominal = np.array([6, 4, 3])
    floor = np.array([1, 1, 0])
    demand = np.array([[8, 0, 2], [2, 6, 4], [4, 4, 1], [0, 3, 8], [4, 4, 3]])
    weights = np.array([1.0, 0.8, 0.6])

    # At 80% confidence with five equally weighted observations, the tail mean is the maximum.
    def objective(x):
        return float(np.max(np.maximum(demand - x, 0) @ weights))

    feasible = [np.array(x) for x in product(*(range(lo, hi + 1) for lo, hi in zip(floor, nominal))) if sum(x) == 7]
    result, evidence = solve(nominal, floor, 7, demand, weights)
    assert evidence["status"] == "optimal"
    assert any(np.array_equal(result, x) for x in feasible)
    assert abs(objective(result) - min(objective(x) for x in feasible)) < 1e-8


def test_policies_share_a_budget_and_local_fairness_floor():
    keys = ["Ward_A", "Ward_B", "Ward_C"]
    nominal = np.array([8, 12, 10])
    demand = np.array([[2, 12, 15], [8, 12, 1], [5, 8, 10], [9, 6, 9], [2, 9, 14]])
    weights = np.array([0.7, 0.6, 0.9])
    result = compare_pool(keys, nominal, demand, 20, 10, 0.25, weights[::-1], weights, weights, weights)
    assert result["reserve"] == 2
    assert result["assignable"] == 18
    assert result["solver"]["status"] == "optimal"
    for policy in result["policies"].values():
        assert policy["allocated"] == 18
        assert policy["meets_floor"]
    assert all(sum(w["allocations"][name] for w in result["wards"]) == 18 for name in result["policies"])
    candidate = result["policies"]["tail_risk"]["tail_weighted_shortage"]
    assert all(candidate <= policy["tail_weighted_shortage"] + 1e-8 for policy in result["policies"].values())


def test_real_comparison_uses_prior_replay_and_preserves_the_active_plan():
    client = TestClient(app)
    params = {"origin": "2024-08-05", "horizon": 3, "city": "Gazipur", "stock": 0.6}
    original = client.get("/api/allocation/plan", params=params).json()
    response = client.get("/api/allocation/uncertainty", params={**params, "reserve_pct": 10, "supply_units": 40})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["prior_replay_weeks"]) >= 5
    assert all("2019" <= week < "2024" for week in result["prior_replay_weeks"])
    pool, = result["cities"]
    assert pool["city"] == "Gazipur"
    assert (pool["stock"], pool["reserve"], pool["assignable"]) == (40, 4, 36)
    assert pool["solver"]["status"] == "optimal"
    assert client.get("/api/allocation/plan", params=params).json() == original


def test_comparison_requires_prior_seasons_and_unambiguous_exact_stock():
    client = TestClient(app)
    route = "/api/allocation/uncertainty"
    assert client.get(route, params={"origin": "2024-08-05", "supply_units": 50}).status_code == 422
    missing = client.get(route, params={"origin": "2019-08-05", "city": "Gazipur"})
    assert missing.status_code == 422
    assert "prior-season replay weeks" in missing.json()["detail"]
