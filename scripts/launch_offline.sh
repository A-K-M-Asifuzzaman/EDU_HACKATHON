#!/usr/bin/env bash
# Offline launch: no npm, no pip, no downloads. Checks local artifacts, then serves the API and the built dashboard on loopback with
# every outbound connection from the server refused and recorded (DENGUESHIELD_OFFLINE=1). Run scripts/setup.sh once beforehand.
#   ./scripts/launch_offline.sh            # http://127.0.0.1:8000
#   PORT=8100 ./scripts/launch_offline.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
PYBIN="${PYBIN:-.venv/bin/python}"
if [ ! -x "$PYBIN" ]; then
  echo "DengueShield offline launch: no Python environment at $PYBIN. Run ./scripts/setup.sh once while online (or set PYBIN)." >&2
  exit 2
fi
"$PYBIN" scripts/offline_check.py || { echo "DengueShield offline launch stopped: required local files are missing (listed above)." >&2; exit 3; }
export DENGUESHIELD_OFFLINE=1
unset FIREBASE_PROJECT_ID                       # public decision tools need no account; token checks would need Google's servers
echo "DengueShield (offline mode) on http://127.0.0.1:${PORT}"
exec "$PYBIN" -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port "$PORT"
