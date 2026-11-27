"""Hospital preparedness and emergency surge engine (mentor scope).

Answers, for a fictional planning network of hospitals, what the forecast means for beds that are already partly full of other
patients, for saline and diagnostic kits, and what to prepare and when. Everything is deterministic integer accounting:

  occupancy:  census[d] = census[d-1] + admitted[d] - discharged[d]   (per category, never above the beds that exist)
  demand:     arrivals[d] = admitted[d] + unresolved[d]                (patients who could not be admitted are never counted as occupying a bed)
  inventory:  closing[d] = opening[d] + received[d] - fulfilled[d],  fulfilled = min(demand, opening + received), unmet kept apart

Inputs that are real: the organizer's synthetic dengue forecast (weekly cases per city at weeks 2-4, origin-safe) and the organizer's
resource multipliers. Inputs that are NOT real: every hospital in `app_data/preparedness/planning_hospitals.json` (provenance
`synthetic_demo`) and every assumption below (provenance `planning_assumption`). No real hospital is given a bed count here.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np

FIXTURE = Path(__file__).resolve().parents[1] / "app_data" / "preparedness" / "planning_hospitals.json"
DAYS = 28                       # four weeks after the forecast origin
WEEKS = 4
SEVERITY = ["Normal", "Watch", "Warning", "Critical", "Emergency Surge"]


@dataclass(frozen=True)
class Scenario:
    """User-adjustable planning assumptions. Scales apply to the fixture's values; nothing here changes the dengue forecast itself
    except `shock` (a hypothetical demand multiplier) and `prevented_share` (an assumed vector-control effect from Stage 3)."""
    shock: float = 1.0                 # dengue demand multiplier (1 = forecast, 2 = +100%)
    non_dengue_scale: float = 1.0      # x existing non-dengue occupancy and non-dengue arrivals
    dengue_occupied_scale: float = 1.0
    closed_pct: float = 0.0            # share of functional beds temporarily closed (staffing, repairs)
    surge_available_pct: float = 100.0 # share of each hospital's configured surge beds that can be opened
    reserve_pct: float | None = None   # protected emergency reserve, % of functional beds (None = fixture value)
    saline_pct: float = 100.0          # opening saline stock as % of the fixture
    kits_pct: float = 100.0
    lead_time_days: int | None = None  # procurement lead time override
    los_dengue_days: int = 5           # planning assumption
    los_other_days: int = 6            # planning assumption
    admission_rate: float | None = None  # dengue admissions per weekly case (None = organizer bed multiplier)
    prevented_share: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)  # assumed share of cases prevented in weeks 1-4

    def key(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def split_days(total: int, days: int = 7) -> list[int]:
    """Spread an integer weekly count over days, exactly (largest remainder, earliest days first)."""
    base, rem = divmod(int(total), days)
    return [base + (1 if i < rem else 0) for i in range(days)]


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


# ------------------------------------------------------------------ occupancy
def _occupancy(functional: int, closed: int, surge: int, reserve: int, other0: int, dengue0: int,
               other_arrivals: list[int], dengue_arrivals: list[int], los_other: int, los_dengue: int, admit_all: bool) -> dict:
    """Daily mixed-patient census. Existing patients leave evenly over their stay; new patients stay exactly their LOS.
    Routine admissions stop when only the protected reserve is left (other patients first, then dengue). With admit_all the
    capacity is ignored: that run measures the beds the demand would need."""
    cap = functional - closed + surge
    limit = cap - reserve
    horizon = DAYS + max(los_other, los_dengue) + 2
    out_o, out_d = [0] * horizon, [0] * horizon
    for i in range(other0):
        out_o[1 + i % los_other] += 1
    for i in range(dengue0):
        out_d[1 + i % los_dengue] += 1
    co, cd = other0, dengue0
    rows = []
    for d in range(1, DAYS + 1):
        do, dd = out_o[d], out_d[d]                    # discharges come from scheduled stays, so never exceed the patients present
        co, cd = co - do, cd - dd
        ao_req, ad_req = other_arrivals[d - 1], dengue_arrivals[d - 1]
        room = 10 ** 9 if admit_all else max(0, limit - co - cd)
        ao = min(ao_req, room)
        room -= ao
        ad = min(ad_req, room)
        co, cd = co + ao, cd + ad
        out_o[d + los_other] += ao
        out_d[d + los_dengue] += ad
        rows.append({"day": d, "other": co, "dengue": cd, "admitted_other": ao, "admitted_dengue": ad, "discharged_other": do,
                     "discharged_dengue": dd, "unresolved_other": ao_req - ao, "unresolved_dengue": ad_req - ad})
    return {"capacity": cap, "limit": limit, "rows": rows}


# ------------------------------------------------------------------ inventory
def inventory(stock0: int, reserve: int, demand: list[int], receipts: dict[int, int], lead: int) -> dict:
    """Daily stock with conservation; unmet demand is kept apart and stock never goes negative. A shipment counts only from its
    arrival day."""
    stock, rows, unmet_total = int(stock0), [], 0
    stockout = breach = None
    for d in range(1, DAYS + 1):
        opening, received = stock, int(receipts.get(d, 0))
        avail = opening + received
        fulfilled = min(demand[d - 1], avail)
        unmet = demand[d - 1] - fulfilled
        stock = avail - fulfilled
        unmet_total += unmet
        if unmet and stockout is None:
            stockout = d
        if stock < reserve and breach is None:
            breach = d
        rows.append({"day": d, "opening": opening, "received": received, "demand": demand[d - 1], "fulfilled": fulfilled,
                     "unmet": unmet, "closing": stock})
    total = sum(demand)
    avg = total / DAYS
    cum_d = np.cumsum(demand)
    cum_r = np.cumsum([int(receipts.get(d, 0)) for d in range(1, DAYS + 1)])
    need = int(max(0, max(cum_d + reserve - stock0 - cum_r)))          # extra units so stock never drops below the reserve
    rop = round_half_up(lead * avg + reserve)                             # dynamic reorder point: lead-time demand + safety stock
    order_by = None if breach is None else breach - lead                  # latest day to order so the shipment lands before the breach
    return {"opening": int(stock0), "reserve": int(reserve), "lead_time_days": lead, "demand_total": int(total), "avg_daily_demand": round(avg, 1),
            "received_total": int(sum(r["received"] for r in rows)), "fulfilled_total": int(sum(r["fulfilled"] for r in rows)),
            "unmet_total": int(unmet_total), "closing": int(stock), "stockout_day": stockout, "reserve_breach_day": breach,
            "reorder_point": rop, "below_reorder_now": stock0 < rop, "days_of_cover": None if avg == 0 else round(stock0 / avg, 1),
            "procurement_required": need, "order_by_day": order_by, "rows": rows}


def week_of(day: int | None) -> int | None:
    return None if day is None else (day - 1) // 7 + 1


# ------------------------------------------------------------------ one hospital
def hospital_plan(h: dict, weekly_cases: list[float], sc: Scenario, rules: dict, surge_open: bool,
                  extra_receipts: dict[str, dict[int, int]] | None = None) -> dict:
    """Plan one planning hospital over four weeks. weekly_cases are the city's cases for weeks 1-4 (week 1 scenario-derived)."""
    rate = sc.admission_rate if sc.admission_rate is not None else rules["hospital_beds_required"]
    functional = int(h["functional_beds"])
    closed = round_half_up(functional * sc.closed_pct / 100)
    surge = round_half_up(h.get("surge_beds", 0) * sc.surge_available_pct / 100) if surge_open else 0
    reserve = math.ceil(functional * (h["reserve_pct"] if sc.reserve_pct is None else sc.reserve_pct) / 100)
    other0 = round_half_up(h["non_dengue_occupied"] * sc.non_dengue_scale)
    dengue0 = round_half_up(h["dengue_occupied"] * sc.dengue_occupied_scale)
    share = float(h.get("catchment_share", 0))
    cases = [c * sc.shock * (1 - p) * share for c, p in zip(weekly_cases, sc.prevented_share)]
    dengue_week = [round_half_up(c * rate) for c in cases]
    other_week = [round_half_up(7 * h["non_dengue_occupied"] * sc.non_dengue_scale / sc.los_other_days)] * WEEKS   # steady inflow
    da = [x for w in dengue_week for x in split_days(w)]
    oa = [x for w in other_week for x in split_days(w)]
    # beds that exist now; existing patients beyond them would be an input error, kept visible rather than clipped
    occ = _occupancy(functional, closed, surge, reserve, other0, dengue0, oa, da, sc.los_other_days, sc.los_dengue_days, False)
    need = _occupancy(functional, closed, surge, reserve, other0, dengue0, oa, da, sc.los_other_days, sc.los_dengue_days, True)
    cap, limit = occ["capacity"], occ["limit"]
    census_need = [r["other"] + r["dengue"] for r in need["rows"]]
    shortage_day = next((d for d, c in enumerate(census_need, 1) if c > cap), None)
    breach_day = next((d for d, c in enumerate(census_need, 1) if c > limit), None)
    peak = max(census_need)
    beds_extra_reserve = max(0, peak - limit)                    # beds to add so the reserve stays protected
    beds_extra_physical = max(0, peak - cap)
    # inventory: the organizer's aggregate multipliers on the hospital's share of cases (all cases, not only admissions)
    lead = int(sc.lead_time_days if sc.lead_time_days is not None else h["lead_time_days"])
    inv = {}
    for res, key, pct in (("saline", "saline_bags_needed", sc.saline_pct), ("kits", "diagnostic_kits_needed", sc.kits_pct)):
        weekly = [round_half_up(c * rules[key]) for c in cases]
        demand = [x for w in weekly for x in split_days(w)]
        rec: dict[int, int] = {}
        for s in h.get("confirmed_resupply", []):
            rec[int(s["day"])] = rec.get(int(s["day"]), 0) + int(s.get(res, 0))
        for day, qty in ((extra_receipts or {}).get(res) or {}).items():
            rec[int(day)] = rec.get(int(day), 0) + int(qty)
        stock0 = round_half_up(h[f"{res}_stock"] * pct / 100)
        inv[res] = inventory(stock0, int(h[f"{res}_reserve"]), demand, rec, lead)
    weeks = []
    for w in range(WEEKS):
        rs, ns = occ["rows"][7 * w:7 * w + 7], need["rows"][7 * w:7 * w + 7]
        weeks.append({"week": w + 1, "basis": "scenario-derived (between observed week 0 and forecast week 2)" if w == 0 else f"forecast week {w + 1}",
                      "dengue_demand": dengue_week[w], "other_arrivals": other_week[w],
                      "admitted_dengue": sum(r["admitted_dengue"] for r in rs), "admitted_other": sum(r["admitted_other"] for r in rs),
                      "discharged": sum(r["discharged_other"] + r["discharged_dengue"] for r in rs),
                      "unresolved_dengue": sum(r["unresolved_dengue"] for r in rs), "unresolved_other": sum(r["unresolved_other"] for r in rs),
                      "end_other": rs[-1]["other"], "end_dengue": rs[-1]["dengue"],
                      "peak_needed": max(r["other"] + r["dengue"] for r in ns), "saline_demand": sum(r["demand"] for r in inv["saline"]["rows"][7 * w:7 * w + 7]),
                      "kits_demand": sum(r["demand"] for r in inv["kits"]["rows"][7 * w:7 * w + 7]),
                      "saline_closing": inv["saline"]["rows"][7 * w + 6]["closing"], "kits_closing": inv["kits"]["rows"][7 * w + 6]["closing"]})
    out = {"id": h["id"], "name": h["name"], "city": h["city"], "role": h.get("role", "general"), "provenance": "synthetic_demo",
           "beds": {"functional": functional, "closed": closed, "surge_open": surge, "surge_configured": int(h.get("surge_beds", 0)),
                    "capacity": cap, "reserve": reserve, "routine_limit": limit, "other_now": other0, "dengue_now": dengue0,
                    "free_now": cap - other0 - dengue0, "peak_needed": peak, "extra_beds_to_protect_reserve": beds_extra_reserve,
                    "extra_beds_physical": beds_extra_physical, "shortage_day": shortage_day, "shortage_week": week_of(shortage_day),
                    "reserve_breach_day": breach_day, "reserve_breach_week": week_of(breach_day),
                    "unresolved_dengue": sum(r["unresolved_dengue"] for r in occ["rows"]),
                    "unresolved_other": sum(r["unresolved_other"] for r in occ["rows"])},
           "inventory": inv, "weeks": weeks, "daily": occ["rows"], "daily_needed": [r["other"] + r["dengue"] for r in need["rows"]]}
    out["checks"] = _checks(out, occ, other0, dengue0, oa, da)
    out["alerts"] = alerts(out)
    out["status"] = max((a["severity"] for a in out["alerts"]), key=SEVERITY.index, default="Normal")
    return out


