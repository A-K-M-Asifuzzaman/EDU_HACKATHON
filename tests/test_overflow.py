"""Problem 2 (onsite): hospital surge and cross-ward overflow. Synthetic ward graphs below are TEST FIXTURES, not data."""
import itertools
import json
import socket
from collections import deque

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from dengueshield import overflow as O
from dengueshield.api.main import app
from dengueshield.onsite_data import load_onsite_development_panel

client = TestClient(app)
PEAK = {"origin": "2024-08-05", "horizon": 3}


def get(**q):
    r = client.get("/api/overflow/plan", params={**PEAK, **q})
    assert r.status_code == 200, r.text
    return r.json()


def edmonds_karp(cap: dict, s, t) -> int:
    """Independent reference max-flow (BFS augmenting paths) on a dict-of-dicts capacity graph."""
    res = {u: dict(v) for u, v in cap.items()}
    for u in list(cap):
        for v in cap[u]:
            res.setdefault(v, {}).setdefault(u, 0)
    flow = 0
    while True:
        par, q = {s: None}, deque([s])
        while q and t not in par:
            u = q.popleft()
            for v, c in res[u].items():
                if c > 0 and v not in par:
                    par[v] = u
                    q.append(v)
        if t not in par:
            return flow
        path, v = [], t
        while par[v] is not None:
            path.append((par[v], v))
            v = par[v]
        aug = min(res[u][v] for u, v in path)
        for u, v in path:
            res[u][v] -= aug
            res[v][u] += aug
        flow += aug


def network(d, c):
    u, v = np.maximum(np.subtract(d, c), 0), np.maximum(np.subtract(c, d), 0)
    big = int(sum(u) + sum(v) + 1)
    g = {"s": {f"a{i}": int(u[i]) for i in range(len(d)) if u[i] > 0}}
    for i in range(len(d)):
        if u[i] > 0:
            g[f"a{i}"] = {f"b{j}": big for j in range(len(d)) if v[j] > 0}
        if v[i] > 0:
            g[f"b{i}"] = {"t": int(v[i])}
    return g


def check_invariants(d, c, r, keys):
    d, c = np.asarray(d), np.asarray(c)
    links = r["links"]
    assert all(isinstance(n, int) and n > 0 for _, _, n in links)                    # whole, positive patients only
    sent, recv = np.zeros(len(d), int), np.zeros(len(d), int)
    for i, j, n in links:
        sent[i] += n
        recv[j] += n
    assert (sent == r["sent"]).all() and (recv == r["received"]).all()                 # exact flow conservation
    assert (r["sent"] <= r["deficit"]).all() and (r["received"] <= r["headroom"]).all()  # no over-sending, no over-filling
    assert not ((r["sent"] > 0) & (r["received"] > 0)).any()                           # nobody both sends and receives (no duplicates)
    assert r["sent"].sum() == min(r["deficit"].sum(), r["headroom"].sum())             # maximum flow
    assert r["unresolved"].sum() == max(0, int(d.sum() - c.sum()))                      # city identity
    assert len(links) <= max(0, (r["sent"] > 0).sum() + (r["received"] > 0).sum() - 1)  # north-west corner: at most m + n - 1 links
    assert len({(i, j) for i, j, _ in links}) == len(links)


@pytest.mark.parametrize("seed", range(150))
def test_random_cities_satisfy_every_invariant_and_match_reference_maxflow(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(1, 14))
    d, c = rng.integers(0, 12, n), rng.integers(0, 12, n)
    keys = [f"T{i:02d}" for i in range(n)]
    r = O.route_city(keys, d, c)
    check_invariants(d, c, r, keys)
    assert r["sent"].sum() == edmonds_karp(network(d, c), "s", "t")


