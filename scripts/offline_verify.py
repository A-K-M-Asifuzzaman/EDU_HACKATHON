"""Compare DengueShield results online and offline, call by call.

    python scripts/offline_verify.py --base http://127.0.0.1:8000 --write baseline.json     # online run (normal network)
    python scripts/offline_verify.py --base http://127.0.0.1:8765 --compare baseline.json   # same calls with the internet cut off
Each call's response is hashed (canonical JSON, or raw bytes for PDF and HTML). Exit 0 only if every hash matches. Uses only the standard
library and loopback HTTP.
"""
import hashlib
import json
import sys
import time
import urllib.request

Q = "origin=2024-08-05&horizon=3"
CALLS = [
    ("forecast, 2 weeks", "/api/risk/wards?origin=2024-08-05&horizon=2"), ("forecast, 3 weeks", f"/api/risk/wards?{Q}"),
    ("forecast, 4 weeks", "/api/risk/wards?origin=2024-08-05&horizon=4"), ("ward forecast", f"/api/forecast?ward_id=DSCC_Ward_04&{Q}"),
    ("forward forecast into 2025", "/api/allocation/plan?origin=2024-12-30&horizon=3"),
    *[(f"supply at {s}% stock", f"/api/allocation/plan?{Q}&stock={s / 100}") for s in (30, 50, 75, 100)],
    ("supply, Gazipur, 7 crews, p90, h=4, risk 40%, floor 10%",
     "/api/allocation/plan?origin=2024-08-05&horizon=4&city=Gazipur&crews=7&service=p90&risk_weight=0.4&floor=0.1"),
    ("hospital overflow, baseline capacity", f"/api/overflow/plan?{Q}"), ("hospital overflow, +20% beds", f"/api/overflow/plan?{Q}&capacity_pct=120"),
    ("hospital overflow, typed capacity", f"/api/overflow/plan?{Q}&city=Gazipur&override=GCC_Ward_04:9"),
    ("vector control, optimized", f"/api/intervention/simulate?{Q}"),
    ("vector control, strong preset, 40 crews", f"/api/intervention/simulate?{Q}&crews=40&effect=0.45&coverage=0.5&buildup=1"),
    ("vector control, manual", f"/api/intervention/simulate?{Q}&mode=manual&assign=DSCC_Ward_04:2&assign=GCC_Ward_01:1"),
    ("vector control, supply-plan crews", f"/api/intervention/simulate?{Q}&mode=stage1"),
    ("dispatch brief (all text formats)", f"/api/dispatch/brief?{Q}&ward=DSCC_Ward_04&capacity_pct=120&crews=40"),
    ("dispatch PDF, ward", f"/api/dispatch/document?{Q}&kind=ward&ward=DSCC_Ward_04&format=pdf&capacity_pct=120&crews=40"),
    ("dispatch HTML, city summary", f"/api/dispatch/document?{Q}&kind=city&brief_city=Chattogram&format=html&capacity_pct=120&crews=40"),
    ("dispatch PDF, wards needing attention", f"/api/dispatch/document?{Q}&kind=wards&brief_city=Chattogram&format=pdf&capacity_pct=120&crews=40"),
    ("allocation comparison, Gazipur", f"/api/allocation/uncertainty?{Q}&city=Gazipur&reserve_pct=10"),
    ("hospital preparedness, mentor demonstration", "/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North&shock=2&saline=60&kits=60&lead=10&non_dengue=105&crews=20"),
    ("hospital preparedness, all cities", "/api/preparedness/plan?origin=2024-08-05&city=All"),
    ("preparation brief CSV", "/api/preparedness/brief?origin=2024-08-05&city=Dhaka%20North&shock=2&format=csv"),
    ("preparation brief HTML", "/api/preparedness/brief?origin=2024-08-05&city=Dhaka%20North&shock=2&format=html"),
    ("real hospitals by road tier", "/api/preparedness/referrals?lat=23.84&lon=90.395"),
    ("bundled contact directory", "/api/preparedness/contacts"),
]


def fetch(base: str, path: str):
    t = time.perf_counter()
    with urllib.request.urlopen(base + path, timeout=120) as r:
        body, ctype = r.read(), r.headers.get("content-type", "")
    ms = round((time.perf_counter() - t) * 1000, 1)
    if "json" in ctype:
        data = json.loads(body)
        if path.startswith("/api/allocation/uncertainty?"):
            for pool in data["cities"]:
                pool["solver"].pop("runtime_ms")
        body = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(body).hexdigest(), ms


def main() -> int:
    base = sys.argv[sys.argv.index("--base") + 1].rstrip("/")
    out = {name: dict(zip(("sha256", "ms"), fetch(base, path))) | {"path": path} for name, path in CALLS}
    if "--write" in sys.argv:
        dest = sys.argv[sys.argv.index("--write") + 1]
        with open(dest, "w") as f:
            json.dump(out, f, indent=1)
        print(f"wrote {len(out)} result hashes to {dest}")
        return 0
    ref = json.load(open(sys.argv[sys.argv.index("--compare") + 1]))
    bad = 0
    for name, r in out.items():
        ok = ref.get(name, {}).get("sha256") == r["sha256"]
        bad += not ok
        print(f"  {'match   ' if ok else 'MISMATCH'}  {name:<55} {r['sha256'][:12]}  {r['ms']:>8.1f} ms")
    print(f"\n{len(out) - bad} of {len(out)} results identical to the online baseline")
    if "--report" in sys.argv:
        with open(sys.argv[sys.argv.index("--report") + 1], "w") as f:
            json.dump({"compared": len(out), "identical": len(out) - bad, "results": out}, f, indent=1)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
