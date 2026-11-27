"""V4 accounts on Firebase Authentication: server-side token checks, roles, officer workflows and audit. The Firebase token verifier is
replaced by a fake that maps test tokens to claims, so these tests exercise everything this server decides. Real signature checking is
covered by test_garbage_token_is_rejected (google-auth against an empty key set)."""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from dengueshield.api import auth
from dengueshield.api.main import app

ORIGIN, H, PID = "2024-08-05", 3, "dengueshield-test"


def claims(uid: str, email: str, verified: bool = True, mfa: bool = False, auth_age: float = 60) -> dict:
    fb = {"sign_in_provider": "password", **({"sign_in_second_factor": "totp"} if mfa else {})}
    return {"sub": uid, "email": email, "email_verified": verified, "name": uid.title(), "auth_time": time.time() - auth_age,
            "iss": f"https://securetoken.google.com/{PID}", "aud": PID, "firebase": fb}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DS_AUTH_DB", str(tmp_path / "auth.db"))
    monkeypatch.setenv("FIREBASE_PROJECT_ID", PID)
    auth._writes.clear()
    tokens: dict[str, dict] = {}
    def fake_verify(tok: str) -> dict:
        if tok not in tokens:
            raise auth.HTTPException(401, "Your sign-in has expired or is not valid. Sign in again.")
        return tokens[tok]
    monkeypatch.setattr(auth, "verify_token", fake_verify)
    assert auth._cli(["grant", "--email", "officer@example.org", "--role", "officer"]) == 0
    assert auth._cli(["grant", "--email", "admin@example.org", "--role", "admin"]) == 0
    tokens.update(reader=claims("u-reader", "reader@example.org"), officer=claims("u-officer", "officer@example.org"),
                  admin=claims("u-admin", "admin@example.org", mfa=True), admin_nomfa=claims("u-admin", "admin@example.org"),
                  unverified=claims("u-fake", "officer2@example.org", verified=False), stale=claims("u-officer", "officer@example.org", auth_age=9 * 3600))
    return tokens


def as_(who: str | None) -> dict:
    return {"Authorization": f"Bearer {who}"} if who else {}


def test_public_routes_need_no_account(env):
    c = TestClient(app)
    for path in ["/api/health", f"/api/forecast?ward_id=DNCC_Ward_19&origin={ORIGIN}&horizon=3", f"/api/risk/wards?origin={ORIGIN}&horizon=3",
                 "/api/model/canonical-metrics", "/api/auth/config"]:
        assert c.get(path).status_code == 200, path


def test_unconfigured_deployment_answers_503_but_stays_public(env, monkeypatch):
    monkeypatch.delenv("FIREBASE_PROJECT_ID")
    c = TestClient(app)
    assert c.get("/api/auth/config").json()["configured"] is False
    assert c.get("/api/ops/plans").status_code == 503 and c.get("/api/health").status_code == 200


def test_garbage_token_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("DS_AUTH_DB", str(tmp_path / "a.db")); monkeypatch.setenv("FIREBASE_PROJECT_ID", PID)
    monkeypatch.setattr(auth, "_google_certs", lambda: {})                      # real google-auth verification, no keys: nothing can pass
    assert TestClient(app).get("/api/auth/me", headers=as_("not.a.jwt")).status_code == 401


def test_malformed_tokens_are_refused_without_contacting_google(tmp_path, monkeypatch):
    import base64
    monkeypatch.setenv("DS_AUTH_DB", str(tmp_path / "m.db")); monkeypatch.setenv("FIREBASE_PROJECT_ID", PID)
    def no_network():
        raise AssertionError("key fetch attempted for a malformed token")
    monkeypatch.setattr(auth, "_google_certs", no_network)
    c = TestClient(app)
    for tok in ["forged.token.value", "not-a-jwt", "a.b", "..", "eyJhbGciOiJub25lIn0.e30.", "x" * 3000]:
        assert c.get("/api/ops/plans", headers=as_(tok)).status_code == 401, tok
    head = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "kid": "k1"}).encode()).decode().rstrip("=")
    monkeypatch.setattr(auth, "_google_certs", lambda: {})                       # well-formed but unsigned by Google: full verification, still 401
    assert c.get("/api/ops/plans", headers=as_(f"{head}.e30.c2ln")).status_code == 401


def test_role_matrix_is_enforced_on_the_server(env):
    c = TestClient(app)
    cases = [(f"/api/ops/alerts?origin={ORIGIN}&horizon={H}", {None: 401, "reader": 403, "officer": 200, "admin": 200}),
             ("/api/ops/plans", {None: 401, "reader": 403, "officer": 200, "admin": 200}),
             ("/api/admin/users", {None: 401, "reader": 403, "officer": 403, "admin": 200}),
             ("/api/admin/audit", {None: 401, "reader": 403, "officer": 403, "admin": 200})]
    for path, expect in cases:
        for who, code in expect.items():
            assert c.get(path, headers=as_(who)).status_code == code, (who, path)
    assert c.get("/api/auth/me", headers=as_("bogus")).status_code == 401