def _checks(h: dict, occ: dict, other0: int, dengue0: int, oa: list[int], da: list[int]) -> dict:
    """Independent re-derivation of the accounting identities on the computed rows."""
    rows, co, cd, ok_flow, ok_cap, ok_split = occ["rows"], other0, dengue0, True, True, True
    for r, a_o, a_d in zip(rows, oa, da):
        ok_flow &= (co + r["admitted_other"] - r["discharged_other"] == r["other"]) and (cd + r["admitted_dengue"] - r["discharged_dengue"] == r["dengue"])
        ok_split &= (r["admitted_other"] + r["unresolved_other"] == a_o) and (r["admitted_dengue"] + r["unresolved_dengue"] == a_d)
        ok_cap &= (r["admitted_other"] + r["admitted_dengue"] == 0) or (r["other"] + r["dengue"] <= occ["capacity"])
        co, cd = r["other"], r["dengue"]
    inv_ok = all(all(x["opening"] + x["received"] - x["fulfilled"] == x["closing"] and x["closing"] >= 0 and x["fulfilled"] + x["unmet"] == x["demand"]
                     for x in v["rows"]) for v in h["inventory"].values())
    return {"occupancy_flow": bool(ok_flow), "arrivals_split": bool(ok_split), "admissions_within_beds": bool(ok_cap), "inventory_conservation": bool(inv_ok)}


