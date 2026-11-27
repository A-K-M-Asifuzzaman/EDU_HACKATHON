#!/usr/bin/env bash
# First-time installation (needs the internet ONCE): Python environment, both datasets (checksum-verified), dashboard build.
# After this, scripts/launch_offline.sh runs DengueShield with no network at all.
#   ./scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3.12}"; command -v "$PY" >/dev/null || PY=python3

if [ ! -x .venv/bin/python ]; then echo "[1/4] creating Python environment"; "$PY" -m venv .venv; fi
echo "[1/4] installing Python dependencies"; .venv/bin/python -m pip install -q -r requirements.txt
echo "[2/4] fetching and verifying the organizer datasets"; .venv/bin/python scripts/fetch_data.py
echo "[3/4] building the dashboard"
( cd frontend && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent )
echo "[4/4] checking that everything the offline launch needs is in place"
.venv/bin/python scripts/offline_check.py
echo "Setup complete. Start offline with: ./scripts/launch_offline.sh"
