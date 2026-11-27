"""Problem 2 (Phase 2 onsite): hospital surge and cross-ward overflow, inside each city only.

Per ward
  d_i  projected bed demand: Stage 1's bed rule applied to the forecast at the chosen service level (allocation.demand), so both
       problems read one number. Observed target-week beds are never an input.
  c_i  configured local capacity: an illustrative planning scenario. The dataset has no hospital inventory.

Baseline capacity b_i (default scenario). For a forecast issued at origin t, the 90th percentile of the ward's weekly
`hospital_beds_required` over weeks strictly before t (start-of-week convention: week t is not complete at issue time), taken as an
order statistic: sort the n past values and take the k-th smallest, k = ceil(9n/10) (inverted empirical CDF, integer arithmetic). The
result is an observed integer, so no rounding is needed, and weeks on or after t cannot move it.
Scenario controls: c_i = floor(b_i * p / 100 + 1/2) for a capacity percentage p in [0, 300] (whole percent, round half up, exact in
integers), optionally per city; a manual per-ward override then replaces c_i.

Overflow network, one per city (no arc ever joins two cities). Deficit u_i = max(0, d_i - c_i), headroom v_j = max(0, c_j - d_j); a ward is
a sender, a receiver or neither, never both. Arcs: source -> sender i (capacity u_i); sender i -> receiver j (uncapacitated: there are no
distances between the synthetic ward IDs, so every pair in a city is admissible and none is cheaper); receiver j -> sink (capacity v_j).
Objective, lexicographic:
  1. maximise transferred patients T = sum f_ij (maximum flow). T* = min(U, V), U = sum u_i, V = sum v_j: the cut around the source has
     capacity U, the cut around the sink V, and any other cut crosses an uncapacitated arc.
  2. among maximum flows, minimise sum_i r_i^2 + sum_j e_j^2, with r_i = u_i - out_i (unresolved overflow) and e_j = v_j - in_j (headroom
     left): relieve the most overloaded ward first and draw on the ward with the most spare beds first.
With uncapacitated middle arcs any send vector 0 <= out <= u and receive vector 0 <= in <= v with equal totals can be routed, so step 2
splits into two separable convex integer problems under one sum constraint, for which adding one unit at a time where the cost falls
most (largest remaining r, largest remaining e) is exact. Ties, which are common because ward deficits are a few beds, do not change the
objective; they are broken by forecast risk: among equally overloaded wards the one with the higher outbreak probability is relieved first,
among equally spare wards the one with the lower outbreak probability receives first (high-risk wards keep their spare beds), then by
ward_id. Pairs are formed by the north-west-corner rule over senders and receivers sorted by volume, then the same tie order: the same
totals over at most m + n - 1 sender-receiver links.
City identity: unresolved = U - T* = max(0, D - C) with D = sum d_i and C = sum c_i, because U - V = D - C.
tests/test_overflow.py checks optimality against brute force and an independent max-flow (Edmonds-Karp) on small graphs.
"""
from __future__ import annotations

import heapq

import numpy as np
import pandas as pd

MIN_HISTORY_WEEKS = 52
MAX_PCT = 300


