"""Routing correctness: A* optimality vs Dijkstra, admissible heuristics, one-way handling, geometry, snapping and API contracts."""
import math
import random

import numpy as np
import pytest

from dengueshield import routing
from dengueshield.data import RAW_PATH

BUILT = (routing.GEO / "greater_dhaka_graph.npz").exists()


def tiny_graph(tmp_path, monkeypatch):
    """A(0) -> B(1) is one-way; B <-> C(2) and C <-> A are two-way; D(3) is reachable from C only via a one-way C -> D (dead end)."""
    lat = np.array([23.700, 23.700, 23.701, 23.702]); lon = np.array([90.400, 90.401, 90.4005, 90.4005])
    segs = [(0, 1, True, False), (1, 2, True, True), (2, 0, True, True), (2, 3, True, False)]
    def hav(a, b):
        p1, p2 = math.radians(lat[a]), math.radians(lat[b]); dl = p2 - p1; dn = math.radians(lon[b] - lon[a])
        return 2 * routing.R_EARTH * math.asin(math.sqrt(math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dn / 2) ** 2))
    src, dst, sid, rev = [], [], [], []
    for k, (u, v, f, b) in enumerate(segs):
        if f: src.append(u); dst.append(v); sid.append(k); rev.append(False)
        if b: src.append(v); dst.append(u); sid.append(k); rev.append(True)
    o = np.lexsort((dst, src)); src, dst, sid, rev = (np.array(x)[o] for x in (src, dst, sid, rev))
    indptr = np.zeros(5, np.int32); np.add.at(indptr, src + 1, 1); indptr = np.cumsum(indptr).astype(np.int32)
    seg_len = np.array([hav(u, v) for u, v, _, _ in segs], np.float32)
    gptr = np.arange(0, 2 * len(segs) + 1, 2)
    glat = np.array([lat[i] for u, v, _, _ in segs for i in (u, v)], np.float32); glon = np.array([lon[i] for u, v, _, _ in segs for i in (u, v)], np.float32)
    np.savez(tmp_path / "tiny_graph.npz", lat=lat, lon=lon, indptr=indptr, dst=dst.astype(np.int32), seg=sid.astype(np.int32), rev=rev, seg_len=seg_len,
             seg_time=seg_len / (15 / 3.6), seg_speed=np.full(len(segs), 15, np.float32), geom_ptr=gptr, geom_lat=glat, geom_lon=glon)
    monkeypatch.setattr(routing, "GEO", tmp_path)
    return routing.Graph("tiny")


def test_one_way_streets_are_respected(tmp_path, monkeypatch):
    G = tiny_graph(tmp_path, monkeypatch)
    fwd = G.search(0, 1, "distance")
    assert fwd["found"] and len(fwd["edges"]) == 1                                   # A -> B allowed directly
    back = G.search(1, 0, "distance")
    assert back["found"] and len(back["edges"]) == 2 and back["cost"] > fwd["cost"]   # B -> A must detour via C
    assert not G.search(3, 0, "distance")["found"]                                     # D is a dead end: unreachable reported, not faked


def test_route_geometry_follows_segments_in_travel_direction(tmp_path, monkeypatch):
    G = tiny_graph(tmp_path, monkeypatch)
    r = G.search(1, 0, "distance")
    coords = G.geometry(r["edges"], 1)
    assert coords[0] == pytest.approx([G.lon[1], G.lat[1]], abs=1e-5) and coords[-1] == pytest.approx([G.lon[0], G.lat[0]], abs=1e-5)   # float32 geometry (~1 m)
    assert len(coords) == 3                                                            # B -> C -> A, joint point not duplicated


@pytest.mark.skipif(not BUILT, reason="road graphs not built (scripts/build_geodata.py)")
@pytest.mark.parametrize("area", ["greater_dhaka", "chattogram"])
def test_astar_costs_equal_dijkstra_and_heuristics_are_admissible(area):
    G = routing.Graph(area)
    rng = random.Random(11)
    for _ in range(25):
        s, t = rng.randrange(G.n), rng.randrange(G.n)
        for w, scale in (("distance", 1.0), ("time", 1 / G.vmax)):
            a, d = G.search(s, t, w, True), G.search(s, t, w, False)
            assert a["found"] and d["found"]                                           # largest SCC: every pair connected
            assert a["cost"] == pytest.approx(d["cost"], rel=1e-9, abs=1e-6)
            assert G.h_dist(s, t) * scale <= d["cost"] + 1e-6                            # admissible: never overestimates
            assert a["expanded"] <= d["expanded"]


@pytest.mark.skipif(not BUILT, reason="road graphs not built")
def test_reported_distance_matches_route_geometry():
    G = routing.Graph("greater_dhaka")
    r = G.search(10, G.n // 2, "distance")
    c = np.array(G.geometry(r["edges"], 10))
    lon, lat = c[:, 0], c[:, 1]
    p1, p2 = np.radians(lat[:-1]), np.radians(lat[1:])
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon[1:] - lon[:-1]) / 2) ** 2
    assert float((2 * routing.R_EARTH * np.arcsin(np.sqrt(a))).sum()) == pytest.approx(G.totals(r["edges"])[0], rel=2e-3)   # float32 geometry rounding


@pytest.mark.skipif(not BUILT, reason="road graphs not built")
def test_snapping_and_coverage_limits():
    G = routing.Graph("greater_dhaka")
    with pytest.raises(routing.RoutingError):
        G.snap(23.75, 91.5)                                                            # far from any mapped road in the graph
    with pytest.raises(routing.RoutingError, match="outside the mapped routing areas"):
        routing.area_for(24.9, 91.9)                                                   # Sylhet: not covered


@pytest.mark.skipif(not BUILT or not (routing.GEO / "facilities.geojson").exists() or not RAW_PATH.exists(), reason="geodata or CSV missing")
def test_api_routes_to_a_real_facility_and_nearest_is_sorted_by_road_time():
    from fastapi.testclient import TestClient
    from dengueshield.api.main import app
    c = TestClient(app)
    fac = c.get("/api/facilities", params={"city": "Dhaka", "kind": "hospital"}).json()
    assert fac["meta"]["count"] > 0 and "OpenStreetMap" in fac["meta"]["attribution"]
    f = next(x for x in fac["features"] if x["properties"].get("snap_m", 999) < 200)
    r = c.get("/api/route", params={"from_lat": 23.7104, "from_lon": 90.4074, "to_facility": f["properties"]["id"]}).json()
    assert r["verification"]["shortest"]["equal"] and r["verification"]["fastest"]["equal"]
    assert r["routes"]["shortest"]["distance_m"] <= r["routes"]["fastest"]["distance_m"] + 1e-6
    assert r["routes"]["fastest"]["est_time_s"] <= r["routes"]["shortest"]["est_time_s"] + 1e-6
    assert len(r["routes"]["fastest"]["geometry"]["coordinates"]) > 2                 # follows streets, not a straight line
    near = c.get("/api/emergency/nearest", params={"lat": 23.7104, "lon": 90.4074, "k": 5}).json()
    times = [x["est_time_s"] for x in near["results"]]
    assert len(times) == 5 and times == sorted(times)
    assert c.get("/api/route", params={"from_lat": 24.9, "from_lon": 91.9, "to_lat": 23.75, "to_lon": 90.4}).status_code == 422
    assert c.get("/api/route", params={"from_lat": 23.71, "from_lon": 90.40, "to_facility": "osm:node/1; DROP"}).status_code == 422
