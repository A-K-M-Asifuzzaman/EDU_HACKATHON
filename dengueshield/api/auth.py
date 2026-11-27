"""Accounts and server-enforced roles (V4) on Firebase Authentication. Public forecasting, evidence, weather, map and routing stay
anonymous; nothing here gates them.

Firebase does the sign-in (email and password, Google) and multi-factor authentication. This server never sees a password. On every
protected request it verifies the Firebase ID token itself: RS256 signature against Google's published keys (cached per their
Cache-Control), audience = FIREBASE_PROJECT_ID, issuer https://securetoken.google.com/<project>, expiry, and a session no older than
8 hours (auth_time). Roles, activation and the audit log live in a local SQLite database keyed by the Firebase uid.

Roles (ascending): user (registered reader, created on first sign-in) < officer < admin.
- officer and admin roles take effect only for a verified email address;
- admin requests must carry Firebase's second-factor claim (TOTP MFA), otherwise 403 mfa_required;
- deactivation and role changes apply on the very next request;
- writes are limited per account (60 per minute) and every officer/admin action is audited.
Configuration: FIREBASE_PROJECT_ID. Without it the protected routes answer 503 and the public site is unaffected. The first administrator
is granted with `python -m dengueshield.api.auth grant --email you@example.org --role admin` (applies at their next sign-in).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from dengueshield.api.store import ROOT

Role = Literal["user", "officer", "admin"]
RANK = {"user": 1, "officer": 2, "admin": 3}
ABSOLUTE_S = 8 * 60 * 60
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")

SCHEMA = """
create table if not exists users(uid text primary key, email text not null, name text, role text not null check(role in ('user','officer','admin')),
  active integer not null default 1, created_at real not null, last_auth real);
create table if not exists grants(email text primary key, role text not null check(role in ('user','officer','admin')), granted_by text, granted_at real not null);
create table if not exists audit(id integer primary key, ts real not null, actor text, action text not null, target text, detail text);
create table if not exists alert_reviews(id integer primary key, ward_id text not null, origin text not null, horizon integer not null,
  status text not null, note text, updated_by text not null, updated_at real not null, unique(ward_id, origin, horizon));
create table if not exists plans(id integer primary key, ward_id text not null, origin text not null, horizon integer not null,
  options text not null, note text, status text not null, created_by text not null, approved_by text, created_at real not null,
  updated_at real not null);
"""

_lock = threading.Lock()
_inited: set[str] = set()
_certs: dict = {"keys": None, "exp": 0.0}
_writes: dict[str, list[float]] = {}      # ponytail: in-process write budget; use a shared store if several workers serve the API


def project_id() -> Optional[str]:
    return os.environ.get("FIREBASE_PROJECT_ID") or None


def db_path() -> Path:
    return Path(os.environ.get("DS_AUTH_DB") or (ROOT / "var" / "dengueshield_auth.db"))


def db() -> sqlite3.Connection:
    p = db_path(); p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(p, timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    if str(p) not in _inited:
        with _lock:
            c.executescript(SCHEMA); _inited.add(str(p))
    return c


def audit(actor: Optional[str], action: str, target: Optional[str] = None, detail: Optional[dict] = None) -> None:
    with db() as c:
        c.execute("insert into audit(ts, actor, action, target, detail) values (?,?,?,?,?)",
                  (time.time(), actor, action, target, json.dumps(detail, ensure_ascii=False) if detail else None))


# ------------------------------------------------------------------ Firebase ID token verification
def _google_certs() -> dict:
    now = time.time()
    if _certs["keys"] is None or now >= _certs["exp"]:
        with urllib.request.urlopen(CERTS_URL, timeout=6) as r:                     # fixed Google endpoint; no user input in the URL
            keys = json.loads(r.read().decode())
            m = re.search(r"max-age=(\d+)", r.headers.get("Cache-Control", ""))
        _certs.update(keys=keys, exp=now + (int(m.group(1)) if m else 3600))
    return _certs["keys"]


def _well_formed(token: str) -> bool:
    """A Firebase ID token is a three-part JWT whose header names RS256 and a key id. Anything else is refused without contacting Google."""
    import base64
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        return False
    try:
        head = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
    except (ValueError, TypeError):
        return False
    return isinstance(head, dict) and head.get("alg") == "RS256" and isinstance(head.get("kid"), str) and 0 < len(head["kid"]) <= 128


def verify_token(token: str) -> dict:
    """Verify a Firebase ID token; return its claims or raise 401/503. Uses google-auth's JWT verification (signature, exp, aud)."""
    pid = project_id()
    if not pid:
        raise HTTPException(503, "Accounts are not configured on this deployment.")
    from google.auth import exceptions as gexc, jwt as gjwt
    if not _well_formed(token):                       # refuse malformed tokens before any network call (no key fetch on their behalf)
        raise HTTPException(401, "Your sign-in has expired or is not valid. Sign in again.")
    try:
        claims = gjwt.decode(token, certs=_google_certs(), audience=pid)
    except (ValueError, gexc.GoogleAuthError):
        raise HTTPException(401, "Your sign-in has expired or is not valid. Sign in again.")
    except OSError:
        raise HTTPException(503, "Could not reach Google to check the sign-in. Try again shortly.")
    if claims.get("iss") != f"https://securetoken.google.com/{pid}" or not claims.get("sub") or len(claims["sub"]) > 128:
        raise HTTPException(401, "Your sign-in has expired or is not valid. Sign in again.")
    return claims