# ------------------------------------------------------------------ dynamic thresholds
def alerts(h: dict) -> list[dict]:
    """Operational planning rules (not clinical triage, not official warning levels). Each rule names its condition and value."""
    b, out = h["beds"], []

    def add(rule, sev, cond, value, threshold, day, why, action, source="engine (synthetic planning network)"):
        out.append({"rule": rule, "severity": sev, "condition": cond, "value": value, "threshold": threshold, "day": day,
                    "week": week_of(day), "explanation": why, "action": action, "source": source, "assumption": "planning assumption"})

    if b["shortage_day"] is not None:
        sev = "Emergency Surge" if b["peak_needed"] > b["functional"] - b["closed"] + b["surge_configured"] else "Critical"
        add("beds_physical", sev, "patients needing a bed exceed the beds that exist", b["peak_needed"], b["capacity"], b["shortage_day"],
            "Projected concurrent patients (other illnesses plus dengue) exceed the open beds" + (" even with every configured surge bed" if sev == "Emergency Surge" else ""),
            f"Open surge beds and arrange referrals for about {b['extra_beds_physical']} patients before week {b['shortage_week']}")
    if b["reserve_breach_day"] is not None:
        add("beds_reserve", "Warning", "patients needing a bed reach the protected emergency reserve", b["peak_needed"], b["routine_limit"], b["reserve_breach_day"],
            "Routine admissions would have to use beds kept free for emergencies",
            f"Prepare {b['extra_beds_to_protect_reserve']} extra functional beds before week {week_of(b['reserve_breach_day'])}")
    for res, label in (("saline", "saline bags"), ("kits", "diagnostic kits")):
        v = h["inventory"][res]
        if v["stockout_day"] is not None:
            add(f"{res}_stockout", "Critical", f"{label} run out", v["unmet_total"], 0, v["stockout_day"],
                f"Demand exceeds stock plus confirmed deliveries; {v['unmet_total']} {label} unmet over four weeks",
                f"Order {v['procurement_required']} {label}" + ("; the order is already late for the breach" if (v["order_by_day"] or 0) <= 0 else f" by day {v['order_by_day']}"))
        elif v["reserve_breach_day"] is not None:
            add(f"{res}_reserve", "Warning", f"{label} fall below the safety stock", v["reserve"], v["reserve"], v["reserve_breach_day"],
                "Stock would dip into the safety reserve before resupply", f"Order {v['procurement_required']} {label} by day {max(0, v['order_by_day'] or 0)}")
        elif v["below_reorder_now"]:
            add(f"{res}_reorder", "Watch", f"{label} at or below the dynamic reorder point", v["opening"], v["reorder_point"], 1,
                "Stock covers less than lead-time demand plus safety stock", f"Start procurement of {label} now")
    return out


