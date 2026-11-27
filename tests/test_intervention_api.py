"""Problem 3 (onsite): vector-control simulator API: forecasts, crew deployment modes, resource and hospital impacts, leakage and offline
safety. Requests here use the real local API; manual crew assignments are TEST FIXTURES, not recommendations."""
import json
import socket

import pandas as pd
from fastapi.testclient import TestClient

from dengueshield import allocation as A
from dengueshield import overflow as O
from dengueshield.api import main as M

client = TestClient(M.app)
PEAK = {"origin": "2024-08-05", "horizon": 3}


def sim(**q):
    r = client.get("/api/intervention/simulate", params={**PEAK, **q})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- API: forecasts, horizons, modes
def test_baselines_are_the_origin_safe_forecasts_at_each_horizon():
    j = sim()
    assert j["horizons"] == [2, 3, 4] and set(j["sources"].values()) == {"replay"}
    for h in (2, 3, 4):
        fc = M.forecast_frame(PEAK["origin"], h, M.src_default(PEAK["origin"], h))
        assert abs(j["totals"]["by_horizon"][str(h)]["baseline"] - float(fc.expected_cases.sum())) < 1e-3                # output rounded to 3 decimals
        assert j["target_dates"][str(h)] == str(fc.target_date.iloc[0])
    t = j["totals"]
    assert abs(t["prevented_window"] - sum(t["by_horizon"][h]["prevented"] for h in ("2", "3", "4"))) < 2e-3
    for w in j["wards"]:
        assert abs(w["prevented_window"] - sum(x["prevented"] for x in w["by_horizon"].values())) < 2e-3
        for x in w["by_horizon"].values():
            assert x["prevented_low"] <= x["prevented"] <= x["prevented_high"] and x["scenario"] >= 0


def test_zero_crews_changes_nothing_downstream():
    j = sim(crews=0)
    assert j["totals"]["prevented_window"] == 0 and j["totals"]["crews"]["assigned"] == 0
    for r, x in j["resources"]["totals"].items():
        assert x["scenario_demand"] == x["baseline_demand"] and x["demand_saving"] == 0
    assert j["hospital"]["totals"]["baseline"] == j["hospital"]["totals"]["scenario"]


def test_optimized_mode_is_certified_and_beats_or_ties_other_deployments():
    j = sim(crews=25)
    t = j["totals"]
    assert t["crews"]["assigned"] + t["crews"]["unassigned"] == 25
    assert t["weakest_assigned_gain"] >= t["best_unused_gain"]                              # no swap of one crew can improve the plan
    assert t["compare"]["optimized"] >= t["compare"]["stage1_rule"]
    m = sim(mode="manual", crews=25, assign=["DSCC_Ward_04:3", "GCC_Ward_01:2"])
    assert m["totals"]["prevented_window"] <= t["prevented_window"] + 1e-9
    assert {w["ward_id"]: w["crews"] for w in m["wards"] if w["crews"]} == {"DSCC_Ward_04": 3, "GCC_Ward_01": 2}


def test_stage1_mode_uses_the_supply_allocation_crews():
    j = sim(mode="stage1", crews=17)
    a = client.get("/api/allocation/plan", params={**PEAK, "crews": 17}).json()
    assert {w["ward_id"]: w["crews"] for w in j["wards"]} == {w["ward_id"]: w["crews_assigned"] for w in a["wards"]}


def test_roi_ranking_is_prevented_cases_per_crew():
    roi = sim(crews=30)["roi"]
    assert [r["rank"] for r in roi] == list(range(1, len(roi) + 1))
    per = [r["per_crew"] for r in roi]
    assert per == sorted(per, reverse=True)
    for r in roi:
        assert abs(r["per_crew"] - r["prevented_window"] / r["crews"]) < 2e-3


def test_maximum_crew_budget_is_capped_per_ward():
    j = sim(crews=1000, max_crews_per_ward=3)
    t = j["totals"]["crews"]
    assert t["assigned"] <= 3 * 60 and t["assigned"] + t["unassigned"] == 1000
    assert all(w["crews"] <= 3 for w in j["wards"])


# ---------------------------------------------------------------- downstream: resources and hospital
def test_resource_demand_changes_follow_the_dataset_rule_at_the_planning_horizon():
    j = sim(crews=30)
    rules = A.load_rules()
    r3 = {w["ward_id"]: w["by_horizon"]["3"]["reduction"] for w in j["wards"]}
    fc = M.forecast_frame(PEAK["origin"], 3, "replay").set_index("ward_id")
    for res in A.RESOURCES:
        base = int(A.demand(fc.upper_80, rules[res]).sum())
        assert j["resources"]["totals"][res]["baseline_demand"] == base
        x = j["resources"]["totals"][res]
        assert x["demand_saving"] == x["baseline_demand"] - x["scenario_demand"] >= 0
        assert x["scenario_unmet"] <= x["baseline_unmet"]
    plan = client.get("/api/allocation/plan", params={**PEAK, "stock": 0.6}).json()
    for c, p in zip(j["resources"]["cities"], plan["cities"]):
        for res in A.RESOURCES:
            assert c[res]["supply"] == p[res]["supply"]                                       # same stock: nothing created by the scenario
    w = next(x for x in j["wards"] if x["crews"])
    assert w["saline"]["scenario"] == int(A.demand([fc.at[w["ward_id"], "upper_80"] * (1 - r3[w["ward_id"]])], rules["saline_bags_needed"])[0])


