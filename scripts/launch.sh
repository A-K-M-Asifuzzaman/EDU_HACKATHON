#!/usr/bin/env bash
# One-command local launch: Python venv + frontend build + API serving the dashboard on ONE port.
#   ./scripts/launch.sh            # default http://127.0.0.1:8000
#   PORT=8100 ./scripts/launch.sh  # if 8000 is taken
# Optional: put OPENAI_API_KEY in .env (Copilot) and map keys in frontend/.env.local (city map). The app works without them.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
PY="${PYTHON:-python3.12}"; command -v "$PY" >/dev/null || PY=python3

if [ ! -x .venv/bin/python ]; then echo "[1/4] creating Python environment"; "$PY" -m venv .venv; fi
echo "[1/4] installing Python dependencies"; .venv/bin/python -m pip install -q -r requirements.txt

echo "[2/4] checking the organizer dataset"; .venv/bin/python scripts/fetch_data.py

echo "[3/4] building the dashboard"
( cd frontend && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent )

echo "[4/4] starting DengueShield on http://127.0.0.1:${PORT}"
exec .venv/bin/python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port "$PORT"