def capacity_baseline(history: pd.DataFrame, origin) -> pd.DataFrame:
    """history: ward_id, date, hospital_beds_required (development years only). Returns ward_id, baseline, history_weeks."""
    h = history.loc[history.date < pd.Timestamp(origin), ["ward_id", "hospital_beds_required"]]

    def kth(v: np.ndarray) -> int:
        v = np.sort(v)
        return int(v[(9 * len(v) + 9) // 10 - 1])                                   # k = ceil(9n/10), 1-based

    g = h.groupby("ward_id").hospital_beds_required
    out = pd.DataFrame({"baseline": g.agg(lambda s: kth(s.to_numpy())), "history_weeks": g.size()}).reset_index()
    if out.empty or (out.history_weeks < MIN_HISTORY_WEEKS).any():
        raise ValueError(f"capacity baseline needs at least {MIN_HISTORY_WEEKS} weeks of history before the forecast origin")
    return out


def scale(baseline, pct) -> np.ndarray:
    """floor(b * p / 100 + 1/2), computed in integers (round half up)."""
    b, p = np.asarray(baseline, dtype=np.int64), np.asarray(pct, dtype=np.int64)
    if (b < 0).any() or (p < 0).any() or (p > MAX_PCT).any():
        raise ValueError(f"capacity and percentage must be non-negative; percentage at most {MAX_PCT}")
    return (2 * b * p + 100) // 200


def waterfill(v: np.ndarray, total: int, keys: list) -> np.ndarray:
    """Take `total` units from v, one at a time from the largest remaining entry (ties by the smaller sortable key)."""
    v = np.asarray(v, dtype=np.int64)
    if total < 0 or total > v.sum():
        raise ValueError("cannot take more units than are available")
    took = np.zeros_like(v)
    heap = [(-int(x), keys[i], i) for i, x in enumerate(v) if x > 0]
    heapq.heapify(heap)
    for _ in range(int(total)):
        neg, k, i = heapq.heappop(heap)
        took[i] += 1
        if neg + 1 < 0:
            heapq.heappush(heap, (neg + 1, k, i))
    return took


def pair(out: np.ndarray, inn: np.ndarray, send_keys: list, recv_keys: list) -> list[tuple[int, int, int]]:
    """North-west-corner pairing of equal totals: (sender index, receiver index, patients)."""
    if int(out.sum()) != int(inn.sum()):
        raise ValueError("sent and received totals differ")
    snd = sorted((i for i in range(len(out)) if out[i] > 0), key=lambda i: (-int(out[i]), send_keys[i]))
    rcv = sorted((j for j in range(len(inn)) if inn[j] > 0), key=lambda j: (-int(inn[j]), recv_keys[j]))
    a, b, links, p, q = out.astype(np.int64).copy(), inn.astype(np.int64).copy(), [], 0, 0
    while p < len(snd) and q < len(rcv):
        i, j = snd[p], rcv[q]
        t = int(min(a[i], b[j]))
        links.append((i, j, t))
        a[i] -= t
        b[j] -= t
        p += int(a[i] == 0)
        q += int(b[j] == 0)
    return links


def route_city(keys: list[str], demand, capacity, risk=None) -> dict:
    """Transfers inside one city. risk (outbreak probability per ward, optional) only breaks ties. Returns per-ward arrays and links."""
    d, c = np.asarray(demand, dtype=np.int64), np.asarray(capacity, dtype=np.int64)
    if (d < 0).any() or (c < 0).any():
        raise ValueError("demand and capacity must be non-negative integers")
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate ward")
    r = np.zeros(len(keys)) if risk is None else np.round(np.asarray(risk, dtype=float), 6)
    send_keys = [(-float(r[i]), keys[i]) for i in range(len(keys))]                 # higher risk relieved first
    recv_keys = [(float(r[i]), keys[i]) for i in range(len(keys))]                  # lower risk receives first
    u, v = np.maximum(d - c, 0), np.maximum(c - d, 0)
    t = int(min(u.sum(), v.sum()))
    out, inn = waterfill(u, t, send_keys), waterfill(v, t, recv_keys)
    return {"deficit": u, "headroom": v, "sent": out, "received": inn, "unresolved": u - out, "headroom_after": v - inn,
            "links": pair(out, inn, send_keys, recv_keys)}


def plan(frame: pd.DataFrame) -> dict:
    """frame: one row per ward with ward_id, city, demand, capacity (integers) and optionally p_outbreak (tie-breaks only).
    Cities are routed independently."""
    if frame.ward_id.duplicated().any():
        raise ValueError("one row per ward expected")
    df = frame.sort_values(["city", "ward_id"], ignore_index=True).copy()
    for k in ("deficit", "headroom", "sent", "received", "unresolved", "headroom_after"):
        df[k] = 0
    transfers, cities = [], []
    for city, g in df.groupby("city", sort=True):
        keys = g.ward_id.tolist()
        r = route_city(keys, g.demand.to_numpy(), g.capacity.to_numpy(), g.p_outbreak.to_numpy() if "p_outbreak" in g else None)
        for k in ("deficit", "headroom", "sent", "received", "unresolved", "headroom_after"):
            df.loc[g.index, k] = r[k]
        transfers += [{"city": city, "from_ward": keys[i], "to_ward": keys[j], "patients": n} for i, j, n in r["links"]]
        D, C = int(g.demand.sum()), int(g.capacity.sum())
        occ_before = int(np.minimum(g.demand, g.capacity).sum())
        T = int(r["sent"].sum())
        cities.append({"city": city, "wards": len(g), "demand": D, "capacity": C, "deficit": int(r["deficit"].sum()),
                       "headroom": int(r["headroom"].sum()), "transferred": T, "unresolved": int(r["unresolved"].sum()),
                       "spare_after": int(r["headroom_after"].sum()), "occupied_before": occ_before, "occupied_after": occ_before + T,
                       "utilization_before": round(occ_before / C, 4) if C else None,
                       "utilization_after": round((occ_before + T) / C, 4) if C else None,
                       "demand_to_capacity": round(D / C, 4) if C else None,
                       "senders": int((r["deficit"] > 0).sum()), "receivers": int((r["received"] > 0).sum()), "links": len(r["links"])})
    df["occupied_after"] = np.minimum(df.demand, df.capacity) + df.received
    df["status"] = np.select([df.unresolved > 0, df.deficit > 0, df.received > 0, df.headroom_after > 0],
                             ["unresolved", "relieved", "receiving", "spare"], "balanced")
    totals = {k: int(sum(c[k] for c in cities)) for k in ("demand", "capacity", "deficit", "headroom", "transferred", "unresolved",
                                                          "spare_after", "occupied_before", "occupied_after", "links")}
    C = totals["capacity"]
    totals["utilization_before"] = round(totals["occupied_before"] / C, 4) if C else None
    totals["utilization_after"] = round(totals["occupied_after"] / C, 4) if C else None
    return {"wards": df, "cities": cities, "transfers": transfers, "totals": totals}