def rank(sev: str) -> int:
    return SEVERITY.index(sev)


# ------------------------------------------------------------------ referral network (illustrative facilities only)
def referral_lp(nodes: list[dict]) -> dict:
    """Concurrent bed gap at the network's worst day. Senders: beds needed above the routine limit. Receivers: free beds below
    their own routine limit. Edges: same city, or any city to the regional referral centre. Stage 1 maximises patients placed
    (an LP on a bipartite transport polytope, so the optimum is integral); stage 2, at that total, prefers same-city receivers and
    then balances utilisation. Cross-checked against an independent max-flow."""
    from scipy.optimize import linprog
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import maximum_flow

    snd = [n for n in nodes if n["gap"] > 0]
    rcv = [n for n in nodes if n["spare"] > 0]
    edges = [(i, j) for i, s in enumerate(snd) for j, r in enumerate(rcv)
             if s["id"] != r["id"] and (s["city"] == r["city"] or r["role"] == "referral")]
    total_gap = sum(n["gap"] for n in snd)
    if not edges:
        return {"transfers": [], "placed": 0, "gap": total_gap, "unresolved": total_gap, "maxflow_check": 0, "certificate": True}
    m = len(edges)
    A, b = [], []
    for i, s in enumerate(snd):
        A.append([1.0 if e[0] == i else 0.0 for e in edges]); b.append(s["gap"])
    for j, r in enumerate(rcv):
        A.append([1.0 if e[1] == j else 0.0 for e in edges]); b.append(r["spare"])
    res1 = linprog(-np.ones(m), A_ub=A, b_ub=b, bounds=[(0, None)] * m, method="highs")
    placed = int(round(-res1.fun))
    cost = [1.0 if snd[i]["city"] == rcv[j]["city"] else 3.0 for i, j in edges]
    res2 = linprog(cost, A_ub=A, b_ub=b, A_eq=[[1.0] * m], b_eq=[placed], bounds=[(0, None)] * m, method="highs")
    x = np.rint(res2.x if res2.success else res1.x).astype(int)
    # independent check: max flow source -> senders -> receivers -> sink
    S, T = 0, 1 + len(snd) + len(rcv)
    rows, cols, caps = [], [], []
    for i, s in enumerate(snd):
        rows.append(S); cols.append(1 + i); caps.append(s["gap"])
    for j, r in enumerate(rcv):
        rows.append(1 + len(snd) + j); cols.append(T); caps.append(r["spare"])
    big = int(total_gap + 1)
    for i, j in edges:
        rows.append(1 + i); cols.append(1 + len(snd) + j); caps.append(big)
    g = csr_matrix((np.array(caps, dtype=np.int32), (rows, cols)), shape=(T + 1, T + 1))
    mf = int(maximum_flow(g, S, T).flow_value)
    transfers = [{"from": snd[i]["id"], "from_name": snd[i]["name"], "to": rcv[j]["id"], "to_name": rcv[j]["name"], "patients": int(v),
                  "same_city": snd[i]["city"] == rcv[j]["city"]} for (i, j), v in zip(edges, x) if v > 0]
    sent = {s["id"]: sum(t["patients"] for t in transfers if t["from"] == s["id"]) for s in snd}
    got = {r["id"]: sum(t["patients"] for t in transfers if t["to"] == r["id"]) for r in rcv}
    cert = (sum(t["patients"] for t in transfers) == placed == mf and all(sent[s["id"]] <= s["gap"] for s in snd)
            and all(got[r["id"]] <= r["spare"] for r in rcv))
    return {"transfers": transfers, "placed": placed, "gap": total_gap, "unresolved": total_gap - placed, "maxflow_check": mf, "certificate": bool(cert)}