def brute(d, c):
    """All integer transfer matrices on a tiny city: best (max patients, then min sum r^2 + sum e^2)."""
    u, v = np.maximum(np.subtract(d, c), 0), np.maximum(np.subtract(c, d), 0)
    S, R = [i for i in range(len(d)) if u[i] > 0], [j for j in range(len(d)) if v[j] > 0]
    pairs = [(i, j) for i in S for j in R]
    best = None
    for f in itertools.product(*[range(min(u[i], v[j]) + 1) for i, j in pairs]):
        out, inn = np.zeros(len(d), int), np.zeros(len(d), int)
        for (i, j), x in zip(pairs, f):
            out[i] += x
            inn[j] += x
        if (out > u).any() or (inn > v).any():
            continue
        key = (-int(out.sum()), int(((u - out) ** 2).sum() + ((v - inn) ** 2).sum()))
        best = key if best is None or key < best else best
    return best


def test_engine_matches_brute_force_on_small_cities():
    rng = np.random.default_rng(11)
    for _ in range(120):
        n = int(rng.integers(2, 6))
        d, c = rng.integers(0, 5, n), rng.integers(0, 5, n)
        r = O.route_city([f"T{i}" for i in range(n)], d, c, risk=rng.random(n))     # tie-breaking never changes the optimum
        got = (-int(r["sent"].sum()), int((r["unresolved"] ** 2).sum() + (r["headroom_after"] ** 2).sum()))
        assert got == brute(d, c), (d, c)


def test_zero_beds_available():
    r = O.route_city(["A", "B", "C"], [3, 0, 5], [0, 0, 0])
    assert r["sent"].sum() == 0 and list(r["unresolved"]) == [3, 0, 5] and r["links"] == []
    res = O.plan(pd.DataFrame({"ward_id": ["A", "B"], "city": ["X", "X"], "demand": [2, 1], "capacity": [0, 0]}))
    assert res["cities"][0]["utilization_after"] is None and res["cities"][0]["unresolved"] == 3


def test_excess_demand_is_partially_relieved_and_the_rest_reported():
    r = O.route_city(["A", "B", "C", "D"], [9, 6, 1, 0], [4, 4, 3, 2])                 # deficits 5, 2; headroom 2, 2
    assert r["sent"].sum() == 4 and r["unresolved"].sum() == 3
    assert list(r["sent"]) == [4, 0, 0, 0] and list(r["unresolved"]) == [1, 2, 0, 0]   # most overloaded relieved first: 5,2 -> 1,2


def test_excess_headroom_resolves_everything_and_draws_on_the_emptiest_first():
    r = O.route_city(["A", "B", "C"], [7, 0, 2], [4, 5, 4])                             # deficit 3; headroom 5 (B), 2 (C)
    assert r["unresolved"].sum() == 0 and list(r["received"]) == [0, 3, 0]
    assert list(r["headroom_after"]) == [0, 2, 2]


def test_fully_satisfied_overflow_exactly_uses_all_headroom():
    r = O.route_city(["A", "B", "C"], [6, 1, 1], [2, 3, 3])
    assert r["unresolved"].sum() == 0 and r["headroom_after"].sum() == 0


def test_impossible_transfers():
    assert O.route_city(["A"], [9], [2])["sent"].sum() == 0                              # single ward: nowhere to go
    r = O.route_city(["A", "B"], [5, 6], [1, 2])                                         # every ward over capacity
    assert r["sent"].sum() == 0 and r["unresolved"].sum() == 8


def test_ties_and_input_order_are_deterministic():
    r = O.route_city(["B", "A", "C"], [3, 3, 0], [2, 2, 1])                             # equal deficits, one spare bed
    assert list(r["sent"]) == [0, 1, 0]                                                  # no risk given: tie broken by ward ID, A first
    r = O.route_city(["A", "B", "C"], [3, 3, 0], [2, 2, 1], risk=[0.2, 0.9, 0.5])         # one spare bed, two equal deficits
    assert list(r["sent"]) == [0, 1, 0]                                                  # higher-risk B is relieved first
    r = O.route_city(["A", "B", "C"], [2, 0, 0], [1, 1, 1], risk=[0.5, 0.8, 0.1])         # one patient, two equally spare wards
    assert list(r["received"]) == [0, 0, 1]                                              # lower-risk C receives; B keeps its bed
    f = pd.DataFrame({"ward_id": list("ABCDE"), "city": ["X", "X", "Y", "Y", "Y"], "demand": [5, 0, 4, 1, 0], "capacity": [2, 4, 1, 3, 2]})
    f["p_outbreak"] = [0.5, 0.5, 0.3, 0.3, 0.3]
    a, b = O.plan(f), O.plan(f.sample(frac=1, random_state=3))
    assert a["transfers"] == b["transfers"] and a["cities"] == b["cities"]


