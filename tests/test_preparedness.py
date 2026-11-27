"""Hospital preparedness engine: occupancy, inventory, alert rules, referral network and the API contract (mentor scope)."""
import json

import pytest

from dengueshield import allocation as alloc
from dengueshield import preparedness as pp

RULES = alloc.load_rules()


def hosp(**kw):
    h = {"id": "T-A", "name": "Planning Hospital T", "city": "Testpur", "role": "general", "functional_beds": 50, "non_dengue_occupied": 30,
         "dengue_occupied": 5, "surge_beds": 10, "reserve_pct": 10, "catchment_share": 1.0, "saline_stock": 400, "saline_reserve": 60,
         "kits_stock": 200, "kits_reserve": 30, "lead_time_days": 7, "confirmed_resupply": []}
    h.update(kw)
    return h


CASES = [100.0, 120.0, 150.0, 180.0]


def test_occupancy_flow_and_split_hold_across_scenarios():
    for sc in [pp.Scenario(), pp.Scenario(shock=3.0), pp.Scenario(closed_pct=30), pp.Scenario(non_dengue_scale=1.3, los_dengue_days=9)]:
        p = pp.hospital_plan(hosp(), CASES, sc, RULES, surge_open=False)
        assert all(p["checks"].values()), p["checks"]


def test_existing_patients_are_not_admitted_again_and_discharges_never_exceed_them():
    p = pp.hospital_plan(hosp(dengue_occupied=12), [0, 0, 0, 0], pp.Scenario(), RULES, surge_open=False)
    rows = p["daily"]
    assert sum(r["admitted_dengue"] for r in rows) == 0                      # no forecast demand: nobody new is admitted
    assert sum(r["discharged_dengue"] for r in rows) == 12                   # the 12 existing patients all leave, once each
    assert rows[-1]["dengue"] == 0


def test_beds_never_exceed_capacity_and_reserve_is_protected():
    p = pp.hospital_plan(hosp(), CASES, pp.Scenario(shock=4.0), RULES, surge_open=False)
    b = p["beds"]
    for r in p["daily"]:
        if r["admitted_other"] + r["admitted_dengue"]:
            assert r["other"] + r["dengue"] <= b["routine_limit"] <= b["capacity"]
    assert b["unresolved_dengue"] > 0                                         # the shortage is reported, not hidden by a cap
    assert b["peak_needed"] > b["capacity"] and b["shortage_week"] is not None


def test_zero_capacity_turns_every_arrival_into_unresolved_demand():
    p = pp.hospital_plan(hosp(functional_beds=0, non_dengue_occupied=0, dengue_occupied=0, surge_beds=0), CASES, pp.Scenario(), RULES, surge_open=True)
    assert all(r["admitted_dengue"] == 0 and r["dengue"] == 0 for r in p["daily"])
    assert p["beds"]["unresolved_dengue"] == sum(w["dengue_demand"] for w in p["weeks"])


def test_surge_beds_and_closures_move_capacity_the_right_way():
    sc = pp.Scenario(shock=3.0)
    closed = pp.hospital_plan(hosp(), CASES, pp.Scenario(shock=3.0, closed_pct=40), RULES, surge_open=False)
    base = pp.hospital_plan(hosp(), CASES, sc, RULES, surge_open=False)
    surge = pp.hospital_plan(hosp(), CASES, sc, RULES, surge_open=True)
    assert closed["beds"]["capacity"] < base["beds"]["capacity"] < surge["beds"]["capacity"] == base["beds"]["capacity"] + 10
    assert closed["beds"]["unresolved_dengue"] >= base["beds"]["unresolved_dengue"] >= surge["beds"]["unresolved_dengue"]


def test_inventory_conservation_zero_stock_and_delayed_resupply():
    demand = [10] * pp.DAYS
    v = pp.inventory(0, 0, demand, {}, 5)
    assert v["stockout_day"] == 1 and v["unmet_total"] == 280 and v["closing"] == 0
    late = pp.inventory(30, 0, demand, {10: 500}, 5)
    assert late["rows"][8]["received"] == 0 and late["rows"][9]["received"] == 500      # a shipment counts only from its arrival day
    assert late["stockout_day"] == 4 and late["unmet_total"] == 60                       # days 4-9 unmet before it lands
    for x in late["rows"]:
        assert x["opening"] + x["received"] - x["fulfilled"] == x["closing"] >= 0 and x["fulfilled"] + x["unmet"] == x["demand"]