def test_first_sign_in_creates_a_reader_and_grants_apply(env):
    c = TestClient(app)
    assert c.get("/api/auth/me", headers=as_("reader")).json()["user"]["role"] == "user"
    assert c.get("/api/auth/me", headers=as_("officer")).json()["user"]["effective_role"] == "officer"
    me = c.get("/api/auth/me", headers=as_("reader")).text
    for secret in ("reader", "Bearer", "token"):                                  # the token itself never comes back
        assert f'"{secret}"' not in me


def test_elevated_roles_need_a_verified_email_and_admin_needs_mfa(env):
    c = TestClient(app)
    with auth.db() as d:
        d.execute("insert into grants(email, role, granted_by, granted_at) values ('officer2@example.org','officer','cli',0)")
    assert c.get("/api/ops/plans", headers=as_("unverified")).status_code == 403
    assert c.get("/api/admin/users", headers=as_("admin_nomfa")).json()["detail"] == "mfa_required"
    assert c.get("/api/admin/users", headers=as_("admin")).status_code == 200


def test_sessions_older_than_8_hours_must_sign_in_again(env):
    assert TestClient(app).get("/api/ops/plans", headers=as_("stale")).status_code == 401


def test_deactivation_applies_on_the_next_request(env):
    c = TestClient(app)
    c.get("/api/auth/me", headers=as_("officer"))
    assert c.post("/api/admin/users/u-officer", json={"active": False}, headers=as_("admin")).status_code == 200
    assert c.get("/api/ops/plans", headers=as_("officer")).status_code == 403
    assert c.post("/api/admin/users/u-admin", json={"active": False}, headers=as_("admin")).status_code == 422      # no self-lockout


def test_officer_reviews_alerts_and_drafts_plans_admin_approves(env):
    c = TestClient(app); off, adm = as_("officer"), as_("admin")
    alerts = c.get(f"/api/ops/alerts?origin={ORIGIN}&horizon={H}", headers=off).json()
    ward = alerts["alerts"][0]["ward_id"]
    assert c.post("/api/ops/alerts/review", headers=off, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "status": "escalated", "note": "check drains"}).status_code == 200
    again = c.get(f"/api/ops/alerts?origin={ORIGIN}&horizon={H}", headers=off).json()
    assert next(a for a in again["alerts"] if a["ward_id"] == ward)["review"]["status"] == "escalated"
    assert c.post("/api/ops/alerts/review", headers=off, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "status": "sent"}).status_code == 422
    assert c.post("/api/ops/plans", headers=off, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "options": ["send_sms"]}).status_code == 422
    plan = c.post("/api/ops/plans", headers=off, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "options": ["larval_surveillance"]}).json()["plan"]
    assert plan["status"] == "draft"
    assert c.post(f"/api/ops/plans/{plan['id']}/approve", headers=off).status_code == 403
    assert c.post(f"/api/ops/plans/{plan['id']}/approve", headers=adm).json()["plan"]["approved_by"] == "admin@example.org"
    own = c.post("/api/ops/plans", headers=adm, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "options": ["facility_readiness"]}).json()["plan"]
    assert c.post(f"/api/ops/plans/{own['id']}/approve", headers=adm).status_code == 422                   # four-eyes rule
    log = c.get("/api/admin/audit", headers=adm).json()["entries"]
    assert {"account_created", "alert_review", "plan_create", "plan_approve", "role_grant"} <= {e["action"] for e in log}


def test_admin_grants_and_lists_without_secrets(env):
    c = TestClient(app); adm = as_("admin")
    assert c.post("/api/admin/grants", headers=adm, json={"email": "new.officer@example.org", "role": "officer"}).status_code == 200
    assert c.post("/api/admin/grants", headers=adm, json={"email": "admin@example.org", "role": "user"}).status_code == 422
    body = c.get("/api/admin/users", headers=adm).json()
    assert any(g["email"] == "new.officer@example.org" for g in body["grants"])
    assert all(set(u) == {"uid", "email", "name", "role", "active"} for u in body["users"])
    assert "Bearer" not in json.dumps(body)


def test_write_rate_limit(env):
    c = TestClient(app); off = as_("officer")
    ward = c.get(f"/api/ops/alerts?origin={ORIGIN}&horizon={H}", headers=off).json()["alerts"][0]["ward_id"]
    codes = [c.post("/api/ops/alerts/review", headers=off, json={"ward_id": ward, "origin": ORIGIN, "horizon": H, "status": "acknowledged"}).status_code for _ in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429
