# Offline verification

Run on 27 Nov 2026, macOS, branch `upgrade/championship-engine-v2` (after commit `797a3cf`), development laptop.

1. Online baseline: `python scripts/offline_verify.py --base http://127.0.0.1:8300 --write killswitch/baseline.json` → 28 result hashes.
2. Kill-switch: `PYBIN=<venv python> PORT=8766 bash scripts/killswitch.sh` (macOS `sandbox-exec`: every outbound connection denied
   except loopback; the script first proves 1.1.1.1, 8.8.8.8, 140.82.112.3 and example.com are unreachable).

Result:

- 28 of 28 results identical to the online baseline, including the six new calls: mentor demonstration plan, all-cities plan,
  preparation brief CSV and HTML, real hospitals by road tier, bundled contact directory.
- Offline browser workflow (`frontend/tests/e2e/offline.spec.ts`): 1 passed.
- Outbound attempts refused by the server: 0 (offline mode on, artifacts complete).

Not done: a physical Wi-Fi-off run on the judging laptop and a fresh-clone setup. Do both before recording (see
[JUDGE_DEMO_SCRIPT_7MIN.md](JUDGE_DEMO_SCRIPT_7MIN.md)). Without internet the map basemap is blank; facility points, routes and all
planning engines still work. Live weather, Copilot generation, DGHS polygons and Firebase sign-in are optional online services.