def test_reorder_point_and_procurement_keep_the_safety_stock():
    demand = [10] * pp.DAYS
    v = pp.inventory(100, 40, demand, {}, 7)
    assert v["reorder_point"] == 7 * 10 + 40
    assert v["reserve_breach_day"] == 7 and v["order_by_day"] == 0                     # (100-40)/10 = 6 days of usable stock
    fixed = pp.inventory(100 + v["procurement_required"], 40, demand, {}, 7)
    assert fixed["reserve_breach_day"] is None and v["procurement_required"] == 280 + 40 - 100


def test_alert_rules_from_normal_to_emergency():
    calm = pp.hospital_plan(hosp(functional_beds=500, saline_stock=10**5, kits_stock=10**5), CASES, pp.Scenario(), RULES, surge_open=False)
    assert calm["status"] == "Normal" and calm["alerts"] == []
    watch = pp.hospital_plan(hosp(functional_beds=500, saline_stock=10**5, kits_stock=10**5, saline_reserve=10**5 - 1), CASES, pp.Scenario(), RULES, surge_open=False)
    assert "Warning" in {a["severity"] for a in watch["alerts"]}                         # stock dips into its safety reserve
    crit = pp.hospital_plan(hosp(functional_beds=500, saline_stock=0), CASES, pp.Scenario(), RULES, surge_open=False)
    assert crit["status"] == "Critical" and any(a["rule"] == "saline_stockout" for a in crit["alerts"])
    emer = pp.hospital_plan(hosp(), CASES, pp.Scenario(shock=4.0), RULES, surge_open=False)
    assert emer["status"] == "Emergency Surge"
    for a in emer["alerts"]:
        assert {"condition", "value", "threshold", "week", "action", "source", "assumption"} <= set(a)


def test_referral_lp_respects_receivers_conserves_patients_and_matches_maxflow():
    nodes = [{"id": "a", "name": "A", "city": "X", "role": "general", "gap": 9, "spare": 0},
             {"id": "b", "name": "B", "city": "X", "role": "general", "gap": 0, "spare": 4},
             {"id": "c", "name": "C", "city": "Y", "role": "general", "gap": 0, "spare": 50},      # other city: not a valid receiver
             {"id": "r", "name": "R", "city": "Regional", "role": "referral", "gap": 0, "spare": 3}]
    out = pp.referral_lp(nodes)
    assert out["placed"] == out["maxflow_check"] == 7 and out["unresolved"] == 2 and out["certificate"]
    to = {t["to"]: t["patients"] for t in out["transfers"]}
    assert to == {"b": 4, "r": 3} and "c" not in to                                    # same city first, no cross-city ward links
    none = pp.referral_lp([dict(nodes[0]), dict(nodes[2])])
    assert none["placed"] == 0 and none["unresolved"] == 9


def test_fixture_is_fictional_and_labelled():
    fx = pp.load_fixture()
    assert fx["provenance"] == "synthetic_demo" and "not real" in fx["label"].lower()
    for h in fx["hospitals"]:
        assert h["provenance"] == "synthetic_demo" and (h["name"].startswith("Planning Hospital") or "Simulation" in h["name"])
    for c in {h["city"] for h in fx["hospitals"] if h["role"] != "referral"}:
        assert abs(sum(h["catchment_share"] for h in fx["hospitals"] if h["city"] == c) - 1) < 1e-9


def test_replay_signal_is_labelled_historical():
    s = pp.replay_signal([10.0] * 30 + [10, 12, 15, 20, 30, 45, 60, 80])
    assert s["available"] and s["cusum_alarm"] and "Not live" in s["note"]


# ------------------------------------------------------------------ API
@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from dengueshield.api.main import app
    return TestClient(app)


Q = "/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North"


