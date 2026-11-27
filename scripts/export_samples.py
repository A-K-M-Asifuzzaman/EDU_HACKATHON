"""Regenerate the sample dispatch outputs in exports/ (offline; deterministic: the same code and data give the same bytes).

    python scripts/export_samples.py
Scenario: forecast issued 2024-08-05, 3 weeks ahead (upper 80%), 60% stock, 40 crews (optimized, Moderate effect), capacity 120%.
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("DENGUESHIELD_OFFLINE", "1")                     # prove the samples need no network
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient  # noqa: E402

from dengueshield.api.main import app  # noqa: E402

OUT = ROOT / "exports"
SCEN = {"origin": "2024-08-05", "horizon": 3, "stock": 0.6, "crews": 40, "capacity_pct": 120}
WARDS = ["CCC_Ward_03", "DSCC_Ward_04"]
CITY = "Chattogram"


def main():
    c = TestClient(app)
    OUT.mkdir(exist_ok=True)
    written = []

    def put(name, data):
        (OUT / name).write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        written.append(name)

    for w in WARDS:
        j = c.get("/api/dispatch/brief", params={**SCEN, "ward": w}).raise_for_status().json()
        for lang in ("en", "bn"):
            put(f"sms_{w}_{lang}.txt", j["formats"]["sms"][lang]["text"] + "\n")
            put(f"whatsapp_{w}_{lang}.txt", j["formats"]["whatsapp"][lang] + "\n")
            put(f"brief_{w}_{lang}.html", j["formats"]["html"][lang])
        put(f"brief_{w}.pdf", c.get("/api/dispatch/document", params={**SCEN, "kind": "ward", "ward": w, "format": "pdf"}).raise_for_status().content)
        put(f"brief_{w}.json", json.dumps({"scenario": j["scenario"], "brief": j["brief"],
                                           "sms_stats": {k: {x: v for x, v in s.items() if x != "text"} for k, s in j["formats"]["sms"].items()}},
                                          indent=1, ensure_ascii=False) + "\n")
    for fmt in ("html", "pdf"):
        put(f"city_summary_{CITY}.{fmt}", c.get("/api/dispatch/document", params={**SCEN, "kind": "city", "brief_city": CITY, "format": fmt}).raise_for_status().content)
        put(f"briefs_attention_{CITY}.{fmt}", c.get("/api/dispatch/document", params={**SCEN, "kind": "wards", "brief_city": CITY, "format": fmt}).raise_for_status().content)
    print(f"wrote {len(written)} files to {OUT.relative_to(ROOT)}/ for scenario {j['scenario']['id']}")


if __name__ == "__main__":
    main()