def _bearer(request: Request) -> Optional[str]:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") and len(h) < 4096 else None


def public_user(r: sqlite3.Row, claims: Optional[dict] = None) -> dict:
    """The only user shape that leaves the server."""
    out = {"uid": r["uid"], "email": r["email"], "name": r["name"], "role": r["role"], "active": bool(r["active"])}
    if claims is not None:
        fb = claims.get("firebase") or {}
        out |= {"email_verified": bool(claims.get("email_verified")), "mfa": bool(fb.get("sign_in_second_factor")),
                "provider": fb.get("sign_in_provider"), "effective_role": effective_role(r["role"], claims)}
    return out


def effective_role(role: str, claims: dict) -> str:
    return role if role == "user" or claims.get("email_verified") else "user"      # elevated roles need a verified email


def user_from_claims(claims: dict) -> sqlite3.Row:
    """Find or create the account for this Firebase uid. A first sign-in creates a reader (or applies a role granted to the email)."""
    uid, email = claims["sub"], str(claims.get("email") or "").lower()[:254]
    name = str(claims.get("name") or "")[:80] or None
    now, auth_t = time.time(), float(claims.get("auth_time") or 0)
    with db() as c:
        r = c.execute("select * from users where uid=?", (uid,)).fetchone()
        if not r:
            g = c.execute("select role from grants where email=?", (email,)).fetchone() if email else None
            c.execute("insert into users(uid, email, name, role, active, created_at, last_auth) values (?,?,?,?,1,?,?)",
                      (uid, email, name, g["role"] if g else "user", now, auth_t))
            r = c.execute("select * from users where uid=?", (uid,)).fetchone()
            audit(email, "account_created", detail={"role": r["role"], "provider": (claims.get("firebase") or {}).get("sign_in_provider")})
        elif auth_t > (r["last_auth"] or 0):
            c.execute("update users set last_auth=?, email=?, name=coalesce(?, name) where uid=?", (auth_t, email or r["email"], name, uid))
            audit(email, "sign_in", detail={"mfa": bool((claims.get("firebase") or {}).get("sign_in_second_factor"))})
            r = c.execute("select * from users where uid=?", (uid,)).fetchone()
    return r


def require(min_role: Role):
    """Dependency for every protected endpoint: 401 without a valid Firebase token, 403 below the role, inactive, or (admin) without MFA."""
    def dep(request: Request) -> dict:
        tok = _bearer(request)
        if not tok:
            if not project_id():
                raise HTTPException(503, "Accounts are not configured on this deployment.")
            raise HTTPException(401, "Sign in to use this.")
        claims = verify_token(tok)
        r = user_from_claims(claims)
        if not r["active"]:
            raise HTTPException(403, "Your access has been removed. Contact an administrator.")
        role = effective_role(r["role"], claims)
        if RANK[role] < RANK[min_role]:
            raise HTTPException(403, "Your role does not allow this." if role == r["role"] else "Verify your email address to use this role.")
        if RANK[min_role] >= RANK["officer"] and time.time() - float(claims.get("auth_time") or 0) > ABSOLUTE_S:
            raise HTTPException(401, "Sessions last 8 hours. Sign in again.")
        if min_role == "admin" and not (claims.get("firebase") or {}).get("sign_in_second_factor"):
            raise HTTPException(403, "mfa_required")
        if request.method not in ("GET", "HEAD"):
            now = time.time(); recent = [t for t in _writes.get(r["uid"], []) if now - t < 60]
            if len(recent) >= 60:
                raise HTTPException(429, "Too many changes in a minute. Wait a moment.")
            _writes[r["uid"]] = recent + [now]
        return public_user(r, claims)
    return dep