# ------------------------------------------------------------------ one scenario state for a set of cities
def plan_state(fx: dict, city_cases: dict[str, list[float]], sc: Scenario, rules: dict, response: bool) -> dict:
    """Plan every planning hospital of the given cities plus the regional referral centre. With response=True: open surge beds,
    place procurement orders today (they arrive after the lead time), then refer the remaining bed gap through the network."""
    hs = [h for h in fx["hospitals"] if h["city"] in city_cases or h.get("role") == "referral"]
    plans = []
    for h in hs:
        cases = city_cases.get(h["city"], [0.0] * WEEKS)
        p = hospital_plan(h, cases, sc, rules, surge_open=response)
        if response:
            lead = p["inventory"]["saline"]["lead_time_days"]
            orders = {res: {min(DAYS, max(1, lead)): p["inventory"][res]["procurement_required"]}
                      for res in ("saline", "kits") if p["inventory"][res]["procurement_required"] > 0}
            if orders:
                p = hospital_plan(h, cases, sc, rules, surge_open=True, extra_receipts=orders)
                p["orders"] = {res: {"quantity": q, "arrival_day": d} for res, v in orders.items() for d, q in v.items()}
        plans.append(p)
    # worst day of the network: the day with the largest total bed gap
    gaps = [sum(max(0, p["daily_needed"][d] - p["beds"]["routine_limit"]) for p in plans) for d in range(DAYS)]
    worst = int(np.argmax(gaps)) if any(gaps) else int(np.argmax([sum(p["daily_needed"][d] for p in plans) for d in range(DAYS)]))
    nodes = [{"id": p["id"], "name": p["name"], "city": p["city"], "role": p["role"], "needed": p["daily_needed"][worst],
              "limit": p["beds"]["routine_limit"], "capacity": p["beds"]["capacity"],
              "gap": max(0, p["daily_needed"][worst] - p["beds"]["routine_limit"]),
              "spare": max(0, p["beds"]["routine_limit"] - p["daily_needed"][worst])} for p in plans]
    network = referral_lp(nodes) if response else {"transfers": [], "placed": 0, "gap": sum(n["gap"] for n in nodes),
                                                     "unresolved": sum(n["gap"] for n in nodes), "maxflow_check": None, "certificate": True}
    network.update({"worst_day": worst + 1, "worst_week": week_of(worst + 1), "nodes": nodes})
    tot = lambda f: sum(f(p) for p in plans if p["role"] != "referral")
    summary = {"functional": tot(lambda p: p["beds"]["functional"]), "capacity": tot(lambda p: p["beds"]["capacity"]),
               "reserve": tot(lambda p: p["beds"]["reserve"]), "other_now": tot(lambda p: p["beds"]["other_now"]),
               "dengue_now": tot(lambda p: p["beds"]["dengue_now"]), "free_now": tot(lambda p: p["beds"]["free_now"]),
               "peak_needed": tot(lambda p: p["beds"]["peak_needed"]), "extra_beds_to_protect_reserve": tot(lambda p: p["beds"]["extra_beds_to_protect_reserve"]),
               "extra_beds_physical": tot(lambda p: p["beds"]["extra_beds_physical"]),
               "unresolved_dengue": tot(lambda p: p["beds"]["unresolved_dengue"]),
               "saline_required": tot(lambda p: p["inventory"]["saline"]["procurement_required"]),
               "kits_required": tot(lambda p: p["inventory"]["kits"]["procurement_required"]),
               "saline_unmet": tot(lambda p: p["inventory"]["saline"]["unmet_total"]), "kits_unmet": tot(lambda p: p["inventory"]["kits"]["unmet_total"]),
               "bed_gap_worst_day": network["gap"], "referred": network["placed"], "bed_gap_after_referral": network["unresolved"],
               "first_shortage_week": min((p["beds"]["shortage_week"] for p in plans if p["beds"]["shortage_week"]), default=None),
               "first_reserve_breach_week": min((p["beds"]["reserve_breach_week"] for p in plans if p["beds"]["reserve_breach_week"]), default=None),
               "first_saline_stockout_week": min((week_of(p["inventory"]["saline"]["stockout_day"]) for p in plans if p["inventory"]["saline"]["stockout_day"]), default=None),
               "first_kits_stockout_week": min((week_of(p["inventory"]["kits"]["stockout_day"]) for p in plans if p["inventory"]["kits"]["stockout_day"]), default=None),
               "status": max((p["status"] for p in plans), key=rank, default="Normal")}
    return {"hospitals": plans, "network": network, "summary": summary,
            "checks": {k: all(p["checks"][k] for p in plans) for k in plans[0]["checks"]} if plans else {}}


