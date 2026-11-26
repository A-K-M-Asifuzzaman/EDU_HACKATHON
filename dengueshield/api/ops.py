"""Protected officer workflows (V4): internal alert management and response planning. Server-enforced roles: officer or admin for review
and drafting; admin only to approve a plan. Every change is written to the audit log. Planning aid on synthetic data: plans hold generic
option identifiers and a note, never quantities, orders or messages; nothing is sent anywhere.
"""
from __future__ import annotations

import json
import re
import time
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from dengueshield.api.auth import audit, db, require

router = APIRouter()
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STATUSES = ("acknowledged", "escalated", "dismissed", "resolved")
OPTIONS = {   # the generic options shown on Response Intelligence; ids only, the text lives in the UI
    "source_reduction": "Source reduction in high-risk wards",
    "larval_surveillance": "Targeted larval surveillance",
    "public_guidance": "Public guidance through established channels",
    "facility_readiness": "Health-facility readiness review",
    "vector_control_review": "Targeted vector control review",
}


def _week(origin: str, horizon: int):
    if not DATE_RE.match(origin) or horizon not in (2, 3, 4):
        raise HTTPException(422, "origin must be YYYY-MM-DD and horizon 2, 3 or 4")
    from dengueshield.api.main import risk_wards                     # lazy: main imports this module
    return risk_wards(origin=origin, horizon=horizon, source=None, city=None, tier=None, q=None, sort="p_outbreak", order="desc", limit=60)


@router.get("/api/ops/alerts")
def ops_alerts(origin: str, horizon: int = Query(3), user: dict = Depends(require("officer"))):
    wk = _week(origin, horizon)
    with db() as c:
        rev = {r["ward_id"]: dict(r) for r in c.execute("select ward_id, status, note, updated_by, updated_at from alert_reviews where origin=? and horizon=?", (origin, horizon))}
    alerts = [{"ward_id": w["ward_id"], "city": w["city"], "p_outbreak": w["p_outbreak"], "median_cases": w["median_cases"], "risk_tier": w["risk_tier"],
               "lower_80": w["lower_80"], "upper_80": w["upper_80"], "review": rev.get(w["ward_id"])} for w in wk["wards"] if w["outbreak_alert"]]
    counts = {s: sum(1 for a in alerts if a["review"] and a["review"]["status"] == s) for s in STATUSES}
    counts["unreviewed"] = sum(1 for a in alerts if not a["review"])
    return {"origin": origin, "horizon": horizon, "source": wk["source"], "alerts": alerts, "counts": counts,
            "note": "Internal review of model alerts on synthetic data. Not an official warning; nothing is sent."}


class ReviewIn(BaseModel):
    ward_id: str = Field(max_length=40)
    origin: str = Field(max_length=10)
    horizon: int
    status: Literal["acknowledged", "escalated", "dismissed", "resolved"]
    note: Optional[str] = Field(None, max_length=500)


@router.post("/api/ops/alerts/review")
def ops_review(body: ReviewIn, user: dict = Depends(require("officer"))):
    wk = _week(body.origin, body.horizon)
    if body.ward_id not in {w["ward_id"] for w in wk["wards"]}:
        raise HTTPException(404, "Unknown ward for this week.")
    now = time.time()
    with db() as c:
        c.execute("""insert into alert_reviews(ward_id, origin, horizon, status, note, updated_by, updated_at) values (?,?,?,?,?,?,?)
                     on conflict(ward_id, origin, horizon) do update set status=excluded.status, note=excluded.note, updated_by=excluded.updated_by,
                     updated_at=excluded.updated_at""", (body.ward_id, body.origin, body.horizon, body.status, (body.note or "").strip() or None, user["email"], now))
    audit(user["email"], "alert_review", f"{body.ward_id}@{body.origin}/h{body.horizon}", {"status": body.status})
    return {"ok": True, "review": {"status": body.status, "note": body.note, "updated_by": user["email"], "updated_at": now}}


class PlanIn(BaseModel):
    ward_id: str = Field(max_length=40)
    origin: str = Field(max_length=10)
    horizon: int
    options: list[str] = Field(min_length=1, max_length=len(OPTIONS))
    note: Optional[str] = Field(None, max_length=800)


def _plan(r) -> dict:
    return {k: r[k] for k in ("id", "ward_id", "origin", "horizon", "note", "status", "created_by", "approved_by", "created_at", "updated_at")} | {"options": json.loads(r["options"])}


@router.get("/api/ops/plans")
def ops_plans(origin: Optional[str] = None, user: dict = Depends(require("officer"))):
    with db() as c:
        rows = (c.execute("select * from plans where origin=? order by id desc", (origin,)) if origin else c.execute("select * from plans order by id desc limit 200")).fetchall()
    return {"plans": [_plan(r) for r in rows], "options": OPTIONS}


@router.post("/api/ops/plans")
def ops_create_plan(body: PlanIn, user: dict = Depends(require("officer"))):
    bad = [o for o in body.options if o not in OPTIONS]
    if bad:
        raise HTTPException(422, f"Unknown option: {bad[0]}")
    wk = _week(body.origin, body.horizon)
    if body.ward_id not in {w["ward_id"] for w in wk["wards"]}:
        raise HTTPException(404, "Unknown ward for this week.")
    now = time.time()
    with db() as c:
        cur = c.execute("insert into plans(ward_id, origin, horizon, options, note, status, created_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
                        (body.ward_id, body.origin, body.horizon, json.dumps(sorted(set(body.options))), (body.note or "").strip() or None, "draft", user["email"], now, now))
        r = c.execute("select * from plans where id=?", (cur.lastrowid,)).fetchone()
    audit(user["email"], "plan_create", f"plan {r['id']} {body.ward_id}@{body.origin}", {"options": json.loads(r["options"])})
    return {"plan": _plan(r)}


@router.post("/api/ops/plans/{plan_id}/approve")
def ops_approve_plan(plan_id: int, admin: dict = Depends(require("admin"))):
    with db() as c:
        r = c.execute("select * from plans where id=?", (plan_id,)).fetchone()
        if not r:
            raise HTTPException(404, "No such plan.")
        if r["created_by"] == admin["email"]:
            raise HTTPException(422, "A plan needs approval from someone other than its author.")
        c.execute("update plans set status='approved', approved_by=?, updated_at=? where id=?", (admin["email"], time.time(), plan_id))
        r = c.execute("select * from plans where id=?", (plan_id,)).fetchone()
    audit(admin["email"], "plan_approve", f"plan {plan_id}")
    return {"plan": _plan(r)}