# ------------------------------------------------------------------ endpoints
router = APIRouter()


@router.get("/api/auth/config")
def auth_config():
    return {"provider": "firebase", "configured": bool(project_id()), "roles": ["public", "user", "officer", "admin"], "admin_mfa": True,
            "session_hours": ABSOLUTE_S // 3600}


@router.get("/api/auth/me")
def me(user: dict = Depends(require("user"))):
    return {"user": user}


class Grant(BaseModel):
    email: str = Field(max_length=254)
    role: Role


class UserPatch(BaseModel):
    role: Optional[Role] = None
    active: Optional[bool] = None


@router.get("/api/admin/users")
def admin_users(admin: dict = Depends(require("admin"))):
    with db() as c:
        users = c.execute("select * from users order by created_at").fetchall()
        grants = c.execute("select email, role, granted_by, granted_at from grants order by granted_at desc").fetchall()
    return {"users": [public_user(r) for r in users], "grants": [dict(g) for g in grants]}


@router.post("/api/admin/grants")
def admin_grant(body: Grant, admin: dict = Depends(require("admin"))):
    """Give a role to an email address. Applies now if that person already has an account, otherwise at their first sign-in."""
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address.")
    if email == admin["email"]:
        raise HTTPException(422, "You cannot change your own role.")
    with db() as c:
        c.execute("insert into grants(email, role, granted_by, granted_at) values (?,?,?,?) on conflict(email) do update set role=excluded.role, "
                  "granted_by=excluded.granted_by, granted_at=excluded.granted_at", (email, body.role, admin["email"], time.time()))
        c.execute("update users set role=? where email=?", (body.role, email))
    audit(admin["email"], "role_grant", email, {"role": body.role})
    return {"ok": True}


@router.post("/api/admin/users/{uid}")
def admin_update_user(uid: str, body: UserPatch, admin: dict = Depends(require("admin"))):
    if uid == admin["uid"]:
        raise HTTPException(422, "You cannot change your own role or status.")
    with db() as c:
        r = c.execute("select * from users where uid=?", (uid,)).fetchone()
        if not r:
            raise HTTPException(404, "No such account.")
        if body.role:
            c.execute("update users set role=? where uid=?", (body.role, uid))
        if body.active is not None:
            c.execute("update users set active=? where uid=?", (1 if body.active else 0, uid))
        r2 = c.execute("select * from users where uid=?", (uid,)).fetchone()
    audit(admin["email"], "user_update", r["email"], {k: v for k, v in body.model_dump().items() if v is not None})
    return {"user": public_user(r2)}


@router.get("/api/admin/audit")
def admin_audit(limit: int = 200, admin: dict = Depends(require("admin"))):
    limit = max(1, min(limit, 1000))
    with db() as c:
        rows = c.execute("select ts, actor, action, target, detail from audit order by id desc limit ?", (limit,)).fetchall()
    return {"entries": [dict(r) | {"detail": json.loads(r["detail"]) if r["detail"] else None} for r in rows]}


# ------------------------------------------------------------------ CLI: bootstrap the first administrator (no credentials stored here)
def _cli(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="python -m dengueshield.api.auth")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grant", help="give a role to an email; applies at that person's next sign-in with Firebase")
    g.add_argument("--email", required=True); g.add_argument("--role", choices=list(RANK), required=True)
    a = ap.parse_args(argv)
    email = a.email.strip().lower()
    if not EMAIL_RE.match(email):
        print("error: enter a valid email address", file=sys.stderr); return 1
    with db() as c:
        c.execute("insert into grants(email, role, granted_by, granted_at) values (?,?,?,?) on conflict(email) do update set role=excluded.role, "
                  "granted_by=excluded.granted_by, granted_at=excluded.granted_at", (email, a.role, "cli", time.time()))
        c.execute("update users set role=? where email=?", (a.role, email))
    audit("cli", "role_grant", email, {"role": a.role})
    print(f"granted {a.role} to {email} in {db_path()}; it applies at their next sign-in (verified email required for officer/admin)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