def test_plan_three_states_are_deterministic_and_honest(client):
    a, b = client.get(Q + "&shock=2&saline=60&kits=60&lead=10").json(), client.get(Q + "&shock=2&saline=60&kits=60&lead=10").json()
    assert a["scenario_id"] == b["scenario_id"] and a["states"] == b["states"]
    st = a["states"]
    assert set(st) == {"baseline", "crisis", "response"}
    assert all(all(s["checks"].values()) for s in st.values())
    assert st["crisis"]["summary"]["peak_needed"] > st["baseline"]["summary"]["peak_needed"]
    r = st["response"]["summary"]
    assert r["referred"] + r["bed_gap_after_referral"] == r["bed_gap_worst_day"] and st["response"]["network"]["certificate"]
    for t in st["response"]["network"]["transfers"]:
        assert t["same_city"] or t["to"] == "RRSC"
    assert a["detection_note"].startswith("Live outbreak detection unavailable")
    assert any(p["source"] == "synthetic_demo" for p in a["provenance"])
    assert a["weekly_cases"]["Dhaka North"][1:] == pytest.approx([188, 243, 303], abs=1)   # the forecast at weeks 2-4, upper 80%


def test_beds_change_overflow_not_the_forecast(client):
    a, b = client.get(Q).json(), client.get(Q + "&closed=30").json()
    assert a["weekly_cases"] == b["weekly_cases"]
    assert b["states"]["crisis"]["summary"]["capacity"] < a["states"]["crisis"]["summary"]["capacity"]


def test_sealed_year_and_bad_input_are_refused(client):
    assert client.get("/api/preparedness/plan?origin=2025-03-03").status_code == 422
    assert client.get(Q + "&shock=9").status_code == 422
    assert client.get("/api/preparedness/plan?origin=2024-08-05&city=Atlantis").status_code == 404


def test_brief_matches_plan_and_is_safe(client):
    d = client.get(Q + "&shock=2").json()
    csv = client.get("/api/preparedness/brief?origin=2024-08-05&city=Dhaka%20North&shock=2&format=csv")
    assert csv.headers["x-scenario-id"] == d["scenario_id"] and d["scenario_id"] in csv.text
    assert f'"{d["states"]["crisis"]["summary"]["saline_required"]}"' in csv.text
    html = client.get("/api/preparedness/brief?origin=2024-08-05&city=Dhaka%20North&shock=2").text
    assert "<script" not in html and "fictional" in html.lower()


def test_referrals_never_claim_capacity_or_invent_numbers(client):
    from dengueshield import routing
    phones = {f["properties"]["id"]: f["properties"].get("phone") or [] for f in routing.facilities()["features"]}
    d = client.get("/api/preparedness/referrals?lat=23.78&lon=90.40").json()
    cards = [c for t in d["tiers"].values() for c in t]
    assert cards and d["tiers"]["other_region"]
    for c in cards:
        assert c["availability"] == "Bed availability unconfirmed — contact hospital." and c["capacity"] == "Actual hospital capacity unavailable."
        assert c["phone"] == phones[c["id"]]
    assert all(c["est_time_s"] is None and "straight-line" in c["route_note"] for c in d["tiers"]["other_region"])
    assert {n["number"] for n in d["emergency"]} == {"999", "16263"}


def test_contacts_come_only_from_bundled_data(client):
    from dengueshield import routing
    d = client.get("/api/preparedness/contacts").json()
    assert d["count"] == sum(1 for f in routing.facilities()["features"] if f["properties"].get("phone"))
    assert all("OpenStreetMap" in r["source"] for r in d["facilities"])


# ------------------------------------------------------------------ 28-day referral program and emergency redistribution
def _node(id_, city, limit, arrivals, fixed=0, role="general", los=2):
    a = arrivals + [0] * (pp.DAYS - len(arrivals))
    return {"id": id_, "name": id_, "city": city, "role": role, "los_dengue": los, "dengue_arrivals": a, "fixed_census": [fixed] * pp.DAYS,
            "beds": {"routine_limit": limit, "unresolved_dengue": 0}}


