#!/usr/bin/env python3
"""Build the healthcare-facility database and directed road graphs from OpenStreetMap (ODbL) via the Overpass API.

    python scripts/build_geodata.py            # fetch (cached in .cache/osm) and build app_data/geo/
    python scripts/build_geodata.py --offline  # rebuild from the cached raw responses only

Outputs (all derived from OpenStreetMap, (c) OpenStreetMap contributors, ODbL 1.0):
  app_data/geo/facilities.geojson   hospitals and clinics, normalised, with provenance and verification status
  app_data/geo/<city>_graph.npz     directed weighted road graph (contracted at intersections, geometry kept)
  app_data/geo/manifest.json        source timestamps, counts, assumptions, licence

Queries are few (two per city), sequential, cached, and retried with backoff, in line with Overpass fair use.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app_data" / "geo"
RAW = ROOT / ".cache" / "osm"
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = {"User-Agent": "dengueshield-build/1.0 (hackathon research; low volume)"}

# Routing areas (south, west, north, east). Greater Dhaka is one graph so routes can cross Dhaka / Narayanganj / Gazipur.
AREAS = {
    "greater_dhaka": {"label": "Greater Dhaka (Dhaka, Narayanganj, Gazipur)", "bbox": (23.57, 90.33, 24.08, 90.56),
                      "cities": ["Dhaka", "Narayanganj", "Gazipur"]},
    "chattogram": {"label": "Chattogram", "bbox": (22.24, 91.75, 22.42, 91.88), "cities": ["Chattogram"]},
}
CITY_BBOX = {"Dhaka": (23.66, 90.33, 23.90, 90.48), "Narayanganj": (23.57, 90.46, 23.66, 90.56),
             "Gazipur": (23.90, 90.34, 24.08, 90.48), "Chattogram": (22.24, 91.75, 22.42, 91.88)}

# Assumed free-flow urban speeds (km/h) by road class. No live or historical traffic data are used; these are planning estimates.
SPEED_KMH = {"motorway": 50, "trunk": 40, "primary": 30, "secondary": 25, "tertiary": 22, "unclassified": 18, "residential": 15,
             "living_street": 8, "service": 10}
HIGHWAYS = "|".join(list(SPEED_KMH) + [f"{k}_link" for k in ("motorway", "trunk", "primary", "secondary", "tertiary")])


def overpass(query: str, offline: bool) -> dict:
    key = hashlib.sha256(query.encode()).hexdigest()[:20]
    path = RAW / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    if offline:
        raise SystemExit(f"--offline but no cached response for query {key}")
    last = None
    for attempt in range(8):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            r = httpx.post(url, data={"data": query}, headers=UA, timeout=httpx.Timeout(150.0, connect=10.0))
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                d = r.json()
                RAW.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(d))
                return d
            last = f"HTTP {r.status_code}"
        except httpx.HTTPError as e:
            last = repr(e)
        wait = min(120, 15 * 2 ** (attempt // 2))
        print(f"  overpass {url} failed ({last}); retrying in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise SystemExit(f"Overpass unavailable: {last}")


def hav(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def direction(tags: dict) -> tuple[bool, bool]:
    """(forward allowed, backward allowed) for motor vehicles."""
    ow = tags.get("oneway", "")
    if ow in ("yes", "true", "1"):
        return True, False
    if ow in ("-1", "reverse"):
        return False, True
    if ow == "no":
        return True, True
    if tags.get("junction") in ("roundabout", "circular") or tags.get("highway") in ("motorway", "motorway_link"):
        return True, False
    return True, True


def usable(tags: dict) -> bool:
    if tags.get("area") == "yes" or tags.get("oneway") == "reversible":
        return False
    if tags.get("access") in ("no", "private") or tags.get("motor_vehicle") in ("no", "private") or tags.get("motorcar") == "no":
        return False
    return True


def build_graph(area: str, spec: dict, offline: bool) -> dict:
    s, w, n, e = spec["bbox"]
    q = f'[out:json][timeout:200];way["highway"~"^({HIGHWAYS})$"]({s},{w},{n},{e});(._;>;);out body qt;'
    d = overpass(q, offline)
    coords = {el["id"]: (el["lat"], el["lon"]) for el in d["elements"] if el["type"] == "node"}
    ways = [el for el in d["elements"] if el["type"] == "way" and usable(el.get("tags", {}))]
    use = defaultdict(int)
    for wy in ways:
        nds = [x for x in wy["nodes"] if x in coords]
        for i, x in enumerate(nds):
            use[x] += 2 if i in (0, len(nds) - 1) else 1
    # contract: a vertex is any way endpoint or node shared by two or more ways
    vid: dict[int, int] = {}
    seg_u, seg_v, seg_len, seg_speed, seg_fwd, seg_bwd, geom_ptr, glat, glon = [], [], [], [], [], [], [0], [], []
    for wy in ways:
        tags = wy.get("tags", {})
        hw = tags["highway"].replace("_link", "")
        spd = SPEED_KMH.get(hw, 15)
        fwd, bwd = direction(tags)
        nds = [x for x in wy["nodes"] if x in coords]
        if len(nds) < 2:
            continue
        start = 0
        for i in range(1, len(nds)):
            if use[nds[i]] >= 2 or i == len(nds) - 1:
                piece = nds[start:i + 1]
                lat = np.array([coords[x][0] for x in piece])
                lon = np.array([coords[x][1] for x in piece])
                length = float(hav(lat[:-1], lon[:-1], lat[1:], lon[1:]).sum())
                if length > 0:
                    for x in (piece[0], piece[-1]):
                        vid.setdefault(x, len(vid))
                    seg_u.append(vid[piece[0]]); seg_v.append(vid[piece[-1]]); seg_len.append(length); seg_speed.append(spd)
                    seg_fwd.append(fwd); seg_bwd.append(bwd)
                    glat.extend(lat.tolist()); glon.extend(lon.tolist()); geom_ptr.append(len(glat))
                start = i
    nv = len(vid)
    vlat = np.zeros(nv); vlon = np.zeros(nv)
    for osm_id, k in vid.items():
        vlat[k], vlon[k] = coords[osm_id]
    seg_u, seg_v = np.array(seg_u), np.array(seg_v)
    seg_fwd, seg_bwd = np.array(seg_fwd), np.array(seg_bwd)
    # keep the largest strongly connected component so every snapped origin/destination is mutually reachable
    rows = np.concatenate([seg_u[seg_fwd], seg_v[seg_bwd]]); cols = np.concatenate([seg_v[seg_fwd], seg_u[seg_bwd]])
    ncomp, lab = connected_components(csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(nv, nv)), directed=True, connection="strong")
    big = np.bincount(lab).argmax()
    keep_v = lab == big
    keep_s = keep_v[seg_u] & keep_v[seg_v]
    remap = -np.ones(nv, int); remap[keep_v] = np.arange(keep_v.sum())
    # directed adjacency (CSR): each usable direction of each kept segment
    src, dst, sid, rev = [], [], [], []
    new_sid = -np.ones(len(seg_u), int); new_sid[keep_s] = np.arange(keep_s.sum())
    for k in np.flatnonzero(keep_s):
        a, b = remap[seg_u[k]], remap[seg_v[k]]
        if seg_fwd[k]:
            src.append(a); dst.append(b); sid.append(new_sid[k]); rev.append(False)
        if seg_bwd[k]:
            src.append(b); dst.append(a); sid.append(new_sid[k]); rev.append(True)
    order = np.lexsort((dst, src))
    src, dst, sid, rev = (np.array(x)[order] for x in (src, dst, sid, rev))
    nkv = int(keep_v.sum())
    indptr = np.zeros(nkv + 1, np.int32); np.add.at(indptr, src + 1, 1); indptr = np.cumsum(indptr).astype(np.int32)
    gp = np.array(geom_ptr)
    keep_idx = np.flatnonzero(keep_s)
    new_ptr = [0]; nlat, nlon = [], []
    for k in keep_idx:
        nlat.extend(glat[gp[k]:gp[k + 1]]); nlon.extend(glon[gp[k]:gp[k + 1]]); new_ptr.append(len(nlat))
    seg_len_k = np.array(seg_len)[keep_s]; speed_k = np.array(seg_speed)[keep_s]
    g = {"lat": vlat[keep_v].astype(np.float64), "lon": vlon[keep_v].astype(np.float64), "indptr": indptr, "dst": dst.astype(np.int32),
         "seg": sid.astype(np.int32), "rev": rev.astype(bool), "seg_len": seg_len_k.astype(np.float32),
         "seg_time": (seg_len_k / (speed_k / 3.6)).astype(np.float32), "seg_speed": speed_k.astype(np.float32),
         "geom_ptr": np.array(new_ptr, np.int64), "geom_lat": np.array(nlat, np.float32), "geom_lon": np.array(nlon, np.float32)}
    OUT.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT / f"{area}_graph.npz", **g)
    oneway_share = float((~(seg_fwd & seg_bwd))[keep_s].mean())
    return {"label": spec["label"], "bbox": spec["bbox"], "cities": spec["cities"], "osm_timestamp": d["osm3s"]["timestamp_osm_base"],
            "raw_ways": len(ways), "vertices": nkv, "directed_edges": int(len(dst)), "segments": int(keep_s.sum()),
            "dropped_vertices_outside_largest_scc": int(nv - nkv), "strong_components": int(ncomp), "oneway_segment_share": round(oneway_share, 3),
            "total_road_km": round(float(seg_len_k.sum()) / 1000, 1), "max_speed_kmh": float(speed_k.max())}


def clean_phone(v: str | None) -> list[str]:
    if not v:
        return []
    out = []
    for p in v.replace(",", ";").split(";"):
        p = p.strip()
        digits = "".join(c for c in p if c.isdigit() or c == "+")
        if len(digits.lstrip("+")) >= 5:
            out.append(p)
    return out[:3]


def city_of(lat: float, lon: float) -> str | None:
    for city, (s, w, n, e) in CITY_BBOX.items():
        if s <= lat <= n and w <= lon <= e:
            return city
    return None


def build_facilities(offline: bool) -> tuple[list, dict]:
    # one combined request for all four cities (lighter on the shared Overpass service than one request per city)
    parts = "".join(f'nwr["amenity"~"^(hospital|clinic)$"]({s},{w},{n},{e});nwr["healthcare"~"^(hospital|clinic)$"]({s},{w},{n},{e});'
                    for s, w, n, e in CITY_BBOX.values())
    d = overpass(f"[out:json][timeout:90];({parts});out center tags meta;", offline)
    stamp = d["osm3s"]["timestamp_osm_base"]
    feats, seen = [], set()
    for el in d["elements"]:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        t = el.get("tags", {})
        lat = el.get("lat", el.get("center", {}).get("lat")); lon = el.get("lon", el.get("center", {}).get("lon"))
        city = city_of(lat, lon) if lat is not None and lon is not None else None
        if city is None:
            continue
        kind = "hospital" if "hospital" in (t.get("amenity"), t.get("healthcare")) else "clinic"
        addr = ", ".join(t[k] for k in ("addr:housenumber", "addr:street", "addr:suburb", "addr:city") if t.get(k))
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "properties": {"id": f"osm:{el['type']}/{el['id']}", "name": t.get("name:en") or t.get("name"), "name_bn": t.get("name:bn"),
                                     "kind": kind, "city": city, "operator": t.get("operator"), "operator_type": t.get("operator:type"),
                                     "emergency": t.get("emergency"), "speciality": t.get("healthcare:speciality"),
                                     "beds_tagged": t.get("beds"), "phone": clean_phone(t.get("phone") or t.get("contact:phone")),
                                     "website": t.get("website") or t.get("contact:website"), "address": addr or None,
                                     "opening_hours": t.get("opening_hours"), "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
                                     "last_edited": el.get("timestamp"), "source": "OpenStreetMap",
                                     "verification": "community-mapped (OpenStreetMap); not verified by DGHS"}})
    return dedupe(feats), {c: stamp for c in CITY_BBOX}


def dedupe(feats: list) -> list:
    """OSM often maps one facility twice (a point and a building outline). Merge records with the same normalised name within 200 m,
    keeping the one with the most filled fields. Different names are never merged."""
    def norm(n):
        return "".join(ch for ch in (n or "").lower() if ch.isalnum())
    def filled(f):
        return sum(bool(v) for v in f["properties"].values())
    out: list = []
    for f in sorted(feats, key=filled, reverse=True):
        n = norm(f["properties"]["name"]); lon, lat = f["geometry"]["coordinates"]
        dup = n and any(norm(g["properties"]["name"]) == n and float(hav(lat, lon, g["geometry"]["coordinates"][1], g["geometry"]["coordinates"][0])) < 200 for g in out)
        if dup:
            continue
        out.append(f)
    return out


def snap_facilities(feats: list, areas: dict):
    from scipy.spatial import cKDTree
    for area, spec in AREAS.items():
        z = np.load(OUT / f"{area}_graph.npz")
        lat0 = math.radians(float(np.mean(z["lat"])))
        tree = cKDTree(np.c_[z["lon"] * math.cos(lat0) * 111320.0, z["lat"] * 110540.0])
        for f in feats:
            if f["properties"]["city"] not in spec["cities"]:
                continue
            lon, lat = f["geometry"]["coordinates"]
            dist, idx = tree.query([lon * math.cos(lat0) * 111320.0, lat * 110540.0])
            f["properties"].update({"area": area, "graph_node": int(idx), "snap_m": round(float(dist), 1)})


def main():
    offline = "--offline" in sys.argv
    manifest = {"source": "OpenStreetMap via the Overpass API", "license": "Open Database License (ODbL) 1.0",
                "attribution": "(c) OpenStreetMap contributors", "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "speed_assumptions_kmh": SPEED_KMH,
                "assumptions": ["Speeds are assumed free-flow urban estimates by road class; no live or historical traffic data are used.",
                                "One-way rules follow OSM oneway/junction tags for motor vehicles; access=no/private roads are excluded.",
                                "Only the largest strongly connected part of each road network is kept, so every snapped point can reach every other.",
                                "Facility data are community-mapped; names, phones and tagged beds may be outdated. No live availability, capacity or doctor rosters exist."],
                "areas": {}}
    for area, spec in AREAS.items():
        print(f"[roads] {area}")
        manifest["areas"][area] = build_graph(area, spec, offline)
        print("   ", {k: v for k, v in manifest["areas"][area].items() if k in ("vertices", "directed_edges", "total_road_km")})
    print("[facilities]")
    feats, stamps = build_facilities(offline)
    snap_facilities(feats, AREAS)
    feats.sort(key=lambda f: (f["properties"]["city"], f["properties"]["kind"], f["properties"]["name"] or "~"))
    (OUT / "facilities.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")))
    kinds = defaultdict(int)
    for f in feats:
        kinds[f"{f['properties']['city']}/{f['properties']['kind']}"] += 1
    manifest["facilities"] = {"count": len(feats), "dedup_rule": "same normalised name within 200 m merged (OSM point + outline duplicates)", "by_city_kind": dict(kinds), "osm_timestamps": stamps,
                              "named": sum(1 for f in feats if f["properties"]["name"]),
                              "with_phone": sum(1 for f in feats if f["properties"]["phone"]),
                              "far_from_road_over_300m": sum(1 for f in feats if f["properties"].get("snap_m", 0) > 300)}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("   ", manifest["facilities"])


if __name__ == "__main__":
    main()
