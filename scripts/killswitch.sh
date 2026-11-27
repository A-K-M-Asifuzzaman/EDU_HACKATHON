#!/usr/bin/env bash
# Network kill-switch test: outbound internet cut off, loopback open, then the offline session (scripts/killswitch_inner.sh).
#   Linux: a private network namespace in which only loopback exists (needs sudo; used by CI).
#   macOS: a sandbox-exec profile that denies every outbound connection except to localhost.
# Needs a baseline from an online run first: python scripts/offline_verify.py --base http://127.0.0.1:8000 --write killswitch/baseline.json
# For a manual demonstration simply switch Wi-Fi off and run scripts/launch_offline.sh (see docs/onsite/STAGE4_HANDOFF.md).
set -euo pipefail
cd "$(dirname "$0")/.."
case "$(uname)" in
  Linux)
    # env is passed explicitly: sudo's secure_path would otherwise replace PATH (python, node) inside the namespace
    exec sudo unshare --net -- bash -c "ip link set lo up && exec sudo -u '$(id -un)' env 'PATH=$PATH' 'HOME=$HOME' 'PYBIN=${PYBIN:-.venv/bin/python}' \
      'PORT=${PORT:-8765}' 'BASELINE=${BASELINE:-killswitch/baseline.json}' 'OUT=${OUT:-killswitch}' bash scripts/killswitch_inner.sh" ;;
  Darwin)
    exec sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))' \
      bash scripts/killswitch_inner.sh ;;
  *) echo "Unsupported OS: disconnect the network by hand and run scripts/killswitch_inner.sh" >&2; exit 2 ;;
esac
