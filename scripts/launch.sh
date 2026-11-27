#!/usr/bin/env bash
# One-command local launch (online): first-time setup (scripts/setup.sh), then the API serving the dashboard on ONE port.
# For a disconnected demonstration use scripts/launch_offline.sh after one setup.
#   ./scripts/launch.sh            # default http://127.0.0.1:8000
#   PORT=8100 ./scripts/launch.sh  # if 8000 is taken
# Optional: put OPENAI_API_KEY in .env (Copilot) and map keys in frontend/.env.local (city map). The app works without them.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
./scripts/setup.sh

echo "Starting DengueShield (online mode) on http://127.0.0.1:${PORT}. Offline: ./scripts/launch_offline.sh"
exec .venv/bin/python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port "$PORT"
