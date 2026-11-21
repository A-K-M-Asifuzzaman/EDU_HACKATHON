"""A* routing on directed, weighted OpenStreetMap road graphs built by scripts/build_geodata.py.

Graph: vertices are intersections and way endpoints; each directed edge points to a road segment whose full geometry is kept, so routes
follow real streets. Weights are segment length (metres, sum of haversine distances along the geometry) or estimated free-flow
travel time (seconds, length / assumed class speed).

Heuristics (both admissible and consistent):
  distance: great-circle (haversine) distance to the target, never more than any road path because each edge is at least as long as
            the great-circle distance between its endpoints and the great-circle distance satisfies the triangle inequality;
  time:     great-circle distance / the fastest speed present in the graph, never more than the true remaining time.
Dijkstra (h = 0) runs on the same graph to verify optimal costs.
"""
from __future__ import annotations

import heapq
import json
from array import array
import math
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

GEO = Path(__file__).resolve().parents[1] / "app_data" / "geo"
R_EARTH = 6371008.8
MAX_SNAP_M = 1000.0
INF = float("inf")


class RoutingError(ValueError):
    pass


class Graph:
    def __init__(self, area: str):
        z = np.load(GEO / f"{area}_graph.npz")
        self.area = area
        self.n = len(z["lat"])
        self.lat, self.lon = z["lat"], z["lon"]
        # compact typed arrays instead of Python lists (about 4x less memory; indexing stays fast)
        self.latr = array("d", np.radians(self.lat))
        self.lonr = array("d", np.radians(self.lon))
        self.cos = array("d", np.cos(np.radians(self.lat)))
        self.indptr = array("i", z["indptr"])
        self.dst = array("i", z["dst"])
        seg = z["seg"]
        self.seg, self.rev = array("i", seg), array("b", z["rev"].astype(np.int8))
        self.w = {"distance": array("d", z["seg_len"].astype(float)[seg]), "time": array("d", z["seg_time"].astype(float)[seg])}
        self.seg_len, self.seg_time = z["seg_len"].astype(float), z["seg_time"].astype(float)
        self.vmax = float(z["seg_speed"].max()) / 3.6                      # m/s, for the admissible time heuristic
        self.gptr, self.glat, self.glon = z["geom_ptr"], z["geom_lat"], z["geom_lon"]
        from scipy.spatial import cKDTree
        self.lat0 = math.radians(float(self.lat.mean()))
        self.tree = cKDTree(self._xy(self.lat, self.lon))

    def _xy(self, lat, lon):
        return np.c_[np.asarray(lon) * math.cos(self.lat0) * 111320.0, np.asarray(lat) * 110540.0]

    def snap(self, lat: float, lon: float) -> tuple[int, float]:
        d, i = self.tree.query(self._xy([lat], [lon])[0])
        if d > MAX_SNAP_M:
            raise RoutingError(f"point is {d:.0f} m from the nearest mapped road (limit {MAX_SNAP_M:.0f} m)")
        return int(i), float(d)

    def h_dist(self, v: int, t: int) -> float:
        dl = self.latr[t] - self.latr[v]
        dn = self.lonr[t] - self.lonr[v]
        a = math.sin(dl / 2) ** 2 + self.cos[v] * self.cos[t] * math.sin(dn / 2) ** 2
        return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(a))) * (1 - 1e-9)   # tiny margin keeps float rounding admissible

    def search(self, s: int, t: int, weight: str = "distance", astar: bool = True, trace: int = 0) -> dict:
        """trace > 0 also returns up to `trace` expanded vertices (evenly sampled, in expansion order) for visualisation."""
        if weight not in self.w:
            raise RoutingError("weight must be 'distance' or 'time'")
        W, indptr, dst = self.w[weight], self.indptr, self.dst
        scale = 1.0 if weight == "distance" else 1.0 / self.vmax
        h = (lambda v: self.h_dist(v, t) * scale) if astar else (lambda v: 0.0)
        t0 = time.perf_counter()
        g = {s: 0.0}
        parent = {s: -1}                                                    # vertex -> directed edge used to reach it
        heap = [(h(s), 0.0, s)]
        closed = set()
        expanded = 0
        order: list[int] = [] if trace else None   # type: ignore[assignment]
        while heap:
            _, gv, v = heapq.heappop(heap)
            if v in closed:
                continue
            if v == t:
                break
            closed.add(v)
            expanded += 1
            if trace:
                order.append(v)
            for e in range(indptr[v], indptr[v + 1]):
                u = dst[e]
                ng = gv + W[e]
                if ng < g.get(u, INF):
                    g[u] = ng
                    parent[u] = e
                    heapq.heappush(heap, (ng + h(u), ng, u))
        ms = (time.perf_counter() - t0) * 1000
        if t not in g:
            return {"found": False, "expanded": expanded, "ms": round(ms, 2)}
        edges = []
        v = t
        while v != s:
            e = parent[v]
            edges.append(e)
            v = self._src(e)
        edges.reverse()
        out = {"found": True, "cost": g[t], "edges": edges, "expanded": expanded, "ms": round(ms, 2)}
        if trace:
            idx = order if len(order) <= trace else [order[int(i * len(order) / trace)] for i in range(trace)]
            out["explored"] = [[round(float(self.lon[v]), 5), round(float(self.lat[v]), 5)] for v in idx]
        return out

    def _src(self, e: int) -> int:
        # source vertex of directed edge e (binary search in indptr)
        lo, hi = 0, self.n
        ip = self.indptr
        while lo < hi:
            mid = (lo + hi) // 2
            if ip[mid + 1] <= e:
                lo = mid + 1
            else:
                hi = mid
        return lo

    def geometry(self, edges: list[int], s: int) -> list[list[float]]:
        if not edges:
            return [[round(float(self.lon[s]), 6), round(float(self.lat[s]), 6)]]
        out: list[list[float]] = []
        for e in edges:
            k = self.seg[e]
            a, b = int(self.gptr[k]), int(self.gptr[k + 1])
            la, lo = self.glat[a:b], self.glon[a:b]
            if self.rev[e]:
                la, lo = la[::-1], lo[::-1]
            pts = [[round(float(x), 6), round(float(y), 6)] for x, y in zip(lo, la)]
            out.extend(pts[1:] if out else pts)
        return out

    def totals(self, edges: list[int]) -> tuple[float, float]:
        segs = [self.seg[e] for e in edges]
        return float(self.seg_len[segs].sum()) if segs else 0.0, float(self.seg_time[segs].sum()) if segs else 0.0

    def nearest_targets(self, s: int, targets: dict[int, list], k: int, weight: str = "time", max_cost: float = 3 * 3600) -> list:
        """Multi-target Dijkstra: settle vertices in cost order until k target vertices are reached (true network nearest)."""
        W, indptr, dst = self.w[weight], self.indptr, self.dst
        g = {s: 0.0}
        parent = {s: -1}
        heap = [(0.0, s)]
        closed, found = set(), []
        while heap and len(found) < k:
            gv, v = heapq.heappop(heap)
            if v in closed:
                continue
            if gv > max_cost:
                break
            closed.add(v)
            if v in targets:
                found.append((v, gv))
            for e in range(indptr[v], indptr[v + 1]):
                u = dst[e]
                ng = gv + W[e]
                if ng < g.get(u, INF):
                    g[u] = ng
                    parent[u] = e
                    heapq.heappush(heap, (ng, u))
        out = []
        for v, cost in found:
            edges = []
            x = v
            while x != s:
                e = parent[x]
                edges.append(e)
                x = self._src(e)
            edges.reverse()
            out.append((v, cost, edges))
        return out


