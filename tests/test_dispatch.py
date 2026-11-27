"""Stage 4: deterministic ward dispatch. Numbers must equal the Stage 1-3 engines for the same scenario; every format comes from one snapshot.
Strings built inside these tests (SMS samples) are TEST FIXTURES."""
import re
import socket

import pytest
from fastapi.testclient import TestClient

from dengueshield import dispatch as D
from dengueshield import pdfmini
from dengueshield.api import main as M

client = TestClient(M.app)
BASE = {"origin": "2024-08-05", "horizon": 3, "capacity_pct": 120, "crews": 40}
W = "CCC_Ward_03"


def brief(**q):
    r = client.get("/api/dispatch/brief", params={**BASE, "ward": W, **q})
    assert r.status_code == 200, r.text
    return r.json()


def doc(**q):
    r = client.get("/api/dispatch/document", params={**BASE, **q})
    assert r.status_code == 200, r.text
    return r


def test_brief_numbers_equal_the_stage_1_to_3_engines():
    j = brief()
    b = j["brief"]
    a = next(w for w in client.get("/api/allocation/plan", params={**BASE}).json()["wards"] if w["ward_id"] == W)
    o = client.get("/api/overflow/plan", params={**BASE}).json()
    ow = next(w for w in o["wards"] if w["ward_id"] == W)
    v = next(w for w in client.get("/api/intervention/simulate", params={**BASE}).json()["wards"] if w["ward_id"] == W)
    for k, short in (("saline_bags_needed", "saline"), ("diagnostic_kits_needed", "kits"), ("hospital_beds_required", "beds")):
        assert b["resources"][short] == {"required": a[k]["demand"], "allocated": a[k]["allocated"], "short": a[k]["unmet"]}
    assert b["forecast"]["planned_cases"] == a["forecast_cases"] and b["ward"]["risk_tier"] == a["risk_tier"]
    assert (b["hospital"]["bed_demand"], b["hospital"]["illustrative_capacity"], b["hospital"]["without_bed"]) == (ow["demand"], ow["capacity"], ow["unresolved"])
    assert b["hospital"]["transfers_out"] == [{"to_ward": t["to_ward"], "patients": t["patients"]} for t in o["transfers"] if t["from_ward"] == W]
    assert b["crews"]["assigned"] == v["crews"] and b["crews"]["prevented_window"] == v["prevented_window"]


def test_every_format_comes_from_one_snapshot():
    j = brief()
    sid, sha, b = j["scenario"]["id"], j["content_sha256"], j["brief"]
    assert sha == b["content_sha256"] and re.fullmatch(r"S-[0-9a-f]{12}", sid)
    for text in (j["formats"]["sms"]["en"]["text"], j["formats"]["sms"]["bn"]["text"], j["formats"]["whatsapp"]["en"], j["formats"]["whatsapp"]["bn"],
                 j["formats"]["html"]["en"], j["formats"]["html"]["bn"]):
        assert sid in text
    sal = b["resources"]["saline"]
    assert f"saline {sal['allocated']}/{sal['required']}" in j["formats"]["sms"]["en"]["text"]
    assert f"Saline bags: {sal['allocated']} / {sal['required']}" in j["formats"]["whatsapp"]["en"]
    for fmt in ("html", "pdf"):
        r = doc(kind="ward", ward=W, format=fmt)
        assert r.headers["x-scenario-id"] == sid and r.headers["x-content-sha256"] == sha
        assert sid.encode() in r.content and W.encode() in r.content
    assert doc(kind="ward", ward=W, format="html").content.decode() == j["formats"]["html"]["en"]


def test_exports_are_byte_deterministic():
    for q in ({"kind": "ward", "ward": W, "format": "pdf"}, {"kind": "ward", "ward": W, "format": "html", "lang": "bn"},
              {"kind": "city", "brief_city": "Chattogram", "format": "pdf"}, {"kind": "wards", "brief_city": "Chattogram", "format": "pdf"}):
        assert doc(**q).content == doc(**q).content
    assert brief() == brief()


def test_scenario_id_tracks_every_setting_and_not_the_ward():
    sid = brief()["scenario"]["id"]
    assert brief(ward="GCC_Ward_02")["scenario"]["id"] == sid
    for change in ({"stock": 0.5}, {"crews": 41}, {"capacity_pct": 125}, {"effect": 0.31}, {"mode": "stage1"}, {"service": "p90"},
                   {"override": "CCC_Ward_06:7"}, {"risk_weight": 0.6}, {"delay": 2}):
        assert brief(**change)["scenario"]["id"] != sid, change
    m1 = brief(mode="manual", assign=["CCC_Ward_03:2"])["scenario"]["id"]
    assert m1 != brief(mode="manual", assign=["CCC_Ward_03:1"])["scenario"]["id"]


def test_sms_length_reporting():
    assert D.sms_stats("a" * 160) == {"encoding": "GSM-7", "chars": 160, "segments": 1, "per_segment": 160}
    assert D.sms_stats("a" * 161)["segments"] == 2 and D.sms_stats("a" * 306)["segments"] == 2 and D.sms_stats("a" * 307)["segments"] == 3
    assert D.sms_stats("{}")["chars"] == 4                                                       # GSM-7 extension characters count twice
    assert D.sms_stats("ক" * 70) == {"encoding": "UCS-2", "chars": 70, "segments": 1, "per_segment": 70}
    assert D.sms_stats("ক" * 71)["segments"] == 2 and D.sms_stats("a" * 159 + "→")["encoding"] == "UCS-2"
    j = brief()
    en, bn = j["formats"]["sms"]["en"], j["formats"]["sms"]["bn"]
    assert en["encoding"] == "GSM-7" and en == {"text": en["text"], **D.sms_stats(en["text"])}
    assert bn["encoding"] == "UCS-2" and bn["segments"] == D.sms_stats(bn["text"])["segments"]