def test_hospital_overflow_is_recomputed_with_the_stage2_capacity():
    j = sim(crews=40, capacity_pct=120)
    o = client.get("/api/overflow/plan", params={**PEAK, "capacity_pct": 120}).json()
    h = j["hospital"]
    assert h["totals"]["baseline"]["demand"] == o["totals"]["demand"] and h["totals"]["baseline"]["unresolved"] == o["totals"]["unresolved"]
    assert h["totals"]["scenario"]["capacity"] == o["totals"]["capacity"]                        # capacity unchanged; Stage 1 beds not added
    assert h["totals"]["scenario"]["demand"] <= h["totals"]["baseline"]["demand"]
    for c in h["cities"]:
        assert c["scenario_unresolved"] == max(0, c["scenario_demand"] - c["capacity"])
    wc = {w["ward_id"]: w["city"] for w in j["wards"]}
    for t in h["transfers"]["scenario"]:
        assert wc[t["from_ward"]] == wc[t["to_ward"]] == t["city"]
    beds = {w["ward_id"]: w["beds"]["scenario"] for w in j["wards"]}
    cap = {w["ward_id"]: w["capacity"] for w in o["wards"]}
    ref = O.plan(pd.DataFrame({"ward_id": list(beds), "city": [wc[w] for w in beds], "demand": list(beds.values()), "capacity": [cap[w] for w in beds]}))
    assert ref["totals"]["unresolved"] == h["totals"]["scenario"]["unresolved"]


def test_city_view_keeps_crews_resources_and_transfers_inside_the_city():
    j = sim(city="Dhaka North", crews=12)
    assert {w["city"] for w in j["wards"]} == {"Dhaka North"} and j["totals"]["crews"]["assigned"] <= 12
    assert [c["city"] for c in j["hospital"]["cities"]] == ["Dhaka North"] == [c["city"] for c in j["resources"]["cities"]]
    full = sim(crews=0)
    part = sim(crews=0, city="Dhaka North")
    assert part["hospital"]["cities"][0] == next(c for c in full["hospital"]["cities"] if c["city"] == "Dhaka North")


def test_determinism():
    assert sim(crews=23, effect=0.4) == sim(crews=23, effect=0.4)


# ---------------------------------------------------------------- safety: leakage, sealed year, offline, errors
def test_sealed_year_in_sample_and_partial_horizons():
    assert client.get("/api/intervention/simulate", params={"origin": "2025-01-06", "horizon": 3}).status_code == 422
    r = client.get("/api/intervention/simulate", params={**PEAK, "source": "bundle"})
    assert r.status_code == 422 and "in-sample" in r.json()["detail"]
    j = sim(origin="2024-12-30")
    assert set(j["sources"].values()) == {"bundle"} and min(j["target_dates"].values()) > "2024-12-31"
    p = sim(origin="2023-12-11", horizon=2)                                                    # h=3 and h=4 cross into 2024: no replay
    assert p["horizons"] == [2] and set(p["horizons_missing"]) == {"3", "4"}
    text = json.dumps(sim())
    assert '"actual_cases"' not in text and '"y_true"' not in text  # no outcome fields (prose may say "counterfactual")


def test_invalid_parameters_are_rejected():
    for bad in [{"effect": 0.81}, {"coverage": 0.01}, {"delay": 4}, {"buildup": 0}, {"sens_low": 1.2}, {"sens_high": 0.9}, {"crews": -1},
                {"mode": "random"}, {"max_crews_per_ward": 11}, {"mode": "manual", "assign": "DSCC_Ward_04:4"},
                {"mode": "manual", "crews": 2, "assign": ["DSCC_Ward_04:2", "GCC_Ward_01:1"]}, {"mode": "manual", "assign": "Nowhere:1"},
                {"mode": "manual", "city": "Gazipur", "assign": "DSCC_Ward_04:1"}, {"capacity_pct": 301}]:
        assert client.get("/api/intervention/simulate", params={**PEAK, **bad}).status_code == 422, bad
    assert client.get("/api/intervention/simulate", params={**PEAK, "city": "Atlantis"}).status_code == 404


def test_runs_offline(monkeypatch):
    def no_network(*a, **k):
        raise OSError("network disabled for this test")
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    r = client.get("/api/intervention/simulate", params={**PEAK, "crews": 33, "effect": 0.25, "delay": 2})
    assert r.status_code == 200 and len(r.json()["wards"]) == 60