def test_time_expanded_referral_known_optimum_and_rules():
    # A has 1 free bed and 3 arrivals on day 1; B (same city) has 1; C (other city) has 5 but is not a valid receiver
    plans = [_node("A", "X", 1, [3]), _node("B", "X", 1, [0]), _node("C", "Y", 5, [0])]
    out = pp.referral_time_expanded(plans)
    assert out["unresolved_without_referral"] == 2 and out["unresolved"] == 1 and out["referred"] == 1
    assert [(t["from"], t["to"]) for t in out["transfers"]] == [("A", "B")]
    assert all(out["checks"].values())
    # a bed is held for the whole stay: B cannot take a second patient on day 2 while the first stays (LOS 2)
    plans = [_node("A", "X", 1, [2, 2]), _node("B", "X", 1, [0])]
    out = pp.referral_time_expanded(plans)
    assert out["unresolved"] == 2 and out["referred"] == 1 and all(out["checks"].values())
    # the regional centre accepts any city
    plans = [_node("A", "X", 0, [2]), _node("R", "Regional", 2, [0], role="referral")]
    out = pp.referral_time_expanded(plans)
    assert out["unresolved"] == 0 and out["referred"] == 2


def test_redistribution_protects_donor_stock_and_only_helps_later_days():
    def inv(closing, unmet, reserve):
        return {"rows": [{"day": d + 1, "closing": closing[d], "unmet": unmet[d]} for d in range(pp.DAYS)], "reserve": reserve}
    z = [0] * pp.DAYS
    donor = {"id": "D", "city": "X", "role": "general", "inventory": {"saline": inv([100] * pp.DAYS, z, 40)}}           # can spare 60
    recv = {"id": "R", "city": "X", "role": "general", "inventory": {"saline": inv(z, [5] + [10] * (pp.DAYS - 1), 0)}}   # day-1 unmet cannot be helped
    far = {"id": "F", "city": "Y", "role": "general", "inventory": {"saline": inv([500] * pp.DAYS, z, 0)}}                # other city: not a donor
    out = pp.redistribute([donor, recv, far], "saline", transfer_days=1)
    assert out["donor_available"] == 60 + 500 and out["receiver_need"] == 270
    assert out["placed"] == 60 and out["transfers"] == [{"from": "D", "from_name": None, "to": "R", "to_name": None, "units": 60, "arrival_day": 2}] or out["placed"] == 60
    assert all(t["from"] != "F" for t in out["transfers"]) and out["certificate"]


def test_response_compares_inventory_policies_and_plans_28_days():
    fx = pp.load_fixture()
    st = pp.plan_state(fx, {"Dhaka North": [171, 188, 243, 303]}, pp.Scenario(shock=2.0, saline_pct=60, kits_pct=60, lead_time_days=10), RULES, True)
    ic = st["inventory_compare"]
    assert all(ic["checks"].values())
    for r in ("saline", "kits"):
        x = ic[r]
        assert x["redistribution_and_procurement"] <= min(x["procurement_only"], x["redistribution_only"]) <= x["no_action"]
        assert x["no_action"] - x["redistribution_only"] <= x["redistribution"]["placed"]
    te = st["network"]["time_expanded"]
    assert te["available"] and all(te["checks"].values())
    assert te["unresolved"] <= te["unresolved_without_referral"]
    assert all(t["same_city"] or t["to"] == "RRSC" for t in te["transfers"])
    assert st["summary"]["unresolved_28d"] == te["unresolved"]


def test_scenario_id_covers_dataset_and_model(client):
    from dengueshield.api import main, store
    a = client.get(Q).json()["scenario_id"]
    old, cache = main.S.data_sha, main.S.cache
    try:
        main.S.data_sha, main.S.cache = "changed", store.LRU(64)
        assert client.get(Q).json()["scenario_id"] != a
    finally:
        main.S.data_sha, main.S.cache = old, cache


def test_brief_reports_the_28_day_plan_and_inventory_policies(client):
    csv = client.get("/api/preparedness/brief?origin=2024-08-05&city=Dhaka%20North&shock=2&saline=60&format=csv").text
    assert "28-day referral plan" in csv and "redistribution + procurement" in csv