def test_bangla_rendering():
    j = brief()
    assert "ডেঙ্গুশিল্ড" in j["formats"]["sms"]["bn"]["text"] and "স্যালাইন" in j["formats"]["whatsapp"]["bn"]
    h = doc(kind="ward", ward=W, format="html", lang="bn").content.decode("utf-8")
    assert "<html lang=bn>" in h and "<meta charset=utf-8>" in h and "ওয়ার্ড ডিসপ্যাচ ব্রিফ" in h
    assert client.get("/api/dispatch/document", params={**BASE, "kind": "ward", "ward": W, "format": "pdf", "lang": "bn"}).status_code == 422


def pdf_ok(data: bytes) -> int:
    """Structural check: header, every xref offset points at its object, startxref points at the table. Returns the page count."""
    assert data.startswith(b"%PDF-1.4") and data.rstrip().endswith(b"%%EOF")
    start = int(data[data.rindex(b"startxref") + 9:].split()[0])
    assert data[start:start + 4] == b"xref"
    head = data[start:].split(b"trailer")[0].split(b"\n")
    count = int(head[1].split()[1])
    for i, line in enumerate(head[3:3 + count - 1], 1):
        off = int(line.split()[0])
        assert data[off:].startswith(f"{i} 0 obj".encode()), i
    return int(re.search(rb"/Count (\d+)", data).group(1))


def test_pdf_documents_are_valid():
    assert pdf_ok(doc(kind="ward", ward=W, format="pdf").content) == 1
    assert pdf_ok(doc(kind="city", brief_city="Chattogram", format="pdf").content) >= 1
    multi = doc(kind="wards", brief_city="Chattogram", format="pdf").content
    n = pdf_ok(multi)
    assert n >= 2 and multi.count(b"(Ward dispatch brief: ") == len(doc(kind="wards", brief_city="Chattogram", format="html").text.split('data-ward="')) - 1
    d = pdfmini.Document("t")
    pdfmini.Flow(d, "footer").para("Arrow → dash – Bangla ক (paren)")
    raw = d.render()
    pdf_ok(raw)
    assert b"Arrow -> dash - Bangla ? \\(paren\\)" in raw


def test_html_is_self_contained():
    for q in ({"kind": "ward", "ward": W}, {"kind": "city", "brief_city": "Chattogram"}, {"kind": "wards", "brief_city": "Chattogram"}):
        h = doc(format="html", **q).text
        assert not re.search(r"""(src|href)\s*=\s*["']?https?://""", h) and "@import" not in h and "<script" not in h


def test_multi_ward_and_city_summary_are_consistent():
    s = doc(kind="wards", brief_city="Chattogram", format="html").text
    wards = re.findall(r'data-ward="([^"]+)"', s)
    assert len(wards) == len(set(wards)) and all(w.startswith("CCC_") for w in wards)        # no duplicates, no other city
    a = client.get("/api/allocation/plan", params=BASE).json()
    o = client.get("/api/overflow/plan", params=BASE).json()
    ranked = [w["ward_id"] for w in sorted(a["wards"], key=lambda w: w["rank"]) if w["city"] == "Chattogram"]
    assert wards == [w for w in ranked if w in wards]                                               # priority order
    every = re.findall(r'data-ward="([^"]+)"', doc(kind="wards", brief_city="Chattogram", format="html", scope="all").text)
    assert every == ranked
    summary = doc(kind="city", brief_city="Chattogram", format="html").text
    ac = next(c for c in a["cities"] if c["city"] == "Chattogram")
    oc = next(c for c in o["cities"] if c["city"] == "Chattogram")
    assert f"{ac['saline_bags_needed']['allocated']} allocated of {ac['saline_bags_needed']['demand']} required" in summary
    assert f"{oc['demand']} beds needed, {oc['capacity']} illustrative capacity, {oc['transferred']} transferred" in summary


def test_sealed_year_in_sample_and_invalid_requests():
    bad = [({"origin": "2025-01-06"}, 422), ({"source": "bundle"}, 422), ({"ward": "Nowhere_Ward"}, 404),
           ({"ward": "DSCC_Ward_04", "city": "Chattogram"}, 422), ({"stock": 0.1}, 422)]
    for q, code in bad:
        assert client.get("/api/dispatch/brief", params={**BASE, "ward": W, **q}).status_code == code, q
    for q, code in [({"kind": "ward"}, 422), ({"kind": "city"}, 422), ({"kind": "city", "brief_city": "Atlantis"}, 404),
                    ({"kind": "city", "brief_city": "Gazipur", "city": "Chattogram"}, 422), ({"kind": "city", "brief_city": "Gazipur", "lang": "bn"}, 422),
                    ({"kind": "memo"}, 422)]:
        assert client.get("/api/dispatch/document", params={**BASE, **q}).status_code == code, q
    j = brief()
    text = str(j)
    assert "actual_cases" not in text and "y_true" not in text
    assert j["brief"]["forecast"]["target_week"] <= "2024-12-31" and brief(origin="2024-12-30")["brief"]["forecast"]["source"] == "bundle"


def test_dispatch_runs_offline(monkeypatch):
    def no_network(*a, **k):
        raise OSError("network disabled for this test")
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket.socket, "connect", no_network)
    assert brief(crews=33)["brief"]["crews"]["assigned"] >= 0
    assert doc(kind="city", brief_city="Dhaka North", format="pdf", crews=33).content.startswith(b"%PDF")
