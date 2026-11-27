"""Problem 1: constrained resource allocation (dengueshield/allocation.py and GET /api/allocation/plan).

The allocation is checked against independent references: scipy's exact LP solver (HiGHS) on random instances, and brute-force
enumeration of every integer allocation on small ones."""
from __future__ import annotations

import itertools
import json
import socket

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.optimize import linprog

from dengueshield import allocation as A
from dengueshield.api.main import app

ORIGIN, PEAK = "2024-08-05", {"origin": "2024-08-05", "horizon": 3}
client = TestClient(app)


def get(**params):
    r = client.get("/api/allocation/plan", params={**PEAK, **params})
    assert r.status_code == 200, r.text
    return r.json()


def lp_optimum(d, supply, w, phi):
    """Exact optimum of max w.x s.t. floor(phi*d) <= x <= d, sum(x) = min(supply, sum(d)) (HiGHS)."""
    lo = np.floor(phi * d)
    res = linprog(-w, A_eq=np.ones((1, len(d))), b_eq=[min(supply, d.sum())], bounds=list(zip(lo, d)), method="highs")
    assert res.status == 0
    return -res.fun


# ------------------------------------------------------------------ demand rule
def test_demand_rule_matches_the_dataset_rule():
    rules = A.load_rules()
    assert set(rules) == set(A.RESOURCES)
    assert list(A.demand([0, 1, 2, 10, 41], rules["saline_bags_needed"])) == [0, 2, 5, 24, 98]
    assert list(A.demand([0, 1, 4, 10, 41], rules["diagnostic_kits_needed"])) == [0, 1, 5, 12, 48]
    assert list(A.demand([0, 1, 2, 12, 41], rules["hospital_beds_required"])) == [0, 0, 1, 4, 12]
    with pytest.raises(ValueError):
        A.demand([-1], 1.0)


def test_runtime_rules_reproduce_every_development_row():
    from dengueshield.onsite_data import load_onsite_development_panel
    dev, rules = load_onsite_development_panel(), A.load_rules()
    for r in A.RESOURCES:
        assert (A.demand(dev.dengue_cases, rules[r]) == dev[r].to_numpy()).all(), r
    meta = json.loads(A.RULES_PATH.read_text())
    assert meta["identified_on"].startswith("2016-01-04..2018-12-31")              # before every replay origin


# ------------------------------------------------------------------ the allocation programme
@pytest.mark.parametrize("seed", range(40))
def test_greedy_allocation_is_lp_optimal_integral_and_conserving(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(1, 25))
    d = rng.integers(0, 60, n)
    w = np.round(rng.random(n), 3)                                                  # rounding creates ties on purpose
    supply = int(rng.integers(0, d.sum() + 20))
    phi = float(rng.choice([0.0, 0.1, 0.25, 0.5]))
    keys = [f"W{i:02d}" for i in range(n)]
    x = A.allocate_pool(d, supply, w, keys, phi)
    assert x.dtype.kind == "i" and (x >= 0).all() and (x <= d).all()
    assert x.sum() == min(supply, d.sum())                                          # exact conservation, nothing created
    if supply < d.sum():
        assert (x >= np.floor(min(phi, supply / d.sum()) * d)).all()               # fairness floor honoured
        assert abs(float(w @ x) - lp_optimum(d, supply, w, min(phi, supply / d.sum()))) < 1e-6


def test_greedy_matches_brute_force_on_small_instances():
    rng = np.random.default_rng(7)
    for _ in range(60):
        n = int(rng.integers(1, 4)); d = rng.integers(0, 5, n); w = rng.random(n); supply = int(rng.integers(0, d.sum() + 1))
        x = A.allocate_pool(d, supply, w, [str(i) for i in range(n)], 0.0)
        best = max(float(w @ np.array(c)) for c in itertools.product(*[range(k + 1) for k in d]) if sum(c) == min(supply, d.sum()))
        assert abs(float(w @ x) - best) < 1e-9


def test_ties_are_broken_by_ward_id_and_input_order_does_not_matter():
    d, w = np.array([5, 5, 5]), np.array([0.5, 0.5, 0.5])
    assert list(A.allocate_pool(d, 7, w, ["B", "A", "C"], 0.0)) == [2, 5, 0]       # A first, then B
    perm = [2, 0, 1]
    assert list(A.allocate_pool(d[perm], 7, w[perm], [["B", "A", "C"][i] for i in perm], 0.0)) == [0, 2, 5]


