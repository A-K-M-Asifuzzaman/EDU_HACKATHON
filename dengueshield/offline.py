"""Offline operation: the artifact check behind the offline launch, and the outbound-network guard used in offline mode.

Offline mode (DENGUESHIELD_OFFLINE=1, set by scripts/launch_offline.sh) blocks every outbound connection and DNS lookup from the API
process except loopback, records each attempt, and turns the network-only integrations (Copilot generation, live weather, DGHS boundaries,
Firebase token checks) into honest "unavailable offline" states. The decision engines (forecast replay, allocation, overflow, intervention
simulation, dispatch, road routing) read only local files, so they are unaffected.
"""
from __future__ import annotations

import errno
import importlib.util
import ipaddress
import os
import re
import socket
import threading
import time
from collections import deque
from pathlib import Path

from .data import EXPECTED_SHA256, RAW_PATH, ROOT, sha256
from .onsite_data import ONSITE_PATH, ONSITE_SHA256

# Every file the core workflow needs, why, and (for datasets) the audited checksum. Missing files are reported, never fabricated.
ARTIFACTS: list[tuple[str, str, str | None]] = [
    (str(RAW_PATH.relative_to(ROOT)), "organizer dataset: forecast inputs (2025 rows are dropped on load)", EXPECTED_SHA256),
    (str(ONSITE_PATH.relative_to(ROOT)), "onsite dataset: illustrative bed capacity (2025 rows dropped on load)", ONSITE_SHA256),
    ("models/dengueshield_B.joblib", "deployed forecasting bundle (forward forecasts past 2024)", None),
    ("app_data/replay.csv.gz", "validated replay forecasts for 2019-2024 targets", None),
    ("app_data/resource_rules.json", "saline, kit and bed demand rule", None),
    ("app_data/validation.json", "model evidence", None),
    ("app_data/profile.json", "data profile", None),
    ("app_data/geo/greater_dhaka_graph.npz", "offline road network for hospital routing (Dhaka, Gazipur, Narayanganj)", None),
    ("app_data/geo/chattogram_graph.npz", "offline road network for hospital routing (Chattogram)", None),
    ("app_data/geo/facilities.geojson", "health facilities directory", None),
    ("frontend/out/index.html", "built dashboard", None),
    ("frontend/out/response/index.html", "built Response Intelligence page", None),
]
MODULES = ["fastapi", "uvicorn", "pandas", "numpy", "scipy", "sklearn", "joblib", "httpx", "pydantic"]


def check_artifacts(root: Path = ROOT, verify_checksums: bool = True) -> list[dict]:
    out = []
    for rel, purpose, digest in ARTIFACTS:
        p = root / rel
        problem = None
        if not p.exists():
            problem = "missing"
        elif p.stat().st_size == 0:
            problem = "empty"
        elif digest and verify_checksums and sha256(p) != digest:
            problem = "checksum differs from the audited file"
        out.append({"path": rel, "purpose": purpose, "ok": problem is None, "problem": problem})
    for m in MODULES:
        ok = importlib.util.find_spec(m) is not None
        out.append({"path": f"python module {m}", "purpose": "runtime dependency", "ok": ok, "problem": None if ok else "not installed"})
    return out


_EXTERNAL = re.compile(r"""(?:<script[^>]+src|<link[^>]+href|<img[^>]+src)\s*=\s*["'](https?:)?//""", re.I)
_CSS_EXTERNAL = re.compile(r"""(?:@import\s+(?:url\()?|url\()\s*["']?(?:https?:)?//""", re.I)


def external_assets(out_dir: Path = ROOT / "frontend" / "out") -> list[str]:
    """Pages or stylesheets of the built dashboard that load scripts, styles, images or fonts from another host."""
    bad = []
    for p in sorted(out_dir.rglob("*.html")):
        if _EXTERNAL.search(p.read_text(errors="ignore")):
            bad.append(str(p.relative_to(out_dir)))
    for p in sorted(out_dir.rglob("*.css")):
        if _CSS_EXTERNAL.search(p.read_text(errors="ignore")):
            bad.append(str(p.relative_to(out_dir)))
    return bad


# ------------------------------------------------------------------ outbound-network guard
BLOCKED: deque = deque(maxlen=200)
_LOCK = threading.Lock()
_ORIG: dict = {}


class OfflineBlocked(OSError):
    pass


def active() -> bool:
    return bool(_ORIG)


def _local(host) -> bool:
    if host is None:
        return True
    h = host.decode() if isinstance(host, bytes) else str(host)
    if h in ("localhost", "") or h.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(h.split("%")[0]).is_loopback
    except ValueError:
        return False


def _block(host, port):
    with _LOCK:
        BLOCKED.append({"host": str(host), "port": port, "at": time.strftime("%H:%M:%S")})
    raise OfflineBlocked(errno.ENETUNREACH, f"DengueShield offline mode: outbound connection to {host}:{port} blocked")


def enable() -> None:
    """Allow loopback only. Idempotent; disable() restores the original socket functions."""
    if _ORIG:
        return
    _ORIG.update(connect=socket.socket.connect, connect_ex=socket.socket.connect_ex, getaddrinfo=socket.getaddrinfo)

    def connect(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _local(address[0]):
            _block(address[0], address[1])
        return _ORIG["connect"](self, address)

    def connect_ex(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _local(address[0]):
            _block(address[0], address[1])
        return _ORIG["connect_ex"](self, address)

    def getaddrinfo(host, port, *a, **k):
        if not _local(host):
            _block(host, port)
        return _ORIG["getaddrinfo"](host, port, *a, **k)

    socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = connect, connect_ex, getaddrinfo


def disable() -> None:
    if _ORIG:
        socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = _ORIG["connect"], _ORIG["connect_ex"], _ORIG["getaddrinfo"]
        _ORIG.clear()


def requested() -> bool:
    return os.environ.get("DENGUESHIELD_OFFLINE", "").strip().lower() in ("1", "true", "yes")


SERVICES_OFFLINE = [
    {"id": "core", "name": "Forecasts, supply allocation, hospital overflow, vector-control simulator, dispatch briefs",
     "status": "available", "note": "local files and local computation only"},
    {"id": "routing", "name": "Hospital search and road routing", "status": "available", "note": "local road graph and facility list"},
    {"id": "copilot", "name": "Copilot", "status": "local retrieval only", "note": "answer generation needs OpenAI and is off in offline mode; sources are still searched locally"},
    {"id": "firebase", "name": "Sign-in (Firebase)", "status": "unavailable offline", "note": "the public decision tools need no account; officer workspaces need sign-in"},
    {"id": "applink", "name": "SMS sending (AppLink)", "status": "not used", "note": "dispatch notices are generated as text and documents only; nothing is sent"},
    {"id": "weather", "name": "Live weather (NASA POWER, Open-Meteo)", "status": "unavailable offline", "note": "the forecast does not need it"},
    {"id": "boundaries", "name": "Ward boundaries (DGHS)", "status": "unavailable offline", "note": "the abstract ward matrix is shown instead"},
    {"id": "tiles", "name": "Basemap tiles (MapTiler, loaded by the browser)", "status": "need internet", "note": "routes and facilities still draw from local data"},
]