def actions(base: dict, crisis: dict, resp: dict) -> list[dict]:
    """Deterministic preparation checklist; every item is tied to a computed number of the crisis or response state."""
    s, r, out = crisis["summary"], resp["summary"], []

    def add(what, qty, when, why, src):
        out.append({"action": what, "quantity": qty, "when": when, "why": why, "trigger": src})

    if s["extra_beds_to_protect_reserve"]:
        add("Prepare additional functional beds", s["extra_beds_to_protect_reserve"], f"before week {s['first_reserve_breach_week']}",
            "Projected patients needing a bed exceed the beds left after the protected reserve", "beds_reserve")
    surge = sum(p["beds"]["surge_open"] for p in resp["hospitals"])
    if surge:
        add("Open configured surge beds", surge, f"before week {s['first_shortage_week'] or s['first_reserve_breach_week'] or 1}",
            "Surge beds reduce the bed gap before any referral", "beds_physical")
    if r["referred"]:
        add("Coordinate referrals inside the planning network (confirm with receiving hospitals)", r["referred"], f"week {resp['network']['worst_week']}",
            "Receivers with free beds below their own reserve exist", "network")
    if r["bed_gap_after_referral"]:
        add("Escalate: bed gap remains after surge beds and referrals", r["bed_gap_after_referral"], f"week {resp['network']['worst_week']}",
            "No modelled option closes the remaining gap; it needs capacity outside this network", "network")
    for res, label in (("saline", "saline bags"), ("kits", "diagnostic kits")):
        q = s[f"{res}_required"]
        if q:
            late = [p for p in crisis["hospitals"] if (p["inventory"][res]["order_by_day"] or 1) <= 0]
            add(f"Order {label}", q, "now (already late for at least one hospital)" if late else "within the reorder window",
                f"Stock plus confirmed deliveries fall below the safety stock; procurement lead time applies", f"{res}_reserve")
        if r[f"{res}_unmet"]:
            add(f"Expect {label} shortfall until the order arrives", r[f"{res}_unmet"], "until delivery",
                "Orders placed today still arrive after the first stockout", f"{res}_stockout")
    add("Confirm emergency transport contacts (999, hospital numbers)", None, "now", "Referrals need transport; availability is not known to the system", "contacts")
    return out


