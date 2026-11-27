#!/usr/bin/env bash
# The offline session of the kill-switch test. Run it through scripts/killswitch.sh, which cuts the internet off first.
set -euo pipefail
cd "$(dirname "$0")/.."
PYBIN="${PYBIN:-.venv/bin/python}"; PORT="${PORT:-8765}"; BASELINE="${BASELINE:-killswitch/baseline.json}"; OUT="${OUT:-killswitch}"
mkdir -p "$OUT"
echo "[1/5] the internet must be unreachable and loopback must work"
"$PYBIN" - <<'PY'
import socket
for host in ("1.1.1.1", "8.8.8.8", "140.82.112.3"):
    try:
        socket.create_connection((host, 443), timeout=4).close()
        raise SystemExit(f"internet reachable via {host}: this is not a kill-switch run")
    except OSError:
        pass
try:
    socket.create_connection(("example.com", 443), timeout=4).close()
    raise SystemExit("example.com reachable: this is not a kill-switch run")
except OSError:
    pass
print("  outbound connections fail (checked 1.1.1.1, 8.8.8.8, 140.82.112.3 and example.com)")
PY
echo "[2/5] starting DengueShield with scripts/launch_offline.sh on 127.0.0.1:$PORT"
"$PYBIN" -c "import socket,sys; s=socket.socket(); s.bind(('127.0.0.1', int(sys.argv[1]))); s.close()" "$PORT" 2>/dev/null \
  || { echo "port $PORT is already in use: set PORT to a free port" >&2; exit 4; }
PORT=$PORT PYBIN=$PYBIN scripts/launch_offline.sh > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
T0=$(date +%s)
"$PYBIN" - "$PORT" <<'PY'
import sys, time, urllib.request
for _ in range(240):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/health", timeout=3); break
    except OSError:
        time.sleep(0.5)
else:
    raise SystemExit("server did not start")
PY
echo "  ready after $(( $(date +%s) - T0 )) s"
echo "[3/5] every result compared with the online baseline"
"$PYBIN" scripts/offline_verify.py --base "http://127.0.0.1:$PORT" --compare "$BASELINE" --report "$OUT/comparison.json"
echo "[4/5] browser workflow with the internet cut off (Playwright)"
( cd frontend && OFFLINE_E2E=1 E2E_BASE_URL="http://127.0.0.1:$PORT" KILLSWITCH_OUT="../$OUT" node_modules/.bin/playwright test tests/e2e/offline.spec.ts --retries=0 --reporter=list )
echo "[5/5] outbound attempts the server refused"
"$PYBIN" - "$PORT" "$OUT" <<'PY'
import json, sys, urllib.request
st = json.load(urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/system/offline"))
json.dump(st, open(f"{sys.argv[2]}/server_offline_status.json", "w"), indent=1)
hosts = sorted({b["host"] for b in st["blocked_attempts"]})
assert st["offline_mode"] and st["artifacts_ok"], "server not in offline mode or artifacts missing"
assert set(hosts) <= {"api.open-meteo.com", "power.larc.nasa.gov", "archive-api.open-meteo.com", "gis.dghs.gov.bd", "api.openai.com", "www.googleapis.com"}, hosts
print(f"  offline mode on, artifacts complete, {st['blocked_count']} refused attempt(s) from optional services only: {hosts or 'none'}")
PY
echo "Kill-switch test passed."