def test_input_validation():
    with pytest.raises(ValueError):
        A.allocate_pool(np.array([-1]), 0, np.array([1.0]), ["a"], 0.0)
    with pytest.raises(ValueError):
        A.allocate_pool(np.array([1]), -1, np.array([1.0]), ["a"], 0.0)
    with pytest.raises(ValueError):
        A.priority([0.5], [1.0], 1.0, 1.5)
    for bad in [A.Settings(stock=0.29), A.Settings(stock=1.01), A.Settings(crews=-1), A.Settings(service="p99"), A.Settings(floor_share=0.6)]:
        with pytest.raises(ValueError):
            bad.validate()


def _toy(p, dens, cases):
    n = len(p)
    fc = pd.DataFrame({"ward_id": [f"X_Ward_{i:02d}" for i in range(n)], "city": "X", "median_cases": cases, "upper_80": cases, "upper_90": cases,
                       "p_outbreak": p, "risk_tier": "Medium"})
    wards = pd.DataFrame({"ward_id": fc.ward_id, "population_density_sqkm": dens})
    return fc, wards


def test_higher_risk_is_served_first_at_equal_density():
    fc, wards = _toy([0.9, 0.1], [50_000, 50_000], [20, 20])
    out = A.plan(fc, wards, A.load_rules(), A.Settings(stock=0.5, floor_share=0.0, alpha=0.7)).get("wards").set_index("ward_id")
    assert out.loc["X_Ward_00", "saline_bags_needed_unmet"] == 0 and out.loc["X_Ward_01", "saline_bags_needed_unmet"] > 0


def test_higher_density_is_served_first_at_equal_risk():
    fc, wards = _toy([0.5, 0.5], [70_000, 20_000], [20, 20])
    out = A.plan(fc, wards, A.load_rules(), A.Settings(stock=0.5, floor_share=0.0, alpha=0.7)).get("wards").set_index("ward_id")
    assert out.loc["X_Ward_00", "rank"] == 1 and out.loc["X_Ward_00", "saline_bags_needed_unmet"] == 0
    assert out.loc["X_Ward_01", "saline_bags_needed_unmet"] > 0


def test_zero_demand_gives_zero_allocation_and_no_crews():
    fc, wards = _toy([0.0, 0.0, 0.0], [30_000, 40_000, 50_000], [0, 0, 0])
    res = A.plan(fc, wards, A.load_rules(), A.Settings(stock=0.3, crews=5))
    w = res["wards"]
    assert (w[[f"{r}_allocated" for r in A.RESOURCES]] == 0).all().all() and (w.crews_assigned == 0).all()
    assert res["counts"]["met"] == 3 and res["totals"]["crews"]["unassigned"] == 5


def test_crews_conserved_never_exceed_need_and_cover_wards_first():
    need = np.array([3, 3, 1, 0, 2]); w = np.array([0.9, 0.8, 0.7, 0.6, 0.5]); keys = list("ABCDE")
    got = A.assign_crews(need, 4, w, keys)
    assert got.sum() == 4 and (got <= need).all() and list(got) == [1, 1, 1, 0, 1]   # one crew to every needing ward before any second
    assert A.assign_crews(need, 100, w, keys).sum() == need.sum()
    assert A.assign_crews(need, 0, w, keys).sum() == 0