def test_cities_never_exchange_patients():
    f = pd.DataFrame({"ward_id": ["X1", "X2", "Y1", "Y2"], "city": ["X", "X", "Y", "Y"], "demand": [9, 0, 0, 0], "capacity": [1, 1, 50, 50]})
    res = O.plan(f)
    assert res["totals"]["transferred"] == 1 and res["totals"]["unresolved"] == 7        # Y's 100 spare beds are not reachable
    assert all(t["from_ward"][0] == t["to_ward"][0] == t["city"] for t in res["transfers"])


def test_capacity_rule_order_statistic_and_rounding():
    h = pd.DataFrame({"ward_id": ["A"] * 60, "date": pd.date_range("2020-01-06", periods=60, freq="W-MON"),
                      "hospital_beds_required": list(range(60))})
    b = O.capacity_baseline(h, "2030-01-07")
    assert int(b.baseline.iloc[0]) == 53 and int(b.history_weeks.iloc[0]) == 60            # k = ceil(54) = 54th smallest of 0..59
    assert list(O.scale([3, 1, 5, 3, 7, 0], [50, 50, 110, 0, 300, 120])) == [2, 1, 6, 0, 21, 0]   # 1.5->2, 0.5->1, 5.5->6
    with pytest.raises(ValueError):
        O.capacity_baseline(h, "2020-06-01")                                             # fewer than 52 weeks
    with pytest.raises(ValueError):
        O.scale([3], [301])


@pytest.mark.parametrize("origin", ["2019-01-07", "2020-06-01", "2022-09-05", "2024-08-05", "2024-12-30"])
def test_capacity_uses_only_weeks_before_the_origin(origin):
    hist = load_onsite_development_panel()[["ward_id", "date", "hospital_beds_required"]]
    got = O.capacity_baseline(hist, origin).set_index("ward_id")
    past = hist[hist.date < pd.Timestamp(origin)]
    ref = past.groupby("ward_id").hospital_beds_required.apply(lambda s: int(np.quantile(s, 0.9, method="inverted_cdf")))
    assert (got.baseline == ref).all() and len(got) == 60
    poisoned = hist.copy()
    poisoned.loc[poisoned.date >= pd.Timestamp(origin), "hospital_beds_required"] = 999        # origin week and everything later
    assert (O.capacity_baseline(poisoned, origin).set_index("ward_id").baseline == got.baseline).all()


def test_api_peak_is_a_city_wide_surge_with_explicit_shortage():
    j = get()
    t = j["totals"]
    assert (t["demand"], t["capacity"], t["transferred"], t["unresolved"]) == (224, 171, 0, 53)
    for c in j["cities"]:
        assert c["unresolved"] == max(0, c["demand"] - c["capacity"])
    assert j["scenarios"]["unresolved_shortage"] == 53 and len(j["wards"]) == 60


def test_api_capacity_scenario_moves_patients_inside_cities_only():
    j = get(capacity_pct=120)
    t = j["totals"]
    assert t["transferred"] == sum(x["patients"] for x in j["transfers"]) > 0
    city = {w["ward_id"]: w["city"] for w in j["wards"]}
    assert all(city[x["from_ward"]] == city[x["to_ward"]] == x["city"] for x in j["transfers"])
    for c in j["cities"]:
        assert c["unresolved"] == max(0, c["demand"] - c["capacity"])
        assert c["utilization_after"] == (round(min(c["demand"], c["capacity"]) / c["capacity"], 4) if c["capacity"] else None)
    for w in j["wards"]:
        assert w["occupied_after"] <= w["capacity"] and w["sent"] + w["unresolved"] == w["deficit"]