_FILES: dict = {}


def _load(name: str):
    """Read a built data file once; a missing file is not cached, so data built after startup is picked up."""
    if name not in _FILES:
        p = GEO / name
        if not p.exists():
            return None
        _FILES[name] = json.loads(p.read_text())
    return _FILES[name]


def manifest() -> dict:
    return _load("manifest.json") or {}


@lru_cache(maxsize=None)
def graph(area: str) -> Graph:
    if area not in manifest().get("areas", {}):
        raise RoutingError(f"unknown routing area '{area}'")
    return Graph(area)


def area_for(lat: float, lon: float) -> str:
    for area, spec in manifest().get("areas", {}).items():
        s, w, n, e = spec["bbox"]
        if s <= lat <= n and w <= lon <= e:
            return area
    raise RoutingError("this location is outside the mapped routing areas (Greater Dhaka and Chattogram)")


def facilities() -> dict:
    return _load("facilities.geojson") or {"type": "FeatureCollection", "features": []}


def _route_summary(G: Graph, res: dict, s: int, weight: str) -> dict:
    length, secs = G.totals(res["edges"])
    return {"optimised_for": weight, "distance_m": round(length, 1), "est_time_s": round(secs, 1), "cost": round(res["cost"], 3),
            "segments": len(res["edges"]), "expanded": res["expanded"], "ms": res["ms"],
            "geometry": {"type": "LineString", "coordinates": G.geometry(res["edges"], s)}}


def insight(G: Graph, s: int, t: int, weight: str = "distance", cap: int = 2500) -> dict:
    """A* and Dijkstra exploration fronts for the same query (bounded sample), for the Algorithm Insight view."""
    a, d = G.search(s, t, weight, True, cap), G.search(s, t, weight, False, cap)
    return {"weight": weight, "astar": {"expanded": a["expanded"], "ms": a["ms"], "explored": a.get("explored", [])},
            "dijkstra": {"expanded": d["expanded"], "ms": d["ms"], "explored": d.get("explored", [])},
            "cost_equal": a["found"] and d["found"] and abs(a["cost"] - d["cost"]) <= 1e-6 * max(1.0, d["cost"]), "sample_cap": cap}