# ------------------------------------------------------------------ the API on real forecasts
@pytest.mark.parametrize("stock", [0.30, 0.50, 0.75, 1.00])
def test_stock_levels_conserve_supply_per_city(stock):
    r = get(stock=stock, crews=25)
    assert len(r["wards"]) == 60 and len({w["ward_id"] for w in r["wards"]}) == 60
    for c in r["cities"]:
        wc = [w for w in r["wards"] if w["city"] == c["city"]]
        for k in A.RESOURCES:
            d = sum(w[k]["demand"] for w in wc)
            assert c[k]["demand"] == d and c[k]["supply"] == int(np.floor(stock * d + 1e-9))
            assert c[k]["allocated"] == sum(w[k]["allocated"] for w in wc) == min(c[k]["supply"], d)
            assert all(0 <= w[k]["allocated"] <= w[k]["demand"] and w[k]["unmet"] == w[k]["demand"] - w[k]["allocated"] for w in wc)
    t = r["totals"]
    assert t["crews"]["assigned"] == min(25, t["crews"]["needed"]) and sum(w["crews_assigned"] for w in r["wards"]) == t["crews"]["assigned"]
    if stock == 1.0:
        assert r["counts"]["met"] == 60 and all(t[k]["unmet"] == 0 for k in A.RESOURCES)
    else:
        assert all(t[k]["unmet"] > 0 for k in A.RESOURCES) and r["counts"]["met"] < 60


def test_scarcity_monotone_and_service_levels_ordered():
    unmet = [get(stock=s)["totals"]["saline_bags_needed"]["unmet"] for s in (0.3, 0.5, 0.75, 1.0)]
    assert unmet == sorted(unmet, reverse=True) and unmet[-1] == 0
    dem = [get(service=s)["totals"]["saline_bags_needed"]["demand"] for s in ("median", "p80", "p90")]
    assert dem == sorted(dem) and dem[0] < dem[2]


def test_city_pools_are_isolated():
    full = get(stock=0.4)
    one = get(stock=0.4, city="Gazipur")
    assert {w["city"] for w in one["wards"]} == {"Gazipur"} and len(one["wards"]) == 5
    a = {w["ward_id"]: [w[k]["allocated"] for k in A.RESOURCES] for w in full["wards"] if w["city"] == "Gazipur"}
    b = {w["ward_id"]: [w[k]["allocated"] for k in A.RESOURCES] for w in one["wards"]}
    assert a == b


def test_recomputation_is_deterministic():
    assert get(stock=0.55, crews=17)["wards"] == get(stock=0.55, crews=17)["wards"]


def test_priority_ranking_and_critical_flags_are_consistent():
    r = get(stock=0.3)
    ranks = [w["priority"] for w in r["wards"]]
    assert ranks == sorted(ranks, reverse=True) and [w["rank"] for w in r["wards"]] == list(range(1, 61))
    for w in r["wards"]:
        short = any(w[k]["unmet"] > 0 for k in A.RESOURCES)
        assert (w["status"] == "met") == (not short)
        if short and w["risk_tier"] in ("High", "Critical"):
            assert w["status"] == "critical"


def test_low_risk_wards_are_not_starved_by_the_floor():
    r = get(stock=0.3, floor=0.25)
    for w in r["wards"]:
        d = w["saline_bags_needed"]["demand"]
        assert w["saline_bags_needed"]["allocated"] >= int(np.floor(0.25 * d))


def test_extreme_inputs_are_rejected():
    for bad in [{"stock": 0.29}, {"stock": 1.2}, {"crews": -1}, {"crews": 5000}, {"risk_weight": 1.5}, {"floor": 0.9},
                {"service": "p99"}, {"horizon": 5}, {"origin": "2024-08-06"}, {"origin": "not-a-date"}]:
        assert client.get("/api/allocation/plan", params={**PEAK, **bad}).status_code == 422, bad
    assert client.get("/api/allocation/plan", params={**PEAK, "city": "Atlantis"}).status_code == 404


def test_no_2025_origin_and_no_outcomes_in_the_response():
    assert client.get("/api/allocation/plan", params={"origin": "2025-01-06", "horizon": 3}).status_code == 422
    r = get(origin="2024-12-30")                                                    # forward forecast from the last 2024 week
    assert r["target_date"] == "2025-01-20" and r["source"] == "bundle"
    text = json.dumps(r)
    assert "actual" not in text and "y_true" not in text                          # no observed cases or resource actuals
    src = A.__file__ and open(A.__file__).read()
    assert "load_panel" not in src and "onsite_data" not in src and "read_csv" not in src


def test_runs_offline(monkeypatch):
    def no_network(*a, **k):
        raise OSError("network disabled for this test")
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    r = client.get("/api/allocation/plan", params={**PEAK, "stock": 0.45, "crews": 9})
    assert r.status_code == 200 and len(r.json()["wards"]) == 60