def scenario_id(payload: dict) -> str:
    return "P-" + hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:12]


# ------------------------------------------------------------------ outbreak signal on historical replay data (never live)
def replay_signal(series: list[float], k: float = 0.5, h: float = 4.0, lam: float = 0.3) -> dict:
    """EWMA and one-sided CUSUM on standardized weekly cases, baseline = the 26 weeks before the last 8. Historical replay only."""
    x = np.asarray(series, dtype=float)
    if len(x) < 34:
        return {"available": False, "reason": "not enough history"}
    base, recent = x[-34:-8], x[-8:]
    mu, sd = float(base.mean()), float(base.std(ddof=1)) or 1.0
    z = (recent - mu) / sd
    cus, ew, cs, es = 0.0, 0.0, [], []
    for v in map(float, z):
        cus = max(0.0, cus + v - k); ew = lam * v + (1 - lam) * ew
        cs.append(round(cus, 2)); es.append(round(ew, 2))
    return {"available": True, "baseline_mean": round(mu, 1), "baseline_sd": round(sd, 1), "last_week": float(recent[-1]),
            "z_last": round(float(z[-1]), 2), "cusum": cs, "ewma": es, "cusum_alarm": bool(cs[-1] > h), "ewma_alarm": bool(es[-1] > 2.0),
            "threshold_cusum": h, "note": "Computed on the organizer's historical (synthetic) series up to the forecast origin. Not live detection."}
