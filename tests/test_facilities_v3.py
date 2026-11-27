"""Healthcare facility classification and emergency search (V3)."""
import json
import random

import pytest

from dengueshield import routing
from dengueshield.facility_class import classify, emergency_eligible

GEO = routing.facilities()["features"]


@pytest.mark.parametrize("name,kind,expected", [
    ("National Veterinary Hospital, Bangabazar Chakkar, Dhaka", "hospital", "veterinary"),
    ("Popular Diagnostic Center", "hospital", "diagnostic"),
    ("City General Hospital and Diagnostic Centre", "hospital", "hospital_general"),
    ("Lab Aid Hospital", "hospital", "hospital_general"),
    ("labaid diagnostic center", "hospital", "diagnostic"),
    ("Ispahani Islamia Eye Institute and Hospital", "hospital", "hospital_specialist"),
    ("Chittagong Diabetic General Hospital", "hospital", "hospital_general"),
    ("Dhaka Dental College And Hospital", "hospital", "hospital_specialist"),
    ("Hairun Nesa Hospital", "hospital", "hospital_general"),               # 'hair' must not match inside a word
    ("Aroggo niketon homio center", "clinic", "clinic_specialist"),
    ("Dhaka Shishu Hospital", "hospital", "hospital_general"),              # children's hospitals stay general (dengue in children)
    ("পপুলার ডায়াগনস্টিক সেন্টার", "hospital", "diagnostic"),
])
def test_known_names_are_classified(name, kind, expected):
    assert classify({"name": name, "kind": kind})["category"] == expected


def test_missing_emergency_tag_is_unknown_not_no():
    c = classify({"name": "Arafat General Hospital", "kind": "hospital"})
    assert c["emergency_status"] == "unknown" and emergency_eligible(c, "hospital")
    no = classify({"name": "Arafat General Hospital", "kind": "hospital", "emergency": "no"})
    assert no["emergency_status"] == "tagged_no" and not emergency_eligible(no, "hospital")
    dental = classify({"name": "Sazzad's Amazing Dental", "kind": "clinic", "emergency": "yes"})
    assert not emergency_eligible(dental, "clinic")                         # speciality emergency, not a general one


def test_original_osm_fields_are_preserved():
    from pathlib import Path
    raw = json.load(open(Path(routing.__file__).resolve().parents[1] / "app_data" / "geo" / "facilities.geojson"))["features"]
    sample = GEO[:50]
    for f in sample:
        p = f["properties"]
        assert {"id", "name", "kind", "emergency", "speciality", "osm_url", "source", "verification"} <= set(p)
        assert {"care", "category", "specialist_reason", "emergency_status"} <= set(p)
    for a, b in zip(raw[:50], sample):                                    # every original field keeps its original value
        assert all(b["properties"][k] == v for k, v in a["properties"].items())


def test_veterinary_hospital_is_never_an_emergency_result():
    r = routing.nearest_facilities(23.7237, 90.4053, 5, "hospital", "emergency")
    names = [it["facility"]["properties"]["name"] for it in r["results"] + r["emergency_tagged"]]
    assert not any("Veterinary" in n for n in names)
    assert r["excluded_counts"].get("veterinary", 0) >= 1
    g = routing.nearest_facilities(23.7237, 90.4053, 5, "hospital", "general")
    assert not any("Veterinary" in it["facility"]["properties"]["name"] for it in g["results"])   # vets are not human healthcare


def test_emergency_results_are_general_human_hospitals_across_sampled_origins():
    hosp = [f for f in GEO if f["properties"]["kind"] == "hospital"]
    random.seed(11)
    checked = 0
    for f in random.sample(hosp, 60):
        lon, lat = f["geometry"]["coordinates"]
        try:
            r = routing.nearest_facilities(lat + 0.003, lon - 0.003, 5, "hospital", "emergency")
        except routing.RoutingError:
            continue
        checked += 1
        for it in r["results"]:
            p = it["facility"]["properties"]
            assert p["care"] == "human" and p["category"] == "hospital_general", p["name"]
        for it in r["emergency_tagged"]:
            assert it["facility"]["properties"]["emergency_status"] == "tagged_yes"
        times = [it["est_time_s"] for it in r["results"]]
        assert times == sorted(times)                                       # ranked by road travel time
    assert checked >= 50


def test_emergency_search_over_a_city_grid_never_returns_ineligible_facilities():
    """Hardening recheck: a regular grid over Dhaka and Chattogram (not only points near hospitals)."""
    checked = 0
    for lat0, lat1, lon0, lon1 in ((23.70, 23.88, 90.34, 90.46), (22.30, 22.40, 91.78, 91.86)):
        for lat in [lat0 + (lat1 - lat0) * i / 4 for i in range(5)]:
            for lon in [lon0 + (lon1 - lon0) * j / 3 for j in range(4)]:
                try:
                    r = routing.nearest_facilities(lat, lon, 5, "hospital", "emergency")
                except routing.RoutingError:
                    continue
                checked += 1
                for it in r["results"] + r["emergency_tagged"]:
                    p = it["facility"]["properties"]
                    assert emergency_eligible(p, p["kind"]) and p["care"] == "human" and p["emergency_status"] != "tagged_no", p["name"]
                    assert p["category"] not in ("veterinary", "diagnostic", "hospital_specialist", "clinic_specialist"), p["name"]
                assert all(it["facility"]["properties"]["emergency_status"] == "tagged_yes" for it in r["emergency_tagged"])
    assert checked >= 30


def test_directory_still_lists_every_facility_including_ineligible_ones():
    from fastapi.testclient import TestClient
    from dengueshield.api.main import app
    with TestClient(app) as c:
        d = c.get("/api/facilities").json()
    cats = {f["properties"]["category"] for f in d["features"]}
    assert d["meta"]["count"] == len(GEO) and {"veterinary", "diagnostic", "hospital_specialist"} <= cats      # general directory access preserved


def test_copilot_facility_tool_carries_the_emergency_classification():
    from dengueshield.api import rag
    out = rag.run_tool(None, "find_health_facilities", {"query": "veterinary", "limit": 10}, {})
    assert out["results"] and "Never describe" in out["emergency_rule"]
    for x in out["results"]:
        assert {"care", "category", "emergency_status", "emergency_eligible"} <= set(x)
        if x["care"] != "human" or x["category"] in ("diagnostic", "hospital_specialist", "clinic_specialist"):
            assert x["emergency_eligible"] is False, x["name"]
    assert any(x["care"] == "veterinary" for x in out["results"])
