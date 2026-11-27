"""Stage 4: offline operation. The guard, the artifact check, a real offline server process on loopback, and degraded external services.
Temporary folders and the dummy HTML below are TEST FIXTURES."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from dengueshield import offline
from dengueshield.api import integrations
from dengueshield.api import main as M

ROOT = Path(__file__).resolve().parents[1]
client = TestClient(M.app)
PEAK = {"origin": "2024-08-05", "horizon": 3}


@pytest.fixture
def guard():
    offline.enable()
    offline.BLOCKED.clear()
    yield
    offline.disable()


def test_guard_blocks_outbound_and_allows_loopback(guard):
    t = time.perf_counter()
    with pytest.raises(OSError, match="offline mode"):
        socket.create_connection(("example.com", 443), timeout=5)
    with pytest.raises(OSError, match="offline mode"):
        socket.create_connection(("8.8.8.8", 53), timeout=5)
    assert time.perf_counter() - t < 1.0                                                       # refused at once, no DNS wait or timeout
    assert [b["host"] for b in offline.BLOCKED] == ["example.com", "8.8.8.8"]
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    c = socket.create_connection(("127.0.0.1", srv.getsockname()[1]), timeout=5)               # loopback still works
    c.close()
    srv.close()
    assert socket.getaddrinfo("localhost", 80)


def test_disable_restores_the_socket_functions():
    orig = socket.socket.connect
    offline.enable()
    assert socket.socket.connect is not orig
    offline.disable()
    assert socket.socket.connect is orig and not offline.active()


def test_core_engines_make_no_outbound_attempt_offline(guard):
    calls = [("/api/risk/wards", PEAK), ("/api/allocation/plan", {**PEAK, "stock": 0.4, "crews": 30}),
             ("/api/overflow/plan", {**PEAK, "capacity_pct": 120}), ("/api/intervention/simulate", {**PEAK, "crews": 25}),
             ("/api/dispatch/brief", {**PEAK, "ward": "DSCC_Ward_04"}),
             ("/api/dispatch/document", {**PEAK, "kind": "ward", "ward": "DSCC_Ward_04", "format": "pdf"})]
    for h in (2, 3, 4):
        calls.append(("/api/allocation/plan", {**PEAK, "horizon": h}))
    for path, q in calls:
        assert client.get(path, params=q).status_code == 200, path
    assert list(offline.BLOCKED) == []


def test_copilot_and_status_are_honest_offline(guard, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-key")
    assert integrations.openai_configured() is False
    st = client.get("/api/assistant/status").json()
    assert st["enabled"] is False and "Offline mode" in st["reason_disabled"]
    j = client.get("/api/system/offline").json()
    assert j["offline_mode"] is True and {s["id"] for s in j["services"]} >= {"core", "copilot", "firebase", "applink", "weather", "tiles"}
    assert next(s for s in j["services"] if s["id"] == "applink")["status"] == "not used"


def test_external_services_fail_fast_and_say_so(guard):
    t = time.perf_counter()
    r = client.get("/api/climate/current", params={"city": "Dhaka"})
    assert time.perf_counter() - t < 5
    assert r.status_code == 503 or r.json()["cache"]["stale"] is True                         # unavailable, or an earlier copy labelled stale
    assert client.get("/api/geo/dghs/status").status_code in (200, 503)
    assert offline.BLOCKED and {b["host"] for b in offline.BLOCKED} <= {"api.open-meteo.com", "gis.dghs.gov.bd"}   # only optional services tried


def test_artifact_check_reports_missing_files_and_creates_nothing(tmp_path):
    rows = offline.check_artifacts(tmp_path)
    files = [r for r in rows if not r["path"].startswith("python module")]
    assert files and all(r["problem"] == "missing" for r in files)
    assert list(tmp_path.iterdir()) == []                                                     # nothing fabricated
    out = subprocess.run([sys.executable, "scripts/offline_check.py", "--root", str(tmp_path), "--fast"], cwd=ROOT, capture_output=True, text=True)
    assert out.returncode == 3 and "MISSING" in out.stdout and "fetch_data.py" in out.stdout


def test_external_asset_scan(tmp_path):
    (tmp_path / "a.html").write_text('<script src="/_next/app.js"></script><link href="/x.css" rel=stylesheet>')
    (tmp_path / "b.html").write_text('<script src="https://cdn.example.com/lib.js"></script>')
    (tmp_path / "c.css").write_text('@import url("https://fonts.googleapis.com/css2?family=X");')
    assert offline.external_assets(tmp_path) == ["b.html", "c.css"]


def test_offline_launch_script_never_installs_or_downloads():
    s = (ROOT / "scripts" / "launch_offline.sh").read_text()
    code = "\n".join(ln for ln in s.splitlines() if not ln.lstrip().startswith("#"))
    for word in ("npm", "pip install", "fetch_data", "curl", "wget", "git "):
        assert word not in code, word
    assert "DENGUESHIELD_OFFLINE=1" in code and "offline_check.py" in code and "127.0.0.1" in code


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_real_offline_server_process_serves_every_engine():
    """Starts the API as a separate process in offline mode (outbound refused inside it) and drives it over loopback."""
    port = _free_port()
    env = {**os.environ, "DENGUESHIELD_OFFLINE": "1", "OPENAI_API_KEY": "sk-test-not-a-key"}
    env.pop("FIREBASE_PROJECT_ID", None)
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "dengueshield.api.main:app", "--host", "127.0.0.1", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"

    def get(path):
        with urllib.request.urlopen(base + path, timeout=60) as r:
            return r.status, r.read(), r.headers
    try:
        t0 = time.perf_counter()
        for _ in range(240):
            try:
                if get("/api/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.5)
        startup = time.perf_counter() - t0
        st = json.loads(get("/api/system/offline")[1])
        assert st["offline_mode"] is True
        q = "origin=2024-08-05&horizon=3"
        for path in (f"/api/risk/wards?{q}", f"/api/allocation/plan?{q}&stock=0.45", f"/api/overflow/plan?{q}&capacity_pct=130",
                     f"/api/intervention/simulate?{q}&crews=30", f"/api/dispatch/brief?{q}&ward=GCC_Ward_02"):
            assert get(path)[0] == 200, path
        status, pdf, headers = get(f"/api/dispatch/document?{q}&kind=ward&ward=GCC_Ward_02&format=pdf")
        assert status == 200 and pdf.startswith(b"%PDF-1.4") and headers.get("X-Scenario-Id", "").startswith("S-")
        st = json.loads(get("/api/system/offline")[1])
        assert st["blocked_count"] == 0                                                         # the core workflow never tried the network
        assert startup < 120
    finally:
        proc.terminate()
        proc.wait(timeout=20)


def test_build_commit_is_reported_for_recordings():
    sha = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    got = client.get("/api/health").json()["build_commit"]
    if sha:                                                                                     # a git checkout (local, CI)
        assert got in (sha, sha + "-dirty")
    assert client.get("/api/system/offline").json()["build_commit"] == got