def test_api_city_filter_equals_the_full_plan():
    full = {w["ward_id"]: w for w in get(capacity_pct=120)["wards"]}
    part = get(capacity_pct=120, city="Dhaka South")
    assert len(part["wards"]) == 20 and all(full[w["ward_id"]] == w for w in part["wards"])


def test_api_overrides_and_city_percentages():
    j = get(override=["GCC_Ward_01:9", "GCC_Ward_02:0"], city_pct=["Narayanganj:200"], city="Gazipur")
    w = {x["ward_id"]: x for x in j["wards"]}
    assert w["GCC_Ward_01"]["capacity"] == 9 and w["GCC_Ward_01"]["overridden"] and w["GCC_Ward_02"]["capacity"] == 0
    n = get(city_pct=["Narayanganj:200"], city="Narayanganj")
    assert all(x["capacity"] == (2 * x["capacity_baseline"] * 200 + 100) // 200 for x in n["wards"])


def test_demand_is_shared_with_supply_allocation():
    for service in ("median", "p80", "p90"):
        a = client.get("/api/allocation/plan", params={**PEAK, "service": service, "stock": 0.6}).json()
        o = get(service=service, stock=0.6)
        beds = {w["ward_id"]: w["hospital_beds_required"]["demand"] for w in a["wards"]}
        assert all(w["demand"] == beds[w["ward_id"]] for w in o["wards"])
        supply = {c["city"]: c["hospital_beds_required"]["supply"] for c in a["cities"]}
        assert all(c["regional_supply_scenario"] == supply[c["city"]] for c in o["cities"])   # reported side by side, never added
        assert o["totals"]["capacity"] == get(service=service, stock=0.9)["totals"]["capacity"]


def test_determinism():
    assert get(capacity_pct=125) == get(capacity_pct=125)


def test_api_errors():
    for bad in [{"capacity_pct": 301}, {"capacity_pct": -1}, {"override": "GCC_Ward_01"}, {"override": "GCC_Ward_01:-2"},
                {"override": "Nowhere_Ward:3"}, {"override": "GCC_Ward_01:501"}, {"city_pct": "Atlantis:100"}, {"city_pct": "Gazipur:301"},
                {"service": "p99"}, {"horizon": 5}, {"stock": 0.1}, {"origin": "2025-01-06"}, {"origin": "2024-08-06"}]:
        assert client.get("/api/overflow/plan", params={**PEAK, **bad}).status_code == 422, bad
    assert client.get("/api/overflow/plan", params={**PEAK, "city": "Atlantis"}).status_code == 404


def test_in_sample_and_sealed_forecasts_are_refused_for_both_decision_tools():
    for path in ("/api/overflow/plan", "/api/allocation/plan"):
        r = client.get(path, params={**PEAK, "source": "bundle"})                       # 2024 target, model trained through 2024
        assert r.status_code == 422 and "in-sample" in r.json()["detail"]
        assert client.get(path, params={"origin": "2018-06-04", "horizon": 3}).status_code == 422   # before the replay: bundle would be in-sample
        assert client.get(path, params={"origin": "2023-12-18", "horizon": 3}).status_code == 422   # cross-season gap in the replay
        ok = client.get(path, params={"origin": "2024-12-30", "horizon": 3})            # forward forecast into January 2025
        assert ok.status_code == 200 and ok.json()["source"] == "bundle" and ok.json()["target_date"] == "2025-01-20"
    text = json.dumps(get())
    assert "actual" not in text and "y_true" not in text


def test_runs_offline(monkeypatch):
    def no_network(*a, **k):
        raise OSError("network disabled for this test")
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    r = client.get("/api/overflow/plan", params={**PEAK, "capacity_pct": 117, "service": "p90"})
    assert r.status_code == 200 and len(r.json()["wards"]) == 60