def route(from_lat: float, from_lon: float, to_lat: float, to_lon: float, verify: bool = True, with_insight: bool = False) -> dict:
    a1, a2 = area_for(from_lat, from_lon), area_for(to_lat, to_lon)
    if a1 != a2:
        raise RoutingError("origin and destination are in different routing areas")
    G = graph(a1)
    s, ds = G.snap(from_lat, from_lon)
    t, dt = G.snap(to_lat, to_lon)
    out = {"area": a1, "origin": {"snap_m": round(ds, 1), "node": s}, "destination": {"snap_m": round(dt, 1), "node": t}, "routes": {}, "verification": {}}
    for weight, name in (("distance", "shortest"), ("time", "fastest")):
        res = G.search(s, t, weight, astar=True)
        if not res["found"]:
            raise RoutingError("no route exists between these points in the directed road graph")
        out["routes"][name] = _route_summary(G, res, s, weight)
        if verify:
            ref = G.search(s, t, weight, astar=False)
            out["verification"][name] = {"dijkstra_cost": round(ref["cost"], 3), "astar_cost": round(res["cost"], 3),
                                         "equal": abs(ref["cost"] - res["cost"]) <= 1e-6 * max(1.0, ref["cost"]),
                                         "dijkstra_expanded": ref["expanded"], "dijkstra_ms": ref["ms"], "astar_expanded": res["expanded"], "astar_ms": res["ms"]}
    if with_insight:
        out["insight"] = insight(G, s, t, "distance")
    return out


def nearest_facilities(lat: float, lon: float, k: int = 5, kind: str | None = "hospital") -> dict:
    area = area_for(lat, lon)
    G = graph(area)
    s, ds = G.snap(lat, lon)
    targets: dict[int, list] = {}
    for f in facilities()["features"]:
        p = f["properties"]
        if p.get("area") == area and (kind is None or p["kind"] == kind) and p.get("snap_m", 1e9) <= 300:
            targets.setdefault(p["graph_node"], []).append(f)
    t0 = time.perf_counter()
    hits = G.nearest_targets(s, targets, k, "time")
    ms = (time.perf_counter() - t0) * 1000
    items = []
    for v, cost, edges in hits:
        length, secs = G.totals(edges)
        for f in targets[v]:
            items.append({"facility": f, "est_time_s": round(secs, 1), "distance_m": round(length, 1),
                          "geometry": {"type": "LineString", "coordinates": G.geometry(edges, s)}})
    return {"area": area, "origin": {"snap_m": round(ds, 1)}, "results": items[:k], "search_ms": round(ms, 1), "method": "multi-target Dijkstra on estimated travel time"}


def benchmark(pairs_per_area: int = 100, seed: int = 2026) -> dict:
    """A* vs Dijkstra on random origin-destination vertex pairs, both weights. Written to app_data/geo/benchmark.json."""
    import random
    import statistics as st
    rows = []
    for area in manifest()["areas"]:
        G, rng = graph(area), random.Random(seed)
        for _ in range(pairs_per_area):
            s, t = rng.randrange(G.n), rng.randrange(G.n)
            for w in ("distance", "time"):
                a, d = G.search(s, t, w, True), G.search(s, t, w, False)
                rows.append({"area": area, "weight": w, "equal": a["found"] and d["found"] and abs(a["cost"] - d["cost"]) <= 1e-6 * max(1.0, d["cost"]),
                             "astar_ms": a["ms"], "dijkstra_ms": d["ms"], "ratio": d["expanded"] / max(1, a["expanded"])})
    out = {"pairs": len(rows), "equal_costs": sum(r["equal"] for r in rows), "astar_ms_median": round(st.median(r["astar_ms"] for r in rows), 1),
           "dijkstra_ms_median": round(st.median(r["dijkstra_ms"] for r in rows), 1), "expanded_ratio_median": round(st.median(r["ratio"] for r in rows), 1),
           "by_weight": {w: {"astar_ms_median": round(st.median(r["astar_ms"] for r in rows if r["weight"] == w), 1),
                             "dijkstra_ms_median": round(st.median(r["dijkstra_ms"] for r in rows if r["weight"] == w), 1),
                             "expanded_ratio_median": round(st.median(r["ratio"] for r in rows if r["weight"] == w), 1)} for w in ("distance", "time")},
           "method": "random vertex pairs in each area's largest strongly connected component; costs compared with relative tolerance 1e-6",
           "machine_note": "timings measured on the development laptop (pure Python)"}
    (GEO / "benchmark.json").write_text(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["bench"]:
        print(json.dumps(benchmark(), indent=2))
