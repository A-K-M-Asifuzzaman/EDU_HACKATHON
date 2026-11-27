"""DengueShield AI API. Real inference from the serialized bundle; precomputed research artifacts; no 2025 data.

    uvicorn dengueshield.api.main:app --port 8000
"""
from __future__ import annotations

import base64
import hashlib
import json
import hmac
import math
import os
import re
import subprocess
import time
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Optional

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from dengueshield import decision, routing
from dengueshield import allocation as alloc
from dengueshield import overflow as ovf
from dengueshield import intervention as iv
from dengueshield import dispatch as dsp
from dengueshield import preparedness as prep
from dengueshield.onsite_data import ONSITE_SHA256 as ONSITE_SHA256_, load_onsite_development_panel
from dengueshield.api import climate, geo, integrations
from dengueshield import offline as offline_mode
if offline_mode.requested():                       # scripts/launch_offline.sh: loopback only, every other connection refused and recorded
    offline_mode.enable()
from dengueshield.api.schemas import ChatRequest, ForecastItem
from dengueshield.api.store import HORIZONS, ROOT, STARTED, TIER_ORDER, Store, records

app = FastAPI(title="DengueShield AI API", version="1.0.0",
              description="Ward-level dengue forecasting (2-4 weeks ahead). Historical Replay on the organizer dataset (2016-2024); the 2025 holdout is locked.")
app.add_middleware(GZipMiddleware, minimum_size=2000)
from dengueshield.api.guard import BodyLimit  # noqa: E402
app.add_middleware(BodyLimit, paths=("/api/assistant/chat",))
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])
S = Store()
H = Annotated[int, Query(ge=2, le=4, description="forecast horizon in weeks (2, 3 or 4)")]
@app.middleware("http")
async def access_gate(request: Request, call_next):
    """Optional shared-password gate (HTTP Basic, any username) for private deployments. Off unless ACCESS_PASSWORD is set; /api/health stays open for platform probes."""
    pw = os.environ.get("ACCESS_PASSWORD")
    if pw and request.url.path != "/api/health":
        try:
            given = base64.b64decode(request.headers.get("authorization", "")[6:]).decode().split(":", 1)[1]
        except Exception:
            given = ""
        if not hmac.compare_digest(given.encode(), pw.encode()):
            return JSONResponse({"detail": "Authentication required"}, status_code=401, headers={"WWW-Authenticate": 'Basic realm="DengueShield AI (team preview)"'})
    return await call_next(request)


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DISCLAIMER = ("Historical Replay on a synthetic competition dataset (2016-2024). Not a live surveillance system. Risk tiers are statistical categories "
              "derived from training quantiles, not official public-health warning levels.")


# ------------------------------------------------------------------ helpers
def bad(msg: str, code: int = 422):
    raise HTTPException(code, msg)


def ward_check(w: str) -> str:
    if w not in S.ward_ids:
        bad(f"unknown ward_id '{w}'. See GET /api/wards", 404)
    return w


def origin_check(o: str) -> str:
    if not DATE_RE.match(o):
        bad("origin must be YYYY-MM-DD")
    try:
        d = pd.Timestamp(o)
    except Exception:
        bad("origin is not a valid date")
    if d.dayofweek != 0:
        bad("origin must be a Monday (weekly grid)")
    return o


def src_default(origin: str, horizon: int) -> str:
    r = S.origin_range().get("replay", {}).get(horizon)
    return "replay" if r and r["min"] <= origin <= r["max"] else "bundle"


def need(what: str):
    try:
        S.need(what)
    except RuntimeError as e:
        raise HTTPException(503, str(e))


def forecast_frame(origin: str, horizon: int, source: str) -> pd.DataFrame:
    """Unified forecast table for all wards at one origin/horizon."""
    if source == "replay":
        need("replay")
        r = S.replay[(S.replay.origin_date == origin) & (S.replay.horizon == horizon)]
        if r.empty:
            rng = S.origin_range().get("replay", {}).get(horizon, {})
            target = (pd.Timestamp(origin) + pd.Timedelta(weeks=horizon)).date().isoformat()
            hint = (f"The deployed bundle was trained on weeks through {S.bundle.train_cutoff}, so source=bundle would be in-sample for target "
                    f"{target}, not an out-of-time forecast." if S.bundle is not None and target <= S.bundle.train_cutoff
                    else "Use source=bundle for the forward forecast.")
            bad(f"no validated replay for origin {origin} at h={horizon}: each season was replayed by models fitted on earlier seasons only, "
                f"so a target in the following season has none (replay origins span {rng.get('min')} to {rng.get('max')}). {hint}")
        out = r.rename(columns={"mean": "expected_cases", "median": "median_cases", "lo80": "lower_80", "hi80": "upper_80", "lo90": "lower_90",
                                "hi90": "upper_90", "alert": "outbreak_alert", "tier": "risk_tier", "y_true": "actual_cases", "thr_q90": "outbreak_threshold"}).copy()
        out["source"], out["in_sample"] = "replay", False
        return out.drop(columns=["year", "p_outbreak"]).assign(p_outbreak=r.p_outbreak.to_numpy())
    need("bundle"), need("dataset")
    try:
        p = S.bundle_forecast(origin, horizon)
    except ValueError as e:
        bad(str(e))
    out = p.rename(columns={"expected_cases": "expected_cases", "median_cases": "median_cases"}).copy()
    out["origin_date"] = out.origin_date.dt.date.astype(str)
    out["target_date"] = out.target_date.dt.date.astype(str)
    out["median_cases"] = out.median_cases.astype(int)
    for c in ("lower_80", "upper_80", "lower_90", "upper_90"):
        out[c] = out[c].astype(int)
    out["source"] = "bundle"
    out["in_sample"] = pd.to_datetime(out.target_date) <= pd.Timestamp(S.bundle.train_cutoff)
    act = S.panel.set_index(["ward_id", "date"]).dengue_cases
    td = pd.Timestamp(out.target_date.iloc[0])
    out["actual_cases"] = [int(act.get((w, td))) if (w, td) in act.index else None for w in out.ward_id]
    out["outbreak_threshold"] = S.bundle.horizons[horizon].thresholds["outbreak"]
    return out.rename(columns={"risk_tier": "risk_tier"})


def items(df: pd.DataFrame) -> list:
    cols = list(ForecastItem.model_fields)
    return [ForecastItem(**{k: r.get(k) for k in cols if k in r}).model_dump() for r in records(df[[c for c in cols if c in df.columns]])]


def availability(origin: str) -> list:
    """Which rainfall week drives each horizon (target - 3 weeks) and whether it is observed at the start-of-week origin."""
    o = pd.Timestamp(origin)
    out = []
    for h in HORIZONS:
        wk = o + pd.Timedelta(weeks=h - 3)
        last_obs = o - pd.Timedelta(weeks=1)
        obs = wk <= last_obs
        out.append({"horizon": h, "key_rain_week": wk.date().isoformat(), "observed_at_origin": bool(obs),
                    "treatment": "observed rainfall" if obs else "past-year climatology projection (no future weather is used)",
                    "latest_observed_week": last_obs.date().isoformat()})
    return out


# ------------------------------------------------------------------ system
_PROBE = {"t": 0.0, "v": None}


def _inference_probe():
    """One-ward live prediction timing, cached for 5 minutes and serialised with other heavy model calls.
    Platform health checks hit /api/health every few seconds; without this each one ran a ~100 MB prediction."""
    if S.bundle is None or S.panel is None:
        return None
    if time.time() - _PROBE["t"] < 300 and _PROBE["v"] is not None:
        return _PROBE["v"]
    o = (S.last_week - pd.Timedelta(weeks=8)).date().isoformat()

    def run():
        t = time.perf_counter()
        S.bundle.predict(S.panel, o, 3, wards=[S.wards.ward_id.iloc[0]])
        return round((time.perf_counter() - t) * 1000, 1)
    try:
        _PROBE.update(t=time.time(), v=S._heavy(run))
    except Exception as e:
        S.errors["probe"] = str(e)
    return _PROBE["v"]


def _build_commit() -> Optional[str]:
    """The source commit this server runs: app_data/BUILD_COMMIT (written by scripts/deploy_space.py), else git, with -dirty when
    tracked files differ from the commit. Shown in the site footer so a recording can be matched to the submitted commit."""
    f = ROOT / "app_data" / "BUILD_COMMIT"
    if f.exists():
        return f.read_text().strip()[:12] or None
    try:
        sha = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        return (sha + ("-dirty" if dirty else "")) if sha else None
    except (OSError, subprocess.SubprocessError):
        return None


BUILD_COMMIT = _build_commit()


@app.get("/api/health")
def health():
    ok = {"dataset": S.panel is not None, "bundle": S.bundle is not None, "replay": S.replay is not None, "artifacts": not [k for k in S.errors if k in S.art or k in ("profile",)]}
    probe = _inference_probe()
    status = "ok" if all(ok.values()) else ("degraded" if ok["bundle"] or ok["replay"] else "down")
    return {"status": status, "components": ok, "errors": S.errors, "uptime_s": round(time.time() - STARTED), "inference_probe_ms": probe,
            "latency_ms": S.latency_ms, "openai_configured": integrations.openai_configured(), "cache_entries": len(S.cache),
            "build_commit": BUILD_COMMIT}


@app.get("/api/system/offline")
def system_offline():
    """Offline readiness: mode, local artifacts, external assets in the built dashboard, service states and blocked outbound attempts."""
    arts, _ = S.cache.get_or(("offline_artifacts",), lambda: offline_mode.check_artifacts())
    return {"offline_mode": offline_mode.active(), "build_commit": BUILD_COMMIT, "artifacts_ok": all(a["ok"] for a in arts), "artifacts": arts,
            "external_assets": offline_mode.external_assets(), "services": offline_mode.SERVICES_OFFLINE if offline_mode.active() else None,
            "blocked_attempts": list(offline_mode.BLOCKED), "blocked_count": len(offline_mode.BLOCKED),
            "note": "Offline mode is set by scripts/launch_offline.sh (DENGUESHIELD_OFFLINE=1). Blocked attempts come from optional services only."}


@app.get("/api/metadata")
def metadata():
    b = S.bundle
    champ = S.art.get("validation", {}).get("champion", {})
    return {"product": "DengueShield AI", "tagline": "Predict Earlier. Respond Smarter.", "mode": "Historical Replay",
            "disclaimer": DISCLAIMER, "model": {"name": "Ridge Poisson GLM (24 features, F8)", "bundle_version": b.version if b else None,
                                                "bundle_sha256": getattr(S, "bundle_sha", None), "trained_through": b.train_cutoff if b else None,
                                                "convention": b.convention if b else None, "horizons": list(HORIZONS),
                                                "features": len(b.horizons[2].cols) if b else None, "environment": b.env if b else None},
            "convention_note": "Convention B: the forecast is issued on the Monday that labels week t, so data are usable up to week t-1.",
            "data": {"development_years": "2016-2024", "wards": len(S.wards), "cities": sorted(S.wards.city.unique().tolist()) if len(S.wards) else [],
                     "last_observed_week": S.last_week.date().isoformat() if S.panel is not None else None,
                     "dataset_sha256": getattr(S, "data_sha", None), "holdout": "2025 is locked and excluded from everything shown here",
                     "license": "Organizer-provided hackathon dataset; redistribution terms not stated in the brief (dataset is not committed)."},
            "origins": S.origin_range(), "risk_tiers": {"labels": ["Low", "Medium", "High", "Critical"], "definition": "training-quantile cut points q60/q80/q95 of weekly cases",
                                                         "official": False},
            "champion": champ.get("per_horizon"), "limits": champ.get("failed_models")}


@app.get("/api/cities")
def cities():
    w = S.wards
    g = w.groupby("city").agg(wards=("ward_id", "size"), mean_density=("population_density_sqkm", "mean"), mean_waterlogging=("water_logging_risk_index", "mean"),
                              mean_sanitation=("sanitation_score", "mean")).round(3).reset_index()
    return records(g)


@app.get("/api/wards")
def wards(city: Optional[str] = None, q: Optional[str] = Query(None, max_length=40)):
    w = S.wards
    if city:
        w = w[w.city == city]
    if q:
        w = w[w.ward_id.str.contains(q, case=False, regex=False)]
    return records(w)


# ------------------------------------------------------------------ forecasting
@app.get("/api/forecast")
def forecast(ward_id: str, origin: str, horizon: H = 3, source: Optional[Literal["replay", "bundle"]] = None, drivers: bool = True):
    ward_check(ward_id), origin_check(origin)
    source = source or src_default(origin, horizon)
    df = forecast_frame(origin, horizon, source)
    r = df[df.ward_id == ward_id]
    if r.empty:
        bad("ward not present for this origin", 404)
    out = {"forecast": items(r)[0], "availability": availability(origin), "disclaimer": DISCLAIMER}
    if drivers and S.bundle is not None and S.panel is not None:
        try:
            d = S.drivers(origin, horizon)
            row = d[d.ward_id == ward_id].iloc[0].to_dict()
            ward_id_ = row.pop("ward_id")
            out["drivers"] = {"log_rate_contributions": {k: round(float(v), 4) for k, v in row.items()}, "source": "deployed bundle coefficients x standardised inputs",
                              "note": "Associations learned from a synthetic dataset; not causal."}
        except Exception as e:
            out["drivers"] = {"unavailable": str(e)}
    return out


@app.get("/api/forecast/rainfall-what-if")
def rainfall_what_if(ward_id: str, origin: str, horizon: H = 3, change_pct: Annotated[int, Query(ge=-30, le=30)] = 0,
                     mode: Literal["observed", "upcoming"] = "upcoming"):
    """Re-run the saved model with hypothetical rainfall (dengueshield/whatif.py). Never multiplies case counts."""
    from dengueshield import whatif
    ward_check(ward_id), origin_check(origin)
    if S.bundle is None or S.panel is None:
        raise HTTPException(503, "model bundle not loaded")
    city = next((w["city"] for w in S.wards_list() if w["ward_id"] == ward_id), None) if hasattr(S, "wards_list") else None
    if city is None:
        city = str(S.panel.loc[S.panel.ward_id == ward_id, "city"].iloc[0])
    key = ("whatif", S.bundle_sha, ward_id, origin, horizon, change_pct, mode)
    try:
        v, _ = S.cache.get_or(key, lambda: S._heavy(lambda: whatif.rainfall_what_if(S.bundle, S.panel, origin, horizon, ward_id, city, change_pct, mode)))
    except ValueError as e:
        bad(str(e))
    return v


@app.get("/api/forecast/compare")
def forecast_compare(ward_id: str, origin: str, source: Optional[Literal["replay", "bundle"]] = None):
    ward_check(ward_id), origin_check(origin)
    res = []
    for h in HORIZONS:
        s = source or src_default(origin, h)
        try:
            df = forecast_frame(origin, h, s)
        except HTTPException as e:
            res.append({"horizon": h, "error": e.detail})
            continue
        res.append(items(df[df.ward_id == ward_id])[0])
    return {"ward_id": ward_id, "origin": origin, "forecasts": res, "availability": availability(origin), "disclaimer": DISCLAIMER}


@app.get("/api/forecast/series")
def forecast_series(ward_id: str, horizon: H = 3, year: Optional[int] = Query(None, ge=2019, le=2024), origin: Optional[str] = None):
    """Out-of-time Historical Replay: median, mean, intervals and observed cases per target week (validation seasons 2019-2024).
    With `origin` (alone or with `year`): after the last replay season, that season is followed by the origin's own 2-4 week forward
    forecasts (`forward: true`, observed cases locked); without `year`, the origin picks its season, and an origin before the first
    season gives an empty series."""
    ward_check(ward_id), need("replay")
    r = S.replay[(S.replay.ward_id == ward_id) & (S.replay.horizon == horizon)]
    ahead: list = []
    if origin:
        origin_check(origin)
        first, last, oy = int(S.replay.year.min()), int(S.replay.year.max()), int(origin[:4])
        if year is None:
            year = min(oy, last)
            if oy < first:
                r = r.iloc[0:0]
        if oy > last and year == last:
            ahead = [{"origin_date": f["origin_date"], "target_date": f["target_date"], "horizon": f["horizon"], "y_true": None, "mean": f["expected_cases"], "median": f["median_cases"],
                      "lo80": f["lower_80"], "hi80": f["upper_80"], "lo90": f["lower_90"], "hi90": f["upper_90"], "p_outbreak": f["p_outbreak"], "tier": f.get("risk_tier"), "forward": True}
                     for f in forecast_compare(ward_id, origin)["forecasts"] if not f.get("error")]
    if year:
        r = r[r.year == year]
    r = r.sort_values("target_date")
    return {"ward_id": ward_id, "horizon": horizon, "season": year, "convention": "B_start_of_week",
            "note": "Each season was predicted by a model trained only on earlier seasons; calibration used the two preceding seasons.", "series": records(r.drop(columns=["city"])) + ahead}


@app.get("/api/risk/wards")
def risk_wards(origin: str, horizon: H = 3, source: Optional[Literal["replay", "bundle"]] = None, city: Optional[str] = None,
               tier: Optional[Literal["Low", "Medium", "High", "Critical"]] = None, q: Optional[str] = Query(None, max_length=40),
               sort: Literal["p_outbreak", "expected_cases", "median_cases", "upper_90"] = "p_outbreak", order: Literal["desc", "asc"] = "desc",
               limit: int = Query(60, ge=1, le=60)):
    origin_check(origin)
    source = source or src_default(origin, horizon)
    df = forecast_frame(origin, horizon, source)
    if city:
        df = df[df.city == city]
    if tier:
        df = df[df.risk_tier == tier]
    if q:
        df = df[df.ward_id.str.contains(q, case=False, regex=False)]
    total = len(df)
    tiers = df.risk_tier.value_counts().to_dict()                      # counts over ALL matching wards, before the row limit
    df = df.sort_values(sort, ascending=order == "asc").head(limit)
    w = S.wards.set_index("ward_id")
    rows = items(df)
    for r in rows:
        v = w.loc[r["ward_id"]]
        r["vulnerability"] = {"population_density_sqkm": int(v.population_density_sqkm), "water_logging_risk_index": float(v.water_logging_risk_index),
                              "sanitation_score": float(v.sanitation_score)}
    return {"origin": origin, "horizon": horizon, "source": source, "count": len(rows), "total_matching": total, "tier_counts": {t: int(tiers.get(t, 0)) for t in TIER_ORDER},
            "wards": rows, "availability": availability(origin), "disclaimer": DISCLAIMER}


@app.get("/api/reports/summary")
def report_summary(origin: str, horizon: H = 3, source: Optional[Literal["replay", "bundle"]] = None):
    origin_check(origin)
    source = source or src_default(origin, horizon)
    df = forecast_frame(origin, horizon, source)
    top = df.sort_values("p_outbreak", ascending=False).head(5)
    by_city = df.groupby("city").agg(expected=("expected_cases", "sum"), alerts=("outbreak_alert", "sum"), wards=("ward_id", "size")).round(2).reset_index()
    return {"origin": origin, "target_date": df.target_date.iloc[0], "horizon": horizon, "source": source,
            "wards": len(df), "expected_cases_total": round(float(df.expected_cases.sum()), 1), "median_cases_total": int(df.median_cases.sum()),
            "alerts": int(df.outbreak_alert.sum()), "tier_counts": {t: int((df.risk_tier == t).sum()) for t in TIER_ORDER},
            "mean_p_outbreak": round(float(df.p_outbreak.mean()), 4), "by_city": records(by_city), "top_wards": items(top),
            "actual_cases_total": (int(df.actual_cases.sum()) if df.actual_cases.notna().all() else None),
            "caveats": ["Peaks are under-predicted by about 3 cases on average.", "Intervals under-cover outbreak peaks (about 61% at the 80% level).",
                        "Synthetic competition dataset; not a live surveillance feed."], "disclaimer": DISCLAIMER}


# ------------------------------------------------------------------ model evidence
def art(name: str):
    if name not in S.art:
        raise HTTPException(503, f"artifact '{name}' unavailable: {S.errors.get(name)}")
    return S.art[name]


@app.get("/api/model/metrics")
def model_metrics():
    v = art("validation")
    return {"champion": v["champion"], "by_season": v["champion_by_season"], "stage2_vs_stage3": v["stage2_vs_stage3"], "limits": v["limits"],
            "convention_comparison": v["convention_comparison"]}


@app.get("/api/model/features")
def model_features():
    v = art("validation")
    return {k: v[k] for k in ("top_features", "f8_features", "permutation_groups", "permutation_joint", "glm_coefficients", "ablation_family", "forward_step",
                              "availability", "feature_leaderboard", "stage1_vs_stage2")}


@app.get("/api/model/validation")
def model_validation():
    v = art("validation")
    return {k: v[k] for k in ("leaderboard", "champion_by_season", "optuna", "paired_vs_glm", "convention_comparison", "stage2_vs_stage3", "error_by_city", "limits")}


@app.get("/api/model/canonical-metrics")
def model_canonical_metrics():
    """One versioned source for every reported model metric (built by scripts/build_canonical_metrics.py from the replay table).
    Regimes are labelled: out-of-time replay 2019–2024, the 2022–2024 selection window (validation, not blind), sealed 2025."""
    f = ROOT / "app_data" / "metrics_canonical.json"
    if not f.exists():
        raise HTTPException(503, "canonical metrics not built: run python scripts/build_canonical_metrics.py")
    v, _ = S.cache.get_or(("canonical", f.stat().st_mtime), lambda: json.loads(f.read_text()))
    return v


@app.get("/api/research/v3")
def research_v3():
    """Pre-registered V3 research results (research/v3/PREREGISTRATION.md). Research candidates only: production intervals and the
    alert rule are unchanged. Built by research/v3/e1_e4_calibration.py from saved out-of-time replay predictions."""
    d = ROOT / "research" / "v3" / "results"
    out = {"status": "research candidates; not deployed", "preregistration": "research/v3/PREREGISTRATION.md"}
    for name in ("e1_intervals", "e4_alert"):
        f = d / f"{name}.json"
        out[name] = json.loads(f.read_text()) if f.exists() else None
    if out["e1_intervals"]:
        summ = {}
        for h, x in out["e1_intervals"]["by_horizon"].items():
            ss = x["seasons"]
            avg = lambda side, k: round(float(np.mean([s_["80"][side][k] for s_ in ss])), 3)
            summ[h] = {"verdict": x["verdict"], "seasons_passing": x["seasons_passing"], "seasons": [s_["season"] for s_ in ss],
                       **{f"{side}_{k}": avg(side, k) for side in ("baseline", "candidate") for k in ("peaks", "positive_below_peak", "all", "width", "interval_score")}}
        out["e1_summary"] = summ
    vf = d / "e1_verification.json"                                     # independent verification (research/v3/verify_e1.py)
    if vf.exists():
        v = json.loads(vf.read_text())
        by_bin = {}
        for h, x in v["by_horizon"].items():                             # pooled 80% coverage per predicted-mean bin over the 4 seasons (row-weighted)
            n = np.array([s_["n_eval_rows_by_mu_bin"] for s_ in x["seasons"]], float)
            cov = lambda key: [round(float(np.nansum(np.array([[c if c is not None else np.nan for c in s_[key]] for s_ in x["seasons"]], float)[:, b] * n[:, b]) / n[:, b].sum()), 3) for b in range(n.shape[1])]
            by_bin[h] = {"bins": ["<0.5", "0.5–2", "2–5", "5–10", "≥10"], "n": [int(c) for c in n.sum(0)],
                         "baseline": cov("baseline_80_coverage_by_mu_bin"), "candidate": cov("candidate_80_coverage_by_mu_bin")}
        out["e1_verification"] = {"recommendation": "INSUFFICIENT EVIDENCE to promote; deployed intervals retained",
                                  "reproduces_saved_results_exactly": v["reproduces_saved_results_exactly"],
                                  "by_horizon": {h: {k: x[k] for k in ("peak80_season_mean", "peak80_pooled_rows_2021_2024", "peak80_gain_pooled_ward_bootstrap_95ci",
                                                                        "positive80_pooled", "all80_pooled", "width80_pooled", "audit_rule_per_bin_within_5pts")} for h, x in v["by_horizon"].items()},
                                  "coverage_by_mu_bin": by_bin}
    return out


_MC: dict = {}


@app.get("/api/model/comparison")
def model_comparison():
    """Unified model comparison (convention B): Stage 3 tournament, V3 classical benchmarks and baselines on identical folds.
    Built by scripts/model_comparison/build_model_comparison.py from saved results; validation only (2025 sealed)."""
    f = ROOT / "app_data" / "model_comparison.json"
    if not f.exists():
        raise HTTPException(404, "model comparison not built (run scripts/model_comparison/build_model_comparison.py)")
    m = f.stat().st_mtime
    if _MC.get("mtime") != m:
        _MC.update(mtime=m, data=json.loads(f.read_text()))
    return _MC["data"]


@app.get("/api/model/comparison.csv", include_in_schema=False)
def model_comparison_csv():
    f = ROOT / "app_data" / "MODEL_COMPARISON.csv"
    if not f.exists():
        raise HTTPException(404, "model comparison CSV not built")
    return FileResponse(f, media_type="text/csv", filename="DengueShield_MODEL_COMPARISON.csv")


@app.get("/api/model/calibration")
def model_calibration():
    v = art("validation")
    return {k: v[k] for k in ("interval_coverage", "interval_coverage_detail", "peak_methods", "risk_schemes")}


@app.get("/api/model/diagnostics")
def model_diagnostics(horizon: H = 3):
    """Out-of-time diagnostics computed from the Historical Replay table (seasons 2019-2024): residuals, actual vs predicted, bias by outcome size, alert reliability."""
    need("replay")
    key = ("diag", horizon)
    def build():
        r = S.replay[S.replay.horizon == horizon].copy()
        res = r["median"] - r.y_true
        edges = np.arange(-15.5, 16.5, 1.0)
        hist, _ = np.histogram(res.clip(-15, 15), bins=edges)
        cap = 25
        heat = np.zeros((cap + 1, cap + 1), int)
        np.add.at(heat, (np.minimum(r.y_true.to_numpy().astype(int), cap), np.minimum(r["median"].to_numpy().astype(int), cap)), 1)
        bucket = pd.cut(r.y_true, [-1, 0, 2, 5, 9, 13, 20, 1000], labels=["0", "1-2", "3-5", "6-9", "10-13", "14-20", "21+"])
        by = r.assign(bucket=bucket, err=res, abs=res.abs(), under=res < 0).groupby("bucket", observed=True).agg(n=("err", "size"), bias=("err", "mean"), mae=("abs", "mean"), under_share=("under", "mean")).round(3).reset_index()
        hi = r.y_true >= r.thr_q90
        rel = r.assign(bin=pd.cut(r.p_outbreak, np.linspace(0, 1, 11), include_lowest=True), hit=hi).groupby("bin", observed=True).agg(n=("hit", "size"), predicted=("p_outbreak", "mean"), observed=("hit", "mean")).round(4).reset_index()
        rel["bin"] = rel["bin"].astype(str)
        seas = r.assign(err=res, abs=res.abs(), sq=res ** 2).groupby("year").agg(n=("abs", "size"), mae=("abs", "mean"), rmse=("sq", lambda x: float(np.sqrt(x.mean()))), bias=("err", "mean")).round(3).reset_index()
        cov80 = ((r.y_true >= r.lo80) & (r.y_true <= r.hi80)); cov90 = ((r.y_true >= r.lo90) & (r.y_true <= r.hi90))
        return {"horizon": horizon, "n": int(len(r)), "mae": round(float(res.abs().mean()), 4), "rmse": round(float(np.sqrt((res ** 2).mean())), 4), "bias": round(float(res.mean()), 4),
                "mae_mean_forecast": round(float((r["mean"] - r.y_true).abs().mean()), 4), "high_incidence": {"n": int(hi.sum()), "mae": round(float(res[hi].abs().mean()), 3), "bias": round(float(res[hi].mean()), 3), "under_share": round(float((res[hi] < 0).mean()), 3)},
                "alert": {"recall": round(float(r.alert[hi].mean()), 3), "precision": round(float(hi[r.alert].mean()), 3), "false_alert_rate": round(float(r.alert[~hi].mean()), 3), "note": "pooled over all validation rows"},
                "coverage": {"80": round(float(cov80.mean()), 3), "90": round(float(cov90.mean()), 3), "80_high_weeks": round(float(cov80[hi].mean()), 3), "90_high_weeks": round(float(cov90[hi].mean()), 3),
                             "mean_width_80": round(float((r.hi80 - r.lo80).mean()), 2), "mean_width_90": round(float((r.hi90 - r.lo90).mean()), 2)},
                "residual_hist": {"edges": edges[:-1].tolist(), "counts": hist.tolist()}, "heatmap": {"cap": cap, "counts": heat.tolist()}, "by_outcome_size": by.astype({"bucket": str}).to_dict("records"),
                "reliability": rel.to_dict("records"), "by_season": seas.to_dict("records"), "source": "Historical Replay, convention B, seasons 2019-2024 (out-of-time)"}
    v, _ = S.cache.get_or(key, build)
    return v


# ------------------------------------------------------------------ data profiling
@app.get("/api/data/profile")
def data_profile():
    return art("profile")


@app.get("/api/data/distributions")
def data_distributions():
    return art("distributions")


@app.get("/api/data/correlations")
def data_correlations():
    return art("correlations")


@app.get("/api/data/seasonality")
def data_seasonality():
    return art("seasonality")


@app.get("/api/data/lag-analysis")
def data_lag():
    return art("lag_analysis")


# ------------------------------------------------------------------ weather
@app.get("/api/weather/historical")
def weather_historical(ward_id: Optional[str] = None, city: Optional[str] = None, start: str = "2016-01-04", end: str = "2024-12-30",
                       metric: Literal["rainfall_mm", "avg_temp_c", "relative_humidity_pct", "dengue_cases"] = "rainfall_mm"):
    """Organizer (synthetic) weather by week, development years only."""
    need("dataset")
    for d in (start, end):
        if not DATE_RE.match(d):
            bad("dates must be YYYY-MM-DD")
    full = S.panel
    if ward_id:
        full = full[full.ward_id == ward_check(ward_id)]
        scope = ward_id
    elif city:
        full = full[full.city == city]
        scope = city
    else:
        scope = "all wards"
    p = full[(full.date >= start) & (full.date <= min(end, "2024-12-31"))]
    if p.empty:
        bad("no data for the selection", 404)
    g = p.groupby("date")[["rainfall_mm", "avg_temp_c", "relative_humidity_pct", "dengue_cases"]].mean().round(3).reset_index()
    g["date"] = g.date.dt.date.astype(str)
    # typical-for-the-week = mean over ALL development years (2016-2024) of the same scope, never just the requested window
    clim = full.assign(woy=full.date.dt.isocalendar().week.astype(int).clip(upper=52)).groupby("woy")[metric].mean().round(3)
    return {"scope": scope, "source": "organizer dataset (synthetic weather)", "metric": metric, "rows": records(g), "climatology_by_iso_week": clim.to_dict(),
            "provenance": "Training weather. Not real-world observations."}


ORGANIZER_CITY = {"Dhaka": ["Dhaka North", "Dhaka South"], "Chattogram": ["Chattogram"], "Gazipur": ["Gazipur"], "Narayanganj": ["Narayanganj"]}
CityName = Literal["Dhaka", "Chattogram", "Gazipur", "Narayanganj"]


@app.get("/api/climate/observations")
def climate_observations(provider: Literal["nasa_power", "open_meteo"] = "nasa_power", city: CityName = "Dhaka", start: str = "2016-01-01", end: str = "2024-12-31",
                         daily: bool = False):
    """REAL climate observations/reanalysis (not the synthetic organizer data). Never used by the forecasting model."""
    for d in (start, end):
        if not DATE_RE.match(d):
            bad("dates must be YYYY-MM-DD")
    out = climate.observations(provider, city, start, end, daily)
    if out["status"] == "bad_request":
        bad(out["error"])
    return JSONResponse(out, status_code=200 if out["status"] == "ok" else 503)


@app.get("/api/climate/current")
def climate_current(city: CityName = "Dhaka"):
    out = climate.current_and_forecast(city)
    return JSONResponse(out, status_code=200 if out["status"] == "ok" else 503)


def organizer_reference(city: str) -> Optional[dict]:
    if S.panel is None:
        return None
    p = S.panel[S.panel.city.isin(ORGANIZER_CITY[city])]
    m = p.assign(month=p.date.dt.month).groupby("month")[["rainfall_mm", "avg_temp_c", "relative_humidity_pct"]].mean()
    return {"label": "Organizer dataset (SYNTHETIC), development years 2016-2024", "cities": ORGANIZER_CITY[city],
            "monthly_climatology": [{"month": int(k), "temp_c": round(float(r.avg_temp_c), 2), "rh_pct": round(float(r.relative_humidity_pct), 2),
                                     "rain_mm": round(float(r.rainfall_mm) * 365.25 / 12 / 7, 1)} for k, r in m.iterrows()],
            "note": "Monthly rain is the mean weekly total x 4.35 (approximation); the organizer weather is synthetic and need not resemble real climate."}


@app.get("/api/climate/compare")
def climate_compare(city: CityName = "Dhaka", start: str = "2016-01-01", end: str = "2024-12-31"):
    """NASA POWER vs Open-Meteo vs the synthetic organizer weather, side by side. Three separate sources; nothing is blended."""
    for d in (start, end):
        if not DATE_RE.match(d):
            bad("dates must be YYYY-MM-DD")
    res = {pid: climate.observations(pid, city, start, end) for pid in ("nasa_power", "open_meteo")}
    for r in res.values():
        if r["status"] == "bad_request":
            bad(r["error"])
    clim = {pid: (r["monthly_climatology"] if r["status"] == "ok" else None) for pid, r in res.items()}
    delta = None
    if clim["nasa_power"] and clim["open_meteo"]:
        n, o = {r["month"]: r for r in clim["nasa_power"]}, {r["month"]: r for r in clim["open_meteo"]}
        delta = [{"month": m, "rain_mm_nasa_minus_openmeteo": round(n[m]["rain_mm"] - o[m]["rain_mm"], 1), "temp_c_diff": round(n[m]["temp_c"] - o[m]["temp_c"], 2),
                  "rh_pct_diff": round(n[m]["rh_pct"] - o[m]["rh_pct"], 2)} for m in n if m in o]
    return {"city": city, "range": {"start": start, "end": end}, "sources": {pid: {"status": r["status"], "provenance": r["provenance"], "cache": r.get("cache"), "grid_point": r.get("grid_point"),
                                                                                  "extremes": r.get("extremes"), "error": r.get("error")} for pid, r in res.items()},
            "monthly_climatology": clim, "provider_disagreement": delta, "organizer_reference": organizer_reference(city),
            "caveats": ["NASA POWER and Open-Meteo are model/reanalysis products at city-centre coordinates, not rain-gauge measurements, and they can disagree substantially on rainfall.",
                        "Coarse grids tend to overcount light-rain days; wet days use a >= 1 mm threshold (stated convention).",
                        "Neither real source is an input to the validated forecasting model, which was trained on the synthetic organizer weather."]}




# ------------------------------------------------------------------ decision support (retrospective, saved out-of-time replay only)
def _replay_or_503():
    if S.replay is None or S.panel is None:
        raise HTTPException(503, "replay or dataset not loaded")
    return S.replay


@app.get("/api/decision/alert-curve")
def alert_curve(horizon: Optional[H] = None, years: Annotated[Optional[str], Query(pattern=r"^20(19|2[0-4])(,20(19|2[0-4]))*$")] = None):
    """Retrospective alert-policy explorer over 2019-2024 out-of-time predictions. The deployed rule is unchanged."""
    R = _replay_or_503()
    ys = sorted({int(y) for y in years.split(",")}) if years else None
    v, _ = S.cache.get_or(("alert_curve", horizon, tuple(ys or ())), lambda: decision.alert_curve(R, horizon, ys))
    return v


@app.get("/api/decision/allocate")
def decision_allocate(origin: str, horizon: H = 3, teams: Annotated[int, Query(ge=1, le=60)] = 10):
    R = _replay_or_503()
    if not DATE_RE.match(origin):
        bad("origin must be YYYY-MM-DD")
    try:
        v, _ = S.cache.get_or(("allocate", origin, horizon, teams), lambda: decision.allocate(R, S.panel, origin, horizon, teams))
    except ValueError as e:
        bad(str(e))
    return v


@app.get("/api/decision/allocation-season")
def decision_allocation_season(year: Annotated[int, Query(ge=2019, le=2024)], horizon: H = 3, teams: Annotated[int, Query(ge=1, le=60)] = 10):
    R = _replay_or_503()
    v, _ = S.cache.get_or(("alloc_season", year, horizon, teams), lambda: decision.allocation_season(R, S.panel, year, horizon, teams))
    return v


# ------------------------------------------------------------------ Phase 2 onsite, Problem 1: constrained resource allocation
ALLOC_LAST_ORIGIN = "2024-12-30"      # owner decision: forecasts issued in 2024 or earlier; January 2025 targets only from 2024 origins
ALLOC_ASSUMPTIONS = [
    "Demand: saline, kits and beds follow the dataset's own rule, floor(m x forecast cases + 0.5), identified on 2016-2018 only.",
    "Stock is not in the dataset. Each city receives the chosen share (30-100%) of its own projected requirement; cities never share supply.",
    "Fairness floor: every ward first receives that share of its demand (never more than the stock level), then the rest goes by priority.",
    "Priority = risk weight x outbreak probability + (1 - risk weight) x population density / highest density of the 60 wards.",
    "Crews are not in the dataset. A ward with forecast cases needs 1 crew, plus 1 per extra block of cases, up to the per-ward maximum; "
    "crews go first to as many wards as possible in priority order.",
    "Beds here are the configured regional bed supply. They are not local hospital capacity; overflow routing (Problem 2) uses a separate, "
    "illustrative capacity baseline and does not add these beds on top of it.",
    "Only out-of-time forecasts are used: the validated replay for 2019-2024 targets, the deployed model for January 2025 targets.",
    "Forecasts are planning estimates on synthetic data, not official orders or warnings.",
]
_ALLOC_RULES: dict | None = None


def decision_forecast(origin: str, horizon: int, source: Optional[str], city: Optional[str]) -> tuple[pd.DataFrame, str]:
    """Forecast table for the decision engines (Problems 1 and 2). Origin-safe only: in-sample output of the deployed bundle (trained on
    2016-2024) is refused here rather than labelled, because a plan built on it would look better than any real forecast could."""
    origin_check(origin)
    if origin > ALLOC_LAST_ORIGIN:
        bad(f"decision tools use forecasts issued on or before {ALLOC_LAST_ORIGIN} (2025 is the sealed test year); "
            f"the forecast issued {ALLOC_LAST_ORIGIN} covers targets in January 2025", 422)
    if city and city not in set(S.wards.city):
        bad(f"unknown city '{city}'", 404)
    source = source or src_default(origin, horizon)
    fc = forecast_frame(origin, horizon, source)
    if bool(fc.in_sample.any()):
        rng = S.origin_range().get("replay", {}).get(horizon, {})
        bad(f"in-sample forecast refused: the deployed model was trained on weeks through {S.bundle.train_cutoff}, which include the target "
            f"week {fc.target_date.iloc[0]}, so its output there is not an out-of-time forecast. Use the validated replay (origins "
            f"{rng.get('min')} to {rng.get('max')} at h={horizon}) or a December 2024 origin whose target lies in 2025.")
    return (fc[fc.city == city] if city else fc), source


def alloc_rules() -> dict:
    global _ALLOC_RULES
    if _ALLOC_RULES is None:
        _ALLOC_RULES = alloc.load_rules()
    return _ALLOC_RULES


@app.get("/api/allocation/plan")
def allocation_plan(origin: str, horizon: H = 3, city: Optional[str] = Query(None, max_length=40),
                    service: Literal["median", "p80", "p90"] = "p80", stock: Annotated[float, Query(ge=0.30, le=1.00)] = 0.6,
                    crews: Annotated[int, Query(ge=0, le=1000)] = 20, risk_weight: Annotated[float, Query(ge=0.0, le=1.0)] = 0.7,
                    floor: Annotated[float, Query(ge=0.0, le=0.5)] = 0.25, cases_per_crew: Annotated[int, Query(ge=1, le=100)] = 10,
                    max_crews_per_ward: Annotated[int, Query(ge=1, le=10)] = 3, source: Optional[Literal["replay", "bundle"]] = None):
    """Allocate saline, diagnostic kits, beds and spraying crews to wards under scarcity (dengueshield/allocation.py)."""
    fc, source = decision_forecast(origin, horizon, source, city)
    st = alloc.Settings(service=service, stock=round(stock, 4), crews=crews, alpha=round(risk_weight, 4), floor_share=round(floor, 4),
                        cases_per_crew=cases_per_crew, max_crews_per_ward=max_crews_per_ward)
    rules = alloc_rules()

    def compute():
        res = alloc.plan(fc[["ward_id", "city", "median_cases", "upper_80", "upper_90", "p_outbreak", "risk_tier"]], S.wards, rules, st)
        wards_out = []
        for r in res["wards"].itertuples(index=False):
            row = {"rank": int(r.rank), "ward_id": r.ward_id, "city": r.city, "risk_tier": r.risk_tier, "p_outbreak": round(float(r.p_outbreak), 4),
                   "population_density_sqkm": int(r.population_density_sqkm), "priority": round(float(r.priority), 4),
                   "forecast_cases": int(r.cases), "median_cases": int(r.median_cases), "upper_80": int(r.upper_80), "upper_90": int(r.upper_90),
                   "crews_needed": int(r.crews_needed), "crews_assigned": int(r.crews_assigned), "fill_rate": round(float(r.fill_rate), 4), "status": r.status}
            for k in alloc.RESOURCES:
                row[k] = {"demand": int(getattr(r, f"{k}_demand")), "allocated": int(getattr(r, f"{k}_allocated")), "unmet": int(getattr(r, f"{k}_unmet"))}
            wards_out.append(row)
        target = str(fc.target_date.iloc[0]) if len(fc) else None
        return {"origin": origin, "horizon": horizon, "target_date": target, "source": source, "city": city or "All",
                "settings": {"service": service, "service_label": alloc.SERVICE_LABEL[service], "stock": st.stock, "crews": crews,
                             "risk_weight": st.alpha, "density_weight": round(1 - st.alpha, 4), "floor": st.floor_share,
                             "cases_per_crew": cases_per_crew, "max_crews_per_ward": max_crews_per_ward},
                "multipliers": rules, "totals": res["totals"], "cities": res["cities"], "counts": res["counts"],
                "wards": wards_out, "assumptions": ALLOC_ASSUMPTIONS, "disclaimer": DISCLAIMER}

    try:
        v, _ = S.cache.get_or(("alloc_plan", origin, horizon, source, city, st), compute)
    except ValueError as e:
        bad(str(e))
    return v


@app.get("/api/allocation/uncertainty")
def allocation_uncertainty(
    origin: str, horizon: H = 3, city: Optional[str] = Query(None, max_length=40),
    service: Literal["median", "p80", "p90"] = "p80", stock: Annotated[float, Query(ge=0.30, le=1.00)] = 0.6,
    risk_weight: Annotated[float, Query(ge=0.0, le=1.0)] = 0.7, floor: Annotated[float, Query(ge=0.0, le=0.5)] = 0.25,
    source: Optional[Literal["replay", "bundle"]] = None,
    resource: Literal["saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required"] = "saline_bags_needed",
    reserve_pct: Annotated[int, Query(ge=0, le=30)] = 0,
    supply_units: Annotated[Optional[int], Query(ge=0, le=100_000)] = None,
):
    """Compare matched-budget policies over complete historical residual weeks. The active plan is untouched."""
    from dengueshield import allocation_uncertainty as uncertainty

    if supply_units is not None and not city:
        bad("Select one city before setting an exact supply quantity.")
    need("replay")
    fc, source = decision_forecast(origin, horizon, source, city)
    settings = alloc.Settings(service=service, stock=round(stock, 4), alpha=round(risk_weight, 4), floor_share=round(floor, 4))
    key = ("allocation_uncertainty", origin, horizon, source, city, settings, resource, reserve_pct, supply_units)

    def compute():
        rules = alloc_rules()
        wards = alloc.plan(fc, S.wards, rules, settings)["wards"].sort_values("ward_id", ignore_index=True)
        keys = wards.ward_id.tolist()
        joint, history, weeks = uncertainty.joint_cases(S.replay, origin, horizon, keys, wards.median_cases.to_numpy())
        demand = alloc.demand(joint, rules[resource])
        pools = []
        for pool, g in wards.groupby("city", sort=True):
            indices = g.index.to_numpy()
            nominal = g[f"{resource}_demand"].to_numpy()
            supply = alloc.pool_supply(settings.stock, int(nominal.sum())) if supply_units is None else supply_units
            results = uncertainty.compare_pool(
                g.ward_id.tolist(), nominal, demand[:, indices], supply, reserve_pct, settings.floor_share,
                g.population_density_sqkm.to_numpy(), history[indices], g.p_outbreak.to_numpy(), g.priority.to_numpy(),
            )
            pools.append({"city": pool, **results})
        return {"origin": origin, "horizon": horizon, "source": source, "resource": resource, "service": service,
                "reserve_pct": reserve_pct, "tail_confidence": uncertainty.CONFIDENCE, "prior_replay_weeks": weeks,
                "cities": pools,
                "assumptions": ["Each scenario shifts the current median by a complete ward residual vector from prior seasons.",
                                "Historical weeks are within two ISO weeks of the forecast origin. No future outcomes are used.",
                                "All policies share the same city stock, reserve, ward ceilings and fairness floors.",
                                "The tail objective is assessed on these planning scenarios. It is not validated forecast coverage."],
                "disclaimer": DISCLAIMER}

    try:
        v, _ = S.cache.get_or(key, compute)
    except ValueError as exc:
        bad(str(exc))
    return v


# ------------------------------------------------------------------ hospital surge and cross-ward overflow (Phase 2 onsite, Problem 2)
SURGE_ASSUMPTIONS = [
    "Projected bed demand is the same number Supply allocation uses: floor(0.2984 x forecast cases + 0.5) at the chosen service level.",
    "Ward capacity is an illustrative planning scenario, not a hospital inventory (the dataset has none). Default: the 90th percentile of the "
    "ward's own weekly bed requirement in the weeks before the forecast origin (k-th smallest of n weeks, k = ceil(9n/10)).",
    "The capacity percentage scales that baseline with round-half-up to whole beds; a ward value typed in replaces it.",
    "Patients move only to wards with spare beds in the same city. No distances or travel times exist for the synthetic ward IDs, so none are "
    "assumed: every ward in a city is an equally valid destination.",
    "Transfers first place as many patients as possible, then relieve the most overloaded wards first and draw on the wards with the most "
    "spare beds first. Ties: the ward with the higher outbreak probability is relieved first, the ward with the lower outbreak probability "
    "receives first (high-risk wards keep their spare beds), then ward ID.",
    "The regional bed supply from Supply allocation is a separate stock scenario. It is shown for comparison and never added to ward capacity, "
    "because both describe the same beds.",
    "Forecasts are planning estimates on synthetic data, not official orders or warnings.",
]
_BED_HISTORY: Optional[pd.DataFrame] = None


def bed_history() -> pd.DataFrame:
    """Weekly hospital_beds_required, 2016-2024 only (the onsite loader drops 2025 rows as bytes before parsing)."""
    global _BED_HISTORY
    if _BED_HISTORY is None:
        try:
            _BED_HISTORY = load_onsite_development_panel()[["ward_id", "date", "hospital_beds_required"]]
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(503, f"onsite dataset unavailable for the capacity baseline: {e}")
    return _BED_HISTORY


def name_values(values: Optional[list[str]], what: str, valid: set, hi: int) -> dict[str, int]:
    """Parse repeated NAME:number query values (city percentages, ward overrides)."""
    if values and len(values) > 60:
        bad(f"at most 60 {what} values")
    out: dict[str, int] = {}
    for v in values or []:
        k, sep, n = v.rpartition(":")
        if not sep or not n.isdigit() or len(v) > 80:
            bad(f"{what} values must look like NAME:whole-number, got '{v[:80]}'")
        if k not in valid:
            bad(f"unknown {what} '{k[:40]}'")
        if int(n) > hi:
            bad(f"{what} value for {k} must be between 0 and {hi}")
        out[k] = int(n)
    return out


def ward_capacity(wards: pd.DataFrame, origin: str, capacity_pct: int, cpct: dict, ovr: dict) -> pd.DataFrame:
    """Stage 2 illustrative capacity for the given wards (ward_id, city): baseline, history_weeks, pct, capacity, overridden."""
    base, _ = S.cache.get_or(("bed_baseline", origin), lambda: ovf.capacity_baseline(bed_history(), origin))
    df = wards[["ward_id", "city"]].merge(base, on="ward_id", how="left", validate="one_to_one")
    if df.baseline.isna().any():
        bad("capacity baseline missing for some wards", 503)
    df["pct"] = [cpct.get(c, capacity_pct) for c in df.city]
    df["capacity"] = ovf.scale(df.baseline.astype(int), df.pct)
    df["overridden"] = df.ward_id.isin(ovr)
    df.loc[df.overridden, "capacity"] = df.loc[df.overridden, "ward_id"].map(ovr)
    return df.drop(columns="city")


@app.get("/api/overflow/plan")
def overflow_plan(origin: str, horizon: H = 3, city: Optional[str] = Query(None, max_length=40),
                  service: Literal["median", "p80", "p90"] = "p80", capacity_pct: Annotated[int, Query(ge=0, le=ovf.MAX_PCT)] = 100,
                  city_pct: Annotated[Optional[list[str]], Query()] = None, override: Annotated[Optional[list[str]], Query()] = None,
                  stock: Annotated[float, Query(ge=0.30, le=1.00)] = 0.6, source: Optional[Literal["replay", "bundle"]] = None):
    """Hospital surge: projected bed demand vs illustrative ward capacity, with capacity-constrained transfers inside each city."""
    fc, source = decision_forecast(origin, horizon, source, city)
    cpct = name_values(city_pct, "city", set(S.wards.city), ovf.MAX_PCT)
    ovr = name_values(override, "ward", set(S.ward_ids), 500)
    rules = alloc_rules()
    key = ("overflow", origin, horizon, source, city, service, capacity_pct, tuple(sorted(cpct.items())), tuple(sorted(ovr.items())), round(stock, 4))

    def compute():
        df = fc[["ward_id", "city", "risk_tier", "p_outbreak", "median_cases", "upper_80", "upper_90"]].merge(
            ward_capacity(fc, origin, capacity_pct, cpct, ovr), on="ward_id", how="left", validate="one_to_one")
        for lvl, col in alloc.SERVICE_COLUMN.items():
            df[f"beds_{lvl}"] = alloc.demand(df[col], rules["hospital_beds_required"])
        df["demand"] = df[f"beds_{service}"]
        res = ovf.plan(df)
        w = res["wards"].sort_values(["city", "deficit", "headroom", "ward_id"], ascending=[True, False, True, True])
        wards_out = [{"ward_id": r.ward_id, "city": r.city, "risk_tier": r.risk_tier, "p_outbreak": round(float(r.p_outbreak), 4),
                      "forecast_cases": {"median": int(r.median_cases), "p80": int(r.upper_80), "p90": int(r.upper_90)},
                      "bed_demand": {"median": int(r.beds_median), "p80": int(r.beds_p80), "p90": int(r.beds_p90)},
                      "demand": int(r.demand), "capacity_baseline": int(r.baseline), "capacity_pct": int(r.pct), "capacity": int(r.capacity),
                      "overridden": bool(r.overridden), "history_weeks": int(r.history_weeks), "deficit": int(r.deficit), "headroom": int(r.headroom),
                      "sent": int(r.sent), "received": int(r.received), "unresolved": int(r.unresolved), "headroom_after": int(r.headroom_after),
                      "occupied_after": int(r.occupied_after), "utilization_after": round(r.occupied_after / r.capacity, 4) if r.capacity else None,
                      "status": r.status} for r in w.itertuples(index=False)]
        for c in res["cities"]:
            c["regional_supply_scenario"] = alloc.pool_supply(stock, c["demand"])
        t = res["totals"]
        return {"origin": origin, "horizon": horizon, "target_date": str(fc.target_date.iloc[0]) if len(fc) else None, "source": source,
                "city": city or "All",
                "settings": {"service": service, "service_label": alloc.SERVICE_LABEL[service], "capacity_pct": capacity_pct,
                             "city_pct": cpct, "overrides": {k: v for k, v in ovr.items() if k in set(df.ward_id)}, "stock": round(stock, 4)},
                "capacity_rule": {"quantile": 0.9, "statistic": "k-th smallest of the n weeks before the origin, k = ceil(9n/10)",
                                  "weeks_before": origin, "history_weeks": int(df.history_weeks.min()), "scaling": "floor(baseline x pct / 100 + 1/2)"},
                "scenarios": {"projected_bed_demand": t["demand"], "illustrative_capacity": t["capacity"], "transferable_headroom": t["headroom"],
                              "allocated_transfers": t["transferred"], "unresolved_shortage": t["unresolved"],
                              "regional_supply_scenario": sum(c["regional_supply_scenario"] for c in res["cities"])},
                "totals": t, "cities": res["cities"], "transfers": res["transfers"], "wards": wards_out,
                "assumptions": SURGE_ASSUMPTIONS, "disclaimer": DISCLAIMER}

    try:
        v, _ = S.cache.get_or(key, compute)
    except ValueError as e:
        bad(str(e))
    return v


# ------------------------------------------------------------------ vector-control scenario simulator (Phase 2 onsite, Problem 3)
VECTOR_DISCLOSURE = {
    "observed": "Weekly cases, weather and resource requirements for 2016-2024 from the organizer dataset (synthetic). They trained and replayed "
                "the forecasts and set the illustrative bed capacity; target-week outcomes are never read, and 2025 stays sealed.",
    "forecast": "Saved, origin-safe forecasts of expected weekly cases: the validated replay for 2019-2024 targets (each season forecast by models "
                "fitted on earlier seasons only) and the deployed model only past its training window. The deployed model is unchanged.",
    "assumptions": "Maximum reduction, coverage per crew, delay and build-up are scenario assumptions set by the user. Presets are illustrative; "
                   "the dataset contains no spraying or larvicide records and no intervention outcomes, so no efficacy was measured.",
    "scenario": "Scenario cases = (1 - reduction) x forecast cases. Cases prevented, resource savings and hospital changes are counterfactual "
                "estimates under those assumptions, not predictions of what will happen.",
    "limitations": [
        "No causal effect is estimated: without intervention records the data cannot identify one.",
        "Coverage per crew is an interpretation (share of a ward one crew can treat); wards have no area or breeding-site data, so every ward "
        "is treated alike.",
        "A single deployment at the forecast origin is assumed to persist through week 4; waning, repeat rounds and spill-over between "
        "neighbouring wards are not modelled.",
        "The reduction scales the forecast proportionally, including its 80% and 90% range ends; transmission feedback is not simulated.",
        "Forecast error carries into every estimate, largest at outbreak peaks.",
    ],
}


@app.get("/api/intervention/simulate")
def intervention_simulate(origin: str, horizon: H = 3, city: Optional[str] = Query(None, max_length=40),
                          service: Literal["median", "p80", "p90"] = "p80", source: Optional[Literal["replay", "bundle"]] = None,
                          mode: Literal["optimized", "manual", "stage1"] = "optimized",
                          crews: Annotated[int, Query(ge=0, le=1000)] = 20, max_crews_per_ward: Annotated[int, Query(ge=1, le=10)] = 3,
                          assign: Annotated[Optional[list[str]], Query()] = None,
                          effect: Annotated[float, Query(ge=0.0, le=iv.MAX_EFFECT)] = 0.30, coverage: Annotated[float, Query(ge=0.05, le=1.0)] = 0.35,
                          delay: Annotated[int, Query(ge=0, le=3)] = 1, buildup: Annotated[int, Query(ge=1, le=3)] = 2,
                          sens_low: Annotated[float, Query(ge=0.0, le=1.0)] = 0.5, sens_high: Annotated[float, Query(ge=1.0, le=2.0)] = 1.5,
                          stock: Annotated[float, Query(ge=0.30, le=1.00)] = 0.6, risk_weight: Annotated[float, Query(ge=0.0, le=1.0)] = 0.7,
                          floor: Annotated[float, Query(ge=0.0, le=0.5)] = 0.25, cases_per_crew: Annotated[int, Query(ge=1, le=100)] = 10,
                          capacity_pct: Annotated[int, Query(ge=0, le=ovf.MAX_PCT)] = 100,
                          city_pct: Annotated[Optional[list[str]], Query()] = None, override: Annotated[Optional[list[str]], Query()] = None):
    """Assumption-driven vector-control scenario: crews -> scenario cases at 2, 3 and 4 weeks -> resource demand and hospital overflow."""
    fcs, missing = {}, {}
    for h in iv.HORIZONS:
        try:
            fcs[h], _ = decision_forecast(origin, h, source, city)
        except HTTPException as e:
            if e.status_code != 422:
                raise
            missing[h] = e.detail
    if horizon not in fcs:
        bad(f"no out-of-time forecast at the planning horizon h={horizon}: {missing[horizon]}")
    eff = iv.Effect(round(effect, 4), round(coverage, 4), delay, buildup, round(sens_low, 4), round(sens_high, 4))
    try:
        eff.validate()
    except ValueError as e:
        bad(str(e))
    cpct = name_values(city_pct, "city", set(S.wards.city), ovf.MAX_PCT)
    ovr = name_values(override, "ward", set(S.ward_ids), 500)
    base_fc = fcs[horizon].sort_values(["city", "ward_id"], ignore_index=True)
    order = base_fc.ward_id.tolist()
    manual = name_values(assign, "ward", set(S.ward_ids), 10) if mode == "manual" else {}
    if set(manual) - set(order):
        bad(f"manual crews for wards outside this view: {sorted(set(manual) - set(order))[:5]}")
    if any(v > max_crews_per_ward for v in manual.values()):
        bad(f"at most {max_crews_per_ward} crews per ward")
    if sum(manual.values()) > crews:
        bad(f"manual assignment uses {sum(manual.values())} crews but only {crews} are available")
    st = alloc.Settings(service=service, stock=round(stock, 4), crews=crews, alpha=round(risk_weight, 4), floor_share=round(floor, 4),
                        cases_per_crew=cases_per_crew, max_crews_per_ward=max_crews_per_ward)
    rules = alloc_rules()
    key = ("intervention", origin, horizon, source, city, service, mode, tuple(sorted(manual.items())), eff, st, capacity_pct,
           tuple(sorted(cpct.items())), tuple(sorted(ovr.items())))

    def compute():
        avail = sorted(fcs)
        mu = {h: fcs[h].set_index("ward_id").loc[order, "expected_cases"].to_numpy(float) for h in avail}
        weight = iv.window_weight(mu, eff)
        p = base_fc.p_outbreak.to_numpy(float)
        tie = [(-round(float(p[i]), 6), order[i]) for i in range(len(order))]
        cols = ["ward_id", "city", "median_cases", "upper_80", "upper_90", "p_outbreak", "risk_tier"]
        s1 = alloc.plan(base_fc[cols], S.wards, rules, st)
        k_stage1 = s1["wards"].set_index("ward_id").loc[order, "crews_assigned"].to_numpy(np.int64)
        k_opt = iv.optimise(weight, crews, max_crews_per_ward, eff, tie)
        k = {"optimized": k_opt, "stage1": k_stage1, "manual": np.array([manual.get(w, 0) for w in order], dtype=np.int64)}[mode]
        sim = iv.simulate(mu, k, eff)
        window = lambda part, kk=None: float(sum((iv.simulate(mu, kk, eff) if kk is not None else sim)[h][part].sum() for h in avail))
        prevented_w = sum(sim[h]["prevented"] for h in avail)

        # downstream: the planning horizon's service-level quantiles, scaled by the same reduction
        r_star = sim[horizon]["reduction"]
        scen_fc = base_fc[cols].copy()
        for c in ("median_cases", "upper_80", "upper_90"):
            scen_fc[c] = scen_fc[c].to_numpy(float) * (1.0 - r_star)
        s1_base = alloc.plan(base_fc[cols], S.wards, rules, st)
        fixed = {(c["city"], r): c[r]["supply"] for c in s1_base["cities"] for r in alloc.RESOURCES}
        s1_scen = alloc.plan(scen_fc, S.wards, rules, st, supply=fixed)                 # same stock: demand falls, nothing is created
        res_city = []
        for cb, cs in zip(s1_base["cities"], s1_scen["cities"]):
            row = {"city": cb["city"]}
            for r in alloc.RESOURCES:
                row[r] = {"supply": cb[r]["supply"], "baseline_demand": cb[r]["demand"], "scenario_demand": cs[r]["demand"],
                          "demand_saving": cb[r]["demand"] - cs[r]["demand"], "baseline_unmet": cb[r]["unmet"], "scenario_unmet": cs[r]["unmet"],
                          "stock_not_required": cs[r]["surplus"]}
            res_city.append(row)
        res_tot = {r: {k2: int(sum(c[r][k2] for c in res_city)) for k2 in res_city[0][alloc.RESOURCES[0]]} for r in alloc.RESOURCES} if res_city else {}

        cap = ward_capacity(base_fc, origin, capacity_pct, cpct, ovr)
        hb = base_fc[["ward_id", "city", "p_outbreak"]].merge(cap[["ward_id", "capacity"]], on="ward_id")
        col = alloc.SERVICE_COLUMN[service]
        hb["demand"] = alloc.demand(base_fc[col], rules["hospital_beds_required"])
        hs = hb.copy()
        hs["demand"] = alloc.demand(scen_fc[col], rules["hospital_beds_required"])
        ob, os_ = ovf.plan(hb), ovf.plan(hs)
        hosp_city = [{"city": a["city"], "capacity": a["capacity"], **{f"{t}_{k2}": c[k2] for t, c in (("baseline", a), ("scenario", b))
                      for k2 in ("demand", "deficit", "transferred", "unresolved", "utilization_after")}}
                     for a, b in zip(ob["cities"], os_["cities"])]

        wards_out = []
        bm = alloc.demand(base_fc[col], rules["hospital_beds_required"]), alloc.demand(scen_fc[col], rules["hospital_beds_required"])
        sm = alloc.demand(base_fc[col], rules["saline_bags_needed"]), alloc.demand(scen_fc[col], rules["saline_bags_needed"])
        for i, w in enumerate(order):
            ki = int(k[i])
            pw = float(prevented_w[i])
            wards_out.append({
                "ward_id": w, "city": base_fc.city[i], "risk_tier": base_fc.risk_tier[i], "p_outbreak": round(float(p[i]), 4), "crews": ki,
                "coverage": round(float(iv.coverage(ki, eff.coverage)), 4), "window_weight": round(float(weight[i]), 4),
                "by_horizon": {str(h): {"target_date": str(fcs[h].set_index("ward_id").at[w, "target_date"]),
                                        "baseline": round(float(sim[h]["baseline"][i]), 3), "scenario": round(float(sim[h]["scenario"][i]), 3),
                                        "prevented": round(float(sim[h]["prevented"][i]), 3), "reduction": round(float(sim[h]["reduction"][i]), 4),
                                        "prevented_low": round(float(sim[h]["prevented_low"][i]), 3),
                                        "prevented_high": round(float(sim[h]["prevented_high"][i]), 3)} for h in avail},
                "prevented_window": round(pw, 3), "per_crew": round(pw / ki, 3) if ki else None,
                "last_crew_gain": round(float(iv.marginal(weight[i], ki, eff)), 3) if ki else None,
                "next_crew_gain": round(float(iv.marginal(weight[i], ki + 1, eff)), 3) if ki < max_crews_per_ward else None,
                "beds": {"baseline": int(bm[0][i]), "scenario": int(bm[1][i])}, "saline": {"baseline": int(sm[0][i]), "scenario": int(sm[1][i])}})
        ranked = sorted((x for x in wards_out if x["crews"]), key=lambda x: (-x["per_crew"], -x["p_outbreak"], x["ward_id"]))
        for rank, x in enumerate(ranked, 1):
            x["roi_rank"] = rank
        assigned = [i for i in range(len(order)) if k[i] > 0]
        open_ = [i for i in range(len(order)) if k[i] < max_crews_per_ward]
        tot = {"crews": {"total": crews, "assigned": int(k.sum()), "unassigned": int(crews - k.sum()), "max_per_ward": max_crews_per_ward},
               "by_horizon": {str(h): {"baseline": round(float(sim[h]["baseline"].sum()), 3), "scenario": round(float(sim[h]["scenario"].sum()), 3),
                                       "prevented": round(float(sim[h]["prevented"].sum()), 3), "prevented_low": round(float(sim[h]["prevented_low"].sum()), 3),
                                       "prevented_high": round(float(sim[h]["prevented_high"].sum()), 3),
                                       "timing": iv.timing(h, eff.delay, eff.buildup)} for h in avail},
               "prevented_window": round(window("prevented"), 3), "prevented_window_low": round(window("prevented_low"), 3),
               "prevented_window_high": round(window("prevented_high"), 3), "baseline_window": round(window("baseline"), 3),
               "per_crew": round(window("prevented") / int(k.sum()), 3) if k.sum() else None,
               "weakest_assigned_gain": round(min(float(iv.marginal(weight[i], k[i], eff)) for i in assigned), 3) if assigned else None,
               "best_unused_gain": round(max(float(iv.marginal(weight[i], k[i] + 1, eff)) for i in open_), 3) if open_ else None,
               "compare": {"optimized": round(window("prevented", k_opt), 3), "stage1_rule": round(window("prevented", k_stage1), 3),
                           "current": round(window("prevented"), 3)},
               "crews_by_city": {c: int(sum(int(k[i]) for i in range(len(order)) if base_fc.city[i] == c)) for c in sorted(set(base_fc.city))}}
        sens = [{"effect_multiplier": m, "delay": dl, "prevented_window": round(float(sum(iv.simulate(
                    mu, k, iv.Effect(min(iv.MAX_EFFECT, eff.max_reduction * m), eff.coverage, dl, eff.buildup))[h]["prevented"].sum() for h in avail)), 3)}
                for m in sorted({eff.sens_low, 1.0, eff.sens_high}) for dl in (0, 1, 2, 3)]
        curve = [{"crews": kk, "coverage": round(float(iv.coverage(kk, eff.coverage)), 4),
                  **{f"reduction_h{h}": round(float(iv.reduction(kk, h, eff)), 4) for h in avail}} for kk in range(max_crews_per_ward + 1)]
        return {"origin": origin, "planning_horizon": horizon, "city": city or "All", "horizons": avail, "horizons_missing": {str(h): m for h, m in missing.items()},
                "sources": {str(h): str(fcs[h].source.iloc[0]) for h in avail}, "target_dates": {str(h): str(fcs[h].target_date.iloc[0]) for h in avail},
                "mode": mode,
                "settings": {"service": service, "service_label": alloc.SERVICE_LABEL[service], "effect": eff.max_reduction, "coverage": eff.coverage,
                             "delay": eff.delay, "buildup": eff.buildup, "sens_low": eff.sens_low, "sens_high": eff.sens_high, "stock": st.stock,
                             "capacity_pct": capacity_pct, "crews": crews, "max_crews_per_ward": max_crews_per_ward},
                "equations": {"coverage": "C(k) = 1 - (1 - a)^k", "timing": "T(h) = min(1, max(0, (h - d) / w))", "reduction": "R(k, h) = E x C(k) x T(h)",
                              "scenario": "scenario cases = (1 - R) x forecast cases; prevented = R x forecast cases",
                              "marginal": "g(k) = E x W x a x (1 - a)^(k - 1), W = sum over h of T(h) x forecast cases"},
                "totals": tot, "wards": wards_out, "roi": [{"rank": x["roi_rank"], "ward_id": x["ward_id"], "city": x["city"], "crews": x["crews"],
                                                            "prevented_window": x["prevented_window"], "per_crew": x["per_crew"],
                                                            "last_crew_gain": x["last_crew_gain"], "next_crew_gain": x["next_crew_gain"]} for x in ranked],
                "sensitivity": sens, "response_curve": curve,
                "resources": {"totals": res_tot, "cities": res_city,
                              "note": "Savings are lower projected demand under the scenario. Supply stays at the baseline stock; stock not required is not "
                                      "redistributed, delivered or created."},
                "hospital": {"totals": {t: {k2: o["totals"][k2] for k2 in ("demand", "capacity", "deficit", "transferred", "unresolved", "utilization_after")}
                                        for t, o in (("baseline", ob), ("scenario", os_))},
                             "cities": hosp_city, "transfers": {"baseline": ob["transfers"], "scenario": os_["transfers"]},
                             "note": "Same illustrative capacity as Hospital surge; transfers stay inside each city; Supply allocation beds are not added."},
                "disclosure": VECTOR_DISCLOSURE, "disclaimer": DISCLAIMER}

    try:
        v, _ = S.cache.get_or(key, compute)
    except ValueError as e:
        bad(str(e))
    return v


# ------------------------------------------------------------------ ward dispatch briefs (Phase 2 onsite, Stage 4)
def scenario_params(origin: str, horizon: H = 3, city: Optional[str] = Query(None, max_length=40), service: Literal["median", "p80", "p90"] = "p80",
                    source: Optional[Literal["replay", "bundle"]] = None, stock: Annotated[float, Query(ge=0.30, le=1.00)] = 0.6,
                    crews: Annotated[int, Query(ge=0, le=1000)] = 20, max_crews_per_ward: Annotated[int, Query(ge=1, le=10)] = 3,
                    risk_weight: Annotated[float, Query(ge=0.0, le=1.0)] = 0.7, floor: Annotated[float, Query(ge=0.0, le=0.5)] = 0.25,
                    cases_per_crew: Annotated[int, Query(ge=1, le=100)] = 10, capacity_pct: Annotated[int, Query(ge=0, le=ovf.MAX_PCT)] = 100,
                    city_pct: Annotated[Optional[list[str]], Query()] = None, override: Annotated[Optional[list[str]], Query()] = None,
                    mode: Literal["optimized", "manual", "stage1"] = "optimized", assign: Annotated[Optional[list[str]], Query()] = None,
                    effect: Annotated[float, Query(ge=0.0, le=iv.MAX_EFFECT)] = 0.30, coverage: Annotated[float, Query(ge=0.05, le=1.0)] = 0.35,
                    delay: Annotated[int, Query(ge=0, le=3)] = 1, buildup: Annotated[int, Query(ge=1, le=3)] = 2,
                    sens_low: Annotated[float, Query(ge=0.0, le=1.0)] = 0.5, sens_high: Annotated[float, Query(ge=1.0, le=2.0)] = 1.5,
                    scenario_v: Annotated[int, Query(ge=1, le=1)] = 1) -> dict:
    """The full planning scenario shared by Stages 1-3 (the dashboard's shared plan state)."""
    return dict(locals())


_REPLAY_SHA: Optional[str] = None


def run_scenario(p: dict):
    """Run Stages 1-3 for one scenario and return (scenario, allocation, overflow, intervention, model). Results come from the same cached
    engine calls the dashboard uses, so a brief and the dashboard always show the same numbers."""
    global _REPLAY_SHA
    a = allocation_plan(origin=p["origin"], horizon=p["horizon"], city=p["city"], service=p["service"], stock=p["stock"], crews=p["crews"],
                        risk_weight=p["risk_weight"], floor=p["floor"], cases_per_crew=p["cases_per_crew"],
                        max_crews_per_ward=p["max_crews_per_ward"], source=p["source"])
    o = overflow_plan(origin=p["origin"], horizon=p["horizon"], city=p["city"], service=p["service"], capacity_pct=p["capacity_pct"],
                      city_pct=p["city_pct"], override=p["override"], stock=p["stock"], source=p["source"])
    v = intervention_simulate(origin=p["origin"], horizon=p["horizon"], city=p["city"], service=p["service"], source=p["source"], mode=p["mode"],
                              crews=p["crews"], max_crews_per_ward=p["max_crews_per_ward"], assign=p["assign"], effect=p["effect"],
                              coverage=p["coverage"], delay=p["delay"], buildup=p["buildup"], sens_low=p["sens_low"], sens_high=p["sens_high"],
                              stock=p["stock"], risk_weight=p["risk_weight"], floor=p["floor"], cases_per_crew=p["cases_per_crew"],
                              capacity_pct=p["capacity_pct"], city_pct=p["city_pct"], override=p["override"])
    if _REPLAY_SHA is None:
        import hashlib as _h
        _REPLAY_SHA = _h.sha256((ROOT / "app_data" / "replay.csv.gz").read_bytes()).hexdigest()
    manual = name_values(p["assign"], "ward", set(S.ward_ids), 10) if p["mode"] == "manual" else {}
    st = v["settings"]
    settings = {"origin": p["origin"], "horizon": p["horizon"], "view_city": p["city"] or "All", "service": p["service"], "source": p["source"] or "auto",
                "stock": a["settings"]["stock"], "crews": p["crews"], "max_crews_per_ward": p["max_crews_per_ward"],
                "risk_weight": a["settings"]["risk_weight"], "floor": a["settings"]["floor"], "cases_per_crew": p["cases_per_crew"],
                "capacity_pct": p["capacity_pct"], "city_pct": dict(sorted(o["settings"]["city_pct"].items())),
                "overrides": dict(sorted(o["settings"]["overrides"].items())),
                "vector": {"mode": v["mode"], "assign": dict(sorted(manual.items())), "effect": st["effect"], "coverage": st["coverage"],
                           "delay": st["delay"], "buildup": st["buildup"], "sens_low": st["sens_low"], "sens_high": st["sens_high"]}}
    artifacts = {"dataset_sha256": S.data_sha, "onsite_sha256": ONSITE_SHA256_, "bundle_sha256": S.bundle_sha, "replay_sha256": _REPLAY_SHA,
                 "resource_rules": alloc_rules()}
    scenario = {"version": p["scenario_v"], "id": dsp.scenario_id(settings, artifacts), "settings": settings, "artifacts": artifacts}
    model = {"name": "DengueShield champion (Ridge Poisson GLM, 24 features)", "bundle_sha256": (S.bundle_sha or "")[:12],
             "replay_sha256": _REPLAY_SHA[:12], "data_through": S.last_week.date().isoformat()}
    return scenario, a, o, v, model


def _ward_in_view(ward: str, a: dict):
    if ward not in S.ward_ids:
        bad(f"unknown ward '{ward}'", 404)
    if ward not in {w["ward_id"] for w in a["wards"]}:
        bad(f"ward '{ward}' is outside the selected city view")


@app.get("/api/dispatch/brief")
def dispatch_brief(ward: str = Query(..., max_length=40), p: dict = Depends(scenario_params)):
    """One immutable snapshot for a ward: the canonical brief plus every text format rendered from it (SMS, WhatsApp, HTML; English and
    Bangla). Downloads use /api/dispatch/document with the same settings and carry the same scenario id and content hash."""
    scenario, a, o, v, model = run_scenario(p)
    _ward_in_view(ward, a)
    b = dsp.ward_brief(ward, scenario, a, o, v, model)
    sms = {lang: dsp.sms(b, lang) for lang in ("en", "bn")}
    return {"scenario": scenario, "content_sha256": b["content_sha256"], "brief": b,
            "formats": {"sms": {lang: {"text": t, **dsp.sms_stats(t)} for lang, t in sms.items()},
                        "whatsapp": {lang: dsp.whatsapp(b, lang) for lang in ("en", "bn")},
                        "html": {lang: dsp.html_doc([b], lang) for lang in ("en", "bn")}},
            "note": "Generated text and documents only. Nothing is sent by DengueShield."}


@app.get("/api/dispatch/document")
def dispatch_document(kind: Literal["ward", "city", "wards"], format: Literal["html", "pdf"] = "html", lang: Literal["en", "bn"] = "en",
                      ward: Optional[str] = Query(None, max_length=40), brief_city: Optional[str] = Query(None, max_length=40),
                      scope: Literal["attention", "all"] = "attention", p: dict = Depends(scenario_params)):
    """Downloadable brief: one ward, a city summary, or every ward in a city that needs attention (or all). PDFs are English (the standard
    PDF fonts have no Bengali glyphs); Bangla is in the HTML."""
    if format == "pdf" and lang == "bn":
        bad("PDF briefs are in English (the standard PDF fonts have no Bengali glyphs); use format=html for Bangla")
    scenario, a, o, v, model = run_scenario(p)
    if kind == "ward":
        if not ward:
            bad("ward is required for kind=ward")
        _ward_in_view(ward, a)
        b = dsp.ward_brief(ward, scenario, a, o, v, model)
        content, sha, name = (dsp.pdf_briefs([b]) if format == "pdf" else dsp.html_doc([b], lang).encode()), b["content_sha256"], ward
    else:
        if not brief_city:
            bad(f"brief_city is required for kind={kind}")
        if brief_city not in set(S.wards.city):
            bad(f"unknown city '{brief_city}'", 404)
        if brief_city not in {w["city"] for w in a["wards"]}:
            bad(f"city '{brief_city}' is outside the selected city view")
        if kind == "city":
            if lang == "bn":
                bad("the city summary is in English; Bangla is available in the ward briefs")
            s = dsp.city_summary(brief_city, scenario, a, o, v, model)
            content, sha = (dsp.pdf_city(s) if format == "pdf" else dsp.city_html(s).encode()), s["content_sha256"]
        else:
            ow = {w["ward_id"]: w for w in o["wards"]}
            wards = [w["ward_id"] for w in sorted(a["wards"], key=lambda w: w["rank"]) if w["city"] == brief_city
                     and (scope == "all" or w["status"] != "met" or ow[w["ward_id"]]["unresolved"] > 0)]
            if not wards:
                bad(f"no ward in {brief_city} needs attention in this scenario; use scope=all")
            briefs = [dsp.ward_brief(w, scenario, a, o, v, model) for w in wards]
            sha = dsp.digest([b["content_sha256"] for b in briefs])
            content = dsp.pdf_briefs(briefs) if format == "pdf" else dsp.html_doc(
                briefs, lang, f"DengueShield ward briefs {brief_city} {scenario['id']}").encode()
        name = f"{brief_city.replace(' ', '_')}_{kind}"
    fname = f"dengueshield_{name}_{scenario['id']}.{format}"
    return Response(content, media_type="application/pdf" if format == "pdf" else "text/html; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"', "X-Scenario-Id": scenario["id"],
                             "X-Content-SHA256": sha, "Cache-Control": "no-store", "Access-Control-Expose-Headers": "X-Scenario-Id, X-Content-SHA256"})


# ------------------------------------------------------------------ healthcare facilities, A* routing, emergency help (OpenStreetMap, ODbL)
APP_DATA_GEO = ROOT / "app_data" / "geo"
OSM_ATTR = "Facilities and roads (c) OpenStreetMap contributors, ODbL 1.0"
EMERGENCY_ELIGIBILITY = ("Emergency search lists general hospitals, plus general clinics tagged emergency=yes in OpenStreetMap. Veterinary, "
                         "diagnostic-only and specialist facilities (eye, dental, maternity, cardiac and similar), and facilities tagged emergency=no, "
                         "are left out; they stay in the directory. Most records have no emergency tag: unknown does not mean no service. "
                         "Call before travelling; in a life-threatening emergency call 999.")
FACILITY_NOTE = ("Community-mapped data, not verified by DGHS. Names, phone numbers and tagged bed counts may be outdated. "
                 "There is no live information on availability, beds, admissions or doctors on duty: call before travelling.")
Lat = Annotated[float, Query(ge=-90, le=90)]
Lon = Annotated[float, Query(ge=-180, le=180)]
EMERGENCY = {"numbers": [
    {"number": "999", "label": "National Emergency Service (police, fire service, ambulance)", "source": "Bangladesh National Emergency Service 999"},
    {"number": "16263", "label": "Shasthya Batayon: DGHS health call centre (medical advice, 24/7)", "source": "Directorate General of Health Services (DGHS)"}],
    "warning_signs": {"source": "World Health Organization, Dengue and severe dengue fact sheet",
                      "intro": "Seek medical care immediately if any of these warning signs appear, usually 24-48 hours after the fever goes down:",
                      "signs": ["severe abdominal pain", "persistent vomiting", "rapid breathing", "bleeding gums or nose", "fatigue or restlessness",
                                "blood in vomit or stool", "being very thirsty", "pale and cold skin", "feeling weak"]},
    "disclaimer": "General public-health information, not medical advice or diagnosis. In an emergency call 999."}


# ------------------------------------------------------------------ hospital preparedness and emergency surge (mentor scope)
PREP_CITIES = ["Dhaka North", "Dhaka South", "Chattogram", "Gazipur", "Narayanganj"]
PREP_PROVENANCE = [
    {"what": "Weekly dengue cases, weeks 2-4", "source": "organizer_synthetic + model_estimate", "note": "origin-safe forecast of the organizer's SYNTHETIC dataset (not real surveillance). City totals sum ward-level values at the chosen service level; a sum of ward upper bounds is not a calibrated joint city-level bound"},
    {"what": "Week 1 cases", "source": "model_estimate (scenario-derived)", "note": "midpoint of the observed week 0 and forecast week 2; the model has no 1-week horizon"},
    {"what": "Saline, kit and bed multipliers per case", "source": "organizer_synthetic", "note": "the organizer's aggregate resource rules"},
    {"what": "Planning hospitals, beds, occupancy, stock, deliveries, lead times", "source": "synthetic_demo", "note": "fictional facilities; not real hospitals"},
    {"what": "Length of stay, admission rate, reserve, shocks, closures", "source": "planning_assumption", "note": "set by the user; defaults documented"},
    {"what": "Real facilities, phones, roads", "source": "verified_public (OpenStreetMap, community-mapped)", "note": "identity and location only; capacity and availability unknown"},
]
PREP_UNKNOWN = {"capacity": "Actual hospital capacity unavailable.", "availability": "Bed availability unconfirmed — contact hospital."}


def _prep_cases(origin: str, service: str, cities: list[str], source: Optional[str]) -> tuple[dict, dict]:
    col = alloc.SERVICE_COLUMN[service]
    weekly = {c: [0.0] * 4 for c in cities}
    targets = {}
    for h in (2, 3, 4):
        fc, _ = decision_forecast(origin, h, source, None)
        targets[h] = str(fc.target_date.iloc[0])[:10]
        for c, v in fc.groupby("city")[col].sum().items():
            if c in weekly:
                weekly[c][h - 1] = float(v)
    p = S.panel
    obs = p[p.date == pd.Timestamp(origin)].groupby("city").dengue_cases.sum()
    for c in cities:
        weekly[c][0] = (float(obs.get(c, 0.0)) + weekly[c][1]) / 2
    meta = {"observed_week0": {c: int(obs.get(c, 0)) for c in cities}, "target_dates": targets}
    return weekly, meta


def _prep_signal(city: str, origin: str) -> dict:
    p = S.panel
    ser = p[(p.city == city) & (p.date <= pd.Timestamp(origin))].groupby("date").dengue_cases.sum().sort_index()
    return prep.replay_signal(ser.tolist())


def _prep_compact(state: dict) -> dict:
    """Daily rows stay on the server; the page gets weekly rows, metrics and one daily network series for the timeline."""
    hs = [h for h in state["hospitals"] if h["role"] != "referral"]
    daily = [{"day": d + 1, "needed": sum(h["daily_needed"][d] for h in hs), "occupied_other": sum(h["daily"][d]["other"] for h in hs),
              "occupied_dengue": sum(h["daily"][d]["dengue"] for h in hs), "capacity": sum(h["beds"]["capacity"] for h in hs),
              "routine_limit": sum(h["beds"]["routine_limit"] for h in hs),
              "saline": sum(h["inventory"]["saline"]["rows"][d]["closing"] for h in hs), "kits": sum(h["inventory"]["kits"]["rows"][d]["closing"] for h in hs),
              "saline_reserve": sum(h["inventory"]["saline"]["reserve"] for h in hs), "kits_reserve": sum(h["inventory"]["kits"]["reserve"] for h in hs)}
             for d in range(prep.DAYS)]
    out = []
    for h in state["hospitals"]:
        x = {k: v for k, v in h.items() if k not in ("daily", "daily_needed", "dengue_arrivals", "fixed_census")}
        x["occ"] = [[r["other"], r["dengue"], h["daily_needed"][i]] for i, r in enumerate(h["daily"])]
        x["inventory"] = {r: {k: v for k, v in inv.items() if k != "rows"} for r, inv in h["inventory"].items()}
        out.append(x)
    res = {"hospitals": out, "network": state["network"], "summary": state["summary"], "checks": state["checks"], "daily": daily}
    if "inventory_compare" in state:
        res["inventory_compare"] = state["inventory_compare"]
    return res


def _prep_after(summary: dict) -> str:
    if summary["bed_gap_after_referral"] > 0:
        return "Emergency Surge"
    if summary["saline_unmet"] or summary["kits_unmet"]:
        return "Critical"
    return "Warning" if summary["referred"] else "Normal"


def preparedness_compute(origin: str, service: str, city: str, source: Optional[str], sc: "prep.Scenario", crews: int) -> dict:
    cities = PREP_CITIES if city == "All" else [city]
    if city != "All" and city not in PREP_CITIES:
        bad(f"unknown city '{city}'", 404)
    params = {"origin": origin, "service": service, "city": city, "source": source, "crews": crews, **json.loads(sc.key())}
    key = ("preparedness", json.dumps(params, sort_keys=True))

    def compute():
        weekly, meta = _prep_cases(origin, service, cities, source)
        scen = sc
        iv_note = None
        if crews > 0:
            shares = []
            sim = intervention_simulate(origin=origin, horizon=3, city=None if city == "All" else city, service=service, source=source, mode="optimized",
                                        crews=crews, max_crews_per_ward=3, assign=None, effect=0.30, coverage=0.35, delay=1, buildup=2, sens_low=0.5,
                                        sens_high=1.5, stock=0.6, risk_weight=0.7, floor=0.25, cases_per_crew=10, capacity_pct=100, city_pct=None, override=None)
            for h in ("2", "3", "4"):
                t = sim["totals"]["by_horizon"].get(h) or {}
                shares.append(0.0 if not t.get("baseline") else min(0.9, t["prevented"] / t["baseline"]))
            scen = prep.replace(sc, prevented_share=(0.0, *shares))
            iv_note = {"crews": crews, "prevented_share_weeks_2_4": [round(x, 4) for x in shares],
                       "basis": "Stage 3 simulator, moderate assumed effect: a simulated scenario, not an observed or causal effect"}
        fx, rules = prep.load_fixture(), alloc_rules()
        base = prep.plan_state(fx, weekly, prep.Scenario(prevented_share=scen.prevented_share), rules, False)
        crisis = prep.plan_state(fx, weekly, scen, rules, False)
        resp = prep.plan_state(fx, weekly, scen, rules, True)
        resp["summary"]["status_after_response"] = _prep_after(resp["summary"])
        acts = prep.actions(base, crisis, resp)
        # the id covers every input: settings, fixture, dataset and model bundle (a changed input gives a new id)
        sid = prep.scenario_id({**params, "fixture_version": fx["version"], "fixture_sha": hashlib.sha256(prep.FIXTURE.read_bytes()).hexdigest()[:16],
                                "data_sha": getattr(S, "data_sha", None), "bundle_sha": getattr(S, "bundle_sha", None)})
        return {"scenario_id": sid, "origin": origin, "service": service, "service_label": alloc.SERVICE_LABEL.get(service, service) if hasattr(alloc, "SERVICE_LABEL") else service,
                "city": city, "cities": cities, "weekly_cases": weekly, "forecast": meta, "inputs": params, "intervention": iv_note,
                "states": {"baseline": _prep_compact(base), "crisis": _prep_compact(crisis), "response": _prep_compact(resp)},
                "actions": acts, "signals": {c: _prep_signal(c, origin) for c in cities},
                "detection_note": "Live outbreak detection unavailable. Historical replay and hypothetical outbreak stress testing are available.",
                "provenance": PREP_PROVENANCE, "fixture_label": fx["label"], "fixture_basis": fx["generated_from"], "unknown": PREP_UNKNOWN,
                "assumptions": ["All case numbers come from the organizer's synthetic competition dataset (2016-2024; 2025 sealed). Nothing is live surveillance.",
                                "City cases at the upper 80% or 90% level are sums of ward-level upper bounds. That sum is not a calibrated joint city-level bound: treat it as a conservative planning level, not a guarantee.",
                                "Week 1 is scenario-derived (midpoint of observed week 0 and forecast week 2); the model is validated only for 2-4 weeks.",
                                "Weekly admissions = round(cases x admission rate); the default rate is the organizer's bed multiplier per case.",
                                "Each admitted patient stays exactly the length of stay; existing patients leave evenly over their stay.",
                                "Routine admissions stop at the protected reserve; patients who cannot be admitted are counted as unresolved, never as occupying a bed.",
                                "Saline and kit demand = the organizer's multipliers x the hospital's share of all cases; stock never goes negative; deliveries count only from their arrival day.",
                                "Reorder point = demand during the lead time + safety stock. Order-by day = first safety-stock breach - lead time.",
                                "Referral plan: a 28-day integer program (other-illness patients keep their beds; referred patients occupy the receiver for their whole stay; fewest unresolved first, then same-city receivers), re-simulated day by day. The peak-day plan (LP checked by max-flow) is kept as a cross-check and fallback.",
                                "Emergency redistribution: on day 1 a hospital gives only stock that keeps it above its own safety stock on every day; units arrive the next day and help only unmet days after arrival (transport LP, re-simulated).",
                                "Planning rules, not clinical triage or official warning levels. No dosage or treatment instructions."],
                "disclaimer": DISCLAIMER}

    try:
        v, _ = S.cache.get_or(key, compute)
    except ValueError as e:
        bad(str(e))
    return v


def _prep_scenario(shock, non_dengue, dengue_now, closed, surge, reserve, saline, kits, lead, los, los_other, admission) -> "prep.Scenario":
    return prep.Scenario(shock=round(shock, 3), non_dengue_scale=non_dengue / 100, dengue_occupied_scale=dengue_now / 100, closed_pct=float(closed),
                         surge_available_pct=float(surge), reserve_pct=None if reserve is None else float(reserve), saline_pct=float(saline), kits_pct=float(kits),
                         lead_time_days=lead, los_dengue_days=los, los_other_days=los_other, admission_rate=None if admission is None else round(admission, 4))


PrepCity = Annotated[str, Query(max_length=40)]


@app.get("/api/preparedness/plan")
def preparedness_plan(origin: str, service: Literal["median", "p80", "p90"] = "p80", city: PrepCity = "Dhaka North",
                      source: Optional[Literal["replay", "bundle"]] = None,
                      shock: Annotated[float, Query(ge=0.5, le=4.0)] = 1.0, non_dengue: Annotated[int, Query(ge=50, le=130)] = 100,
                      dengue_now: Annotated[int, Query(ge=0, le=300)] = 100, closed: Annotated[int, Query(ge=0, le=50)] = 0,
                      surge: Annotated[int, Query(ge=0, le=100)] = 100, reserve: Annotated[Optional[int], Query(ge=0, le=30)] = None,
                      saline: Annotated[int, Query(ge=0, le=200)] = 100, kits: Annotated[int, Query(ge=0, le=200)] = 100,
                      lead: Annotated[Optional[int], Query(ge=1, le=28)] = None, los: Annotated[int, Query(ge=2, le=14)] = 5,
                      los_other: Annotated[int, Query(ge=2, le=14)] = 6, admission: Annotated[Optional[float], Query(ge=0.05, le=0.6)] = None,
                      crews: Annotated[int, Query(ge=0, le=500)] = 0):
    """Mixed-patient bed occupancy, saline and kit inventory, dynamic alerts and a three-state crisis comparison for fictional planning
    hospitals driven by the real (synthetic-dataset) forecast. See dengueshield/preparedness.py."""
    need("replay")
    sc = _prep_scenario(shock, non_dengue, dengue_now, closed, surge, reserve, saline, kits, lead, los, los_other, admission)
    return preparedness_compute(origin, service, city, source, sc, crews)


def _csv_safe(v) -> str:
    t = "" if v is None else str(v)
    return "'" + t if t[:1] in ("=", "+", "-", "@", "\t", "\r") and not t.lstrip("-").replace(".", "", 1).isdigit() else t


@app.get("/api/preparedness/brief")
def preparedness_brief(origin: str, format: Literal["html", "csv", "txt", "json"] = "html", service: Literal["median", "p80", "p90"] = "p80",
                       city: PrepCity = "Dhaka North", source: Optional[Literal["replay", "bundle"]] = None,
                       shock: Annotated[float, Query(ge=0.5, le=4.0)] = 1.0, non_dengue: Annotated[int, Query(ge=50, le=130)] = 100,
                       dengue_now: Annotated[int, Query(ge=0, le=300)] = 100, closed: Annotated[int, Query(ge=0, le=50)] = 0,
                       surge: Annotated[int, Query(ge=0, le=100)] = 100, reserve: Annotated[Optional[int], Query(ge=0, le=30)] = None,
                       saline: Annotated[int, Query(ge=0, le=200)] = 100, kits: Annotated[int, Query(ge=0, le=200)] = 100,
                       lead: Annotated[Optional[int], Query(ge=1, le=28)] = None, los: Annotated[int, Query(ge=2, le=14)] = 5,
                       los_other: Annotated[int, Query(ge=2, le=14)] = 6, admission: Annotated[Optional[float], Query(ge=0.05, le=0.6)] = None,
                       crews: Annotated[int, Query(ge=0, le=500)] = 0):
    """The preparation brief for one scenario: deterministic, every number from /api/preparedness/plan."""
    import html as _h
    need("replay")
    sc = _prep_scenario(shock, non_dengue, dengue_now, closed, surge, reserve, saline, kits, lead, los, los_other, admission)
    d = preparedness_compute(origin, service, city, source, sc, crews)
    c, r = d["states"]["crisis"]["summary"], d["states"]["response"]["summary"]
    wk = lambda w: "none in 4 weeks" if w is None else f"week {w}"
    rows = [("Scenario", d["scenario_id"]), ("Forecast issued", origin), ("Target weeks (2-4)", ", ".join(d["forecast"]["target_dates"].values())),
            ("Service level", service), ("Planning area", city), ("Projected cases, weeks 1-4", ", ".join(f"{sum(v[i] for v in d['weekly_cases'].values()):.0f}" for i in range(4))),
            ("Demand shock", f"x{sc.shock:g}"), ("Admission rate per case", sc.admission_rate or "organizer bed multiplier"), ("Length of stay (dengue / other), days", f"{sc.los_dengue_days} / {sc.los_other_days}"),
            ("Other-illness patients now", c["other_now"]), ("Dengue patients now", c["dengue_now"]), ("Open beds (planning network)", c["capacity"]),
            ("Protected reserve", c["reserve"]), ("Peak patients needing a bed", c["peak_needed"]), ("Extra beds to keep the reserve", c["extra_beds_to_protect_reserve"]),
            ("First reserve breach", wk(c["first_reserve_breach_week"])), ("First bed shortage", wk(c["first_shortage_week"])),
            ("Saline to procure", c["saline_required"]), ("Diagnostic kits to procure", c["kits_required"]), ("First saline stockout", wk(c["first_saline_stockout_week"])),
            ("Referrals in the planning network", r["referred"]), ("Bed gap after response", r["bed_gap_after_referral"]),
            ("28-day referral plan", "not available" if r.get("referred_28d") is None else f"{r['referred_28d']} referred, {r['unresolved_28d']} still without a bed"),
            *[(f"{lab} unmet: no action / procurement only / redistribution + procurement",
               f"{ic[res]['no_action']} / {ic[res]['procurement_only']} / {ic[res]['redistribution_and_procurement']}")
              for ic in [d["states"]["response"].get("inventory_compare") or {}] if ic for res, lab in (("saline", "Saline"), ("kits", "Kits"))],
            ("Saline still unmet after response", r["saline_unmet"]), ("Status: crisis / after response", f"{c['status']} / {r['status_after_response']}"),
            ("Intervention", "none" if not d["intervention"] else f"{crews} crews, assumed effect"),
            ("Emergency contacts", "999 (National Emergency Service, ambulance), 16263 (DGHS Shasthya Batayon)"),
            ("Data", "Planning hospitals are fictional (synthetic_demo). Real facility capacity and availability are unknown.")]
    acts = [(a["action"], "" if a["quantity"] is None else a["quantity"], a["when"], a["why"]) for a in d["actions"]]
    name = f"dengueshield_preparedness_{d['scenario_id']}"
    if format == "json":
        return {"scenario_id": d["scenario_id"], "rows": rows, "actions": acts}
    if format == "csv":
        lines = ["field,value"] + [",".join('"' + _csv_safe(x).replace('"', '""') + '"' for x in row) for row in rows] + ["", "action,quantity,when,why"] + \
                [",".join('"' + _csv_safe(x).replace('"', '""') + '"' for x in a) for a in acts]
        return Response("\n".join(lines) + "\n", media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"', "X-Scenario-Id": d["scenario_id"]})
    if format == "txt":
        txt = (f"DengueShield preparedness {d['scenario_id']} ({city}, forecast {origin}): status {c['status']}; prepare {c['extra_beds_to_protect_reserve']} beds before "
               f"{wk(c['first_reserve_breach_week'])}; order {c['saline_required']} saline, {c['kits_required']} kits; referrals {r['referred']}, gap after {r['bed_gap_after_referral']}. "
               "Fictional planning hospitals; not an order. Emergency 999.")
        return Response(txt, media_type="text/plain; charset=utf-8", headers={"X-Scenario-Id": d["scenario_id"]})
    tr = "".join(f"<tr><th>{_h.escape(str(k))}</th><td>{_h.escape(str(v))}</td></tr>" for k, v in rows)
    ar = "".join(f"<li><b>{_h.escape(a[0])}</b>{(' — ' + _h.escape(str(a[1]))) if a[1] != '' else ''}, {_h.escape(a[2])}. {_h.escape(a[3])}</li>" for a in acts)
    doc = (f"<!doctype html><html lang='en'><meta charset='utf-8'><title>{name}</title><style>body{{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a1438}}"
           f"th{{text-align:left;padding:4px 12px 4px 0;color:#5e567f;font-weight:600}}td{{padding:4px 0}}.note{{background:#fff4dc;padding:8px 12px;border-radius:8px}}</style>"
           f"<h1>Hospital preparation brief</h1><p class='note'>Planning estimate on fictional planning hospitals (synthetic_demo) driven by the organizer's synthetic forecast. "
           f"Not an operational or clinical order. Real hospital capacity and availability are unknown.</p><table>{tr}</table><h2>Preparation actions</h2><ol>{ar}</ol>"
           f"<p>Scenario {_h.escape(d['scenario_id'])}. Same settings always give the same brief.</p></html>")
    return Response(doc, media_type="text/html; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}.html"', "X-Scenario-Id": d["scenario_id"]})


@app.get("/api/preparedness/referrals")
def preparedness_referrals(lat: Lat, lon: Lon):
    """Progressive search for real facilities by estimated road time: nearby, wider city, district, neighbouring districts, then the other
    bundled region by straight-line distance (no road route is bundled between regions). Availability is never known."""
    _routing_ready()
    near = routing.nearest_facilities(lat, lon, k=1000, kind="hospital", purpose="emergency")   # every eligible hospital in the area, by road time
    tiers = {"nearby": [], "wider_city": [], "district": [], "neighbouring_districts": [], "other_region": []}
    home = near["results"][0]["facility"]["properties"]["city"] if near["results"] else None
    for r in near["results"]:
        p, t = r["facility"]["properties"], r["est_time_s"]
        card = {"id": p["id"], "name": p["name"], "city": p["city"], "category": p.get("category"), "phone": p.get("phone") or [],
                "phone_source": "OpenStreetMap tag (community-mapped, not verified)" if p.get("phone") else None, "last_edited": p.get("last_edited"),
                "est_time_s": t, "distance_m": r["distance_m"], "osm_url": p.get("osm_url"), "coordinates": r["facility"]["geometry"]["coordinates"],
                "emergency_tag": p.get("emergency_status"), "capacity": PREP_UNKNOWN["capacity"], "availability": PREP_UNKNOWN["availability"]}
        tier = "nearby" if t <= 900 else "wider_city" if t <= 1800 and p["city"] == home else "district" if p["city"] == home else "neighbouring_districts"
        if len(tiers[tier]) < 6:
            tiers[tier].append(card)
    far = [f for f in routing.facilities()["features"] if f["properties"].get("area") != near["area"] and f["properties"].get("kind") == "hospital"
           and f["properties"].get("care") == "human"]
    far.sort(key=lambda f: (f["geometry"]["coordinates"][0] - lon) ** 2 + (f["geometry"]["coordinates"][1] - lat) ** 2)
    for f in far[:4]:
        p = f["properties"]
        km = 111.32 * math.hypot((f["geometry"]["coordinates"][0] - lon) * math.cos(math.radians(lat)), f["geometry"]["coordinates"][1] - lat)
        tiers["other_region"].append({"id": p["id"], "name": p["name"], "city": p["city"], "category": p.get("category"), "phone": p.get("phone") or [],
                                      "phone_source": "OpenStreetMap tag (community-mapped, not verified)" if p.get("phone") else None,
                                      "straight_line_km": round(km, 1), "est_time_s": None, "osm_url": p.get("osm_url"),
                                      "coordinates": f["geometry"]["coordinates"], "capacity": PREP_UNKNOWN["capacity"], "availability": PREP_UNKNOWN["availability"],
                                      "route_note": "No bundled road route between regions; straight-line distance only."})
    return {"area": near["area"], "home_city": home, "tiers": tiers, "emergency": EMERGENCY["numbers"],
            "rules": ["Tiers by estimated road time: nearby <= 15 min, wider city <= 30 min, then the rest of the district, then neighbouring districts.",
                      "Missing availability is unknown, never 'full'. Do not bypass nearby emergency stabilization for a distant hospital.",
                      "Inter-facility transfers need clinical coordination and the receiving hospital's confirmation."],
            "attribution": OSM_ATTR, "note": FACILITY_NOTE}


@app.get("/api/preparedness/contacts")
def preparedness_contacts(city: Optional[Literal["Dhaka", "Narayanganj", "Gazipur", "Chattogram"]] = None):
    """National numbers plus facility phone numbers present in the bundled OpenStreetMap data (community-mapped). No number is invented;
    no ambulance availability or arrival time is claimed."""
    _routing_ready()
    rows = [{"id": f["properties"]["id"], "name": f["properties"]["name"], "city": f["properties"]["city"], "kind": f["properties"]["kind"],
             "phone": f["properties"]["phone"], "source": "OpenStreetMap phone tag (community-mapped, not verified)", "last_edited": f["properties"].get("last_edited"),
             "osm_url": f["properties"].get("osm_url")}
            for f in routing.facilities()["features"] if f["properties"].get("phone") and (city is None or f["properties"]["city"] == city)]
    return {"national": EMERGENCY["numbers"], "facilities": rows, "count": len(rows),
            "ambulance": "999 includes ambulance dispatch. No hospital-owned ambulance numbers are in the bundled data.",
            "note": "Call the hospital before transferring a patient. Numbers come from public sources and may be out of date."}


def _routing_ready():
    if not routing.manifest():
        raise HTTPException(503, "Facility and road data are not built. Run: python scripts/build_geodata.py")


@app.get("/api/facilities")
def facilities_list(city: Optional[Literal["Dhaka", "Narayanganj", "Gazipur", "Chattogram"]] = None, kind: Optional[Literal["hospital", "clinic"]] = None,
                    q: Annotated[Optional[str], Query(max_length=60)] = None, limit: Annotated[int, Query(ge=1, le=3000)] = 3000):
    _routing_ready()
    ql = (q or "").strip().lower()
    feats = [f for f in routing.facilities()["features"]
             if (city is None or f["properties"]["city"] == city) and (kind is None or f["properties"]["kind"] == kind)
             and (not ql or any(ql in str(f["properties"].get(k) or "").lower() for k in ("name", "name_bn", "address", "operator")))]
    return {"type": "FeatureCollection", "features": feats[:limit],
            "meta": {"count": len(feats), "returned": min(len(feats), limit), "attribution": OSM_ATTR, "note": FACILITY_NOTE,
                     "osm_timestamps": routing.manifest().get("facilities", {}).get("osm_timestamps")}}


@app.get("/api/route")
def route_between(from_lat: Lat, from_lon: Lon, to_lat: Optional[Lat] = None, to_lon: Optional[Lon] = None,
                  to_facility: Annotated[Optional[str], Query(max_length=40, pattern=r"^osm:(node|way|relation)/\d+$")] = None, verify: bool = True, insight: bool = False):
    """Shortest-distance and estimated-fastest A* routes on the directed OSM road graph, each verified against Dijkstra."""
    _routing_ready()
    dest = None
    if to_facility:
        dest = next((f for f in routing.facilities()["features"] if f["properties"]["id"] == to_facility), None)
        if dest is None:
            bad(f"unknown facility '{to_facility}'", 404)
        to_lon, to_lat = dest["geometry"]["coordinates"]
    if to_lat is None or to_lon is None:
        bad("give to_lat and to_lon, or to_facility")
    try:
        out = routing.route(from_lat, from_lon, to_lat, to_lon, verify, insight)
    except routing.RoutingError as e:
        bad(str(e))
    out.update({"facility": dest, "attribution": OSM_ATTR, "assumptions": routing.manifest()["assumptions"],
                "speeds_kmh": routing.manifest()["speed_assumptions_kmh"]})
    return out


@app.get("/api/emergency/nearest")
def emergency_nearest(lat: Lat, lon: Lon, k: Annotated[int, Query(ge=1, le=10)] = 5, kind: Literal["hospital", "clinic", "any"] = "hospital",
                      purpose: Literal["emergency", "general"] = "emergency"):
    """Nearest facilities by estimated road travel time (not straight-line distance).
    Default purpose "emergency" leaves out veterinary, diagnostic-only and specialist facilities (see dengueshield/facility_class.py)."""
    _routing_ready()
    try:
        out = routing.nearest_facilities(lat, lon, k, None if kind == "any" else kind, purpose)
    except routing.RoutingError as e:
        bad(str(e))
    out.update({"attribution": OSM_ATTR, "note": FACILITY_NOTE, "emergency": EMERGENCY["numbers"],
                "eligibility": EMERGENCY_ELIGIBILITY if purpose == "emergency" else "All human-care facilities of the requested kind; veterinary facilities excluded."})
    return out


@app.get("/api/emergency/info")
def emergency_info():
    return EMERGENCY


@app.get("/api/routing/status")
def routing_status():
    m = routing.manifest()
    bench = APP_DATA_GEO / "benchmark.json"
    return {"ready": bool(m), "manifest": m, "benchmark": json.loads(bench.read_text()) if bench.exists() else None, "attribution": OSM_ATTR}


# ------------------------------------------------------------------ DGHS official boundaries (contextual geography; never joined to dataset ward IDs)
GeoText = Annotated[Optional[str], Query(max_length=80)]


@app.get("/api/geo/dghs/status")
def geo_status():
    """Reachability, layer metadata, detected district/city/ward fields, attribution and the (unmapped) ID-mapping status."""
    return geo.status()


@app.get("/api/geo/dghs/filters")
def geo_filters(district: GeoText = None, city: GeoText = None):
    try:
        return geo.options({"district": district, "city": city})
    except ValueError as e:
        bad(str(e))
    except Exception as e:
        return JSONResponse({"status": "unavailable", "error": str(e)[:240], "id_mapping": geo.ID_MAPPING}, status_code=503)


@app.get("/api/geo/dghs/wards")
def geo_wards(district: GeoText = None, city: GeoText = None, ward: GeoText = None, simplify: Annotated[float, Query(ge=0, le=0.01)] = 0.0002):
    """Official ward polygons as GeoJSON (paginated upstream, cached). Properties are the DGHS attributes, unchanged."""
    try:
        return JSONResponse(geo.geojson({"district": district, "city": city, "ward": ward}, simplify))
    except ValueError as e:
        bad(str(e))
    except Exception as e:
        return JSONResponse({"status": "unavailable", "error": str(e)[:240], "attribution": geo.ATTRIBUTION, "id_mapping": geo.ID_MAPPING}, status_code=503)


@app.get("/api/integrations/status")
def integrations_status():
    return integrations.status(S)


# ------------------------------------------------------------------ exploratory multi-year climate scenarios (research engine)
# Separate from the validated 2-4-week champion: own model, own metrics, development years 2016-2024 only.
import functools
import threading

from dengueshield import scenarios as SC

_SC_LOCK = threading.Lock()
SC_NOTE = ("Exploratory multi-year climate scenario on synthetic competition data (2016-2024). Conditional what-if outputs under "
           "hypothetical weather assumptions, not forecasts of real climate or dengue, and not causal effects. The 2025 holdout is never used.")
RainM = Annotated[float, Query(ge=SC.BOUNDS["rain_mult"][0], le=SC.BOUNDS["rain_mult"][1])]
TempO = Annotated[float, Query(ge=SC.BOUNDS["temp_offset"][0], le=SC.BOUNDS["temp_offset"][1])]
Draws = Annotated[int, Query(ge=SC.BOUNDS["draws"][0], le=SC.BOUNDS["draws"][1])]
SYear = Annotated[int, Query(ge=SC.BOUNDS["year"][0], le=SC.BOUNDS["year"][1])]


@functools.lru_cache(maxsize=1)
def _sc_engine():
    from dengueshield.data import load_development_panel  # development rows only: the 2025 holdout is never parsed
    return SC.Engine(SC.prepare(load_development_panel()), range(2016, 2025))


def _sc_mask(e, city: Optional[str], ward: Optional[str]):
    if ward:
        if ward not in e.wards:
            bad(f"unknown ward '{ward}'", 404)
        return np.array([w == ward for w in e.wards])
    if city and city != "All":
        if city not in set(e.city):
            bad(f"unknown city '{city}'", 404)
        return e.city == city
    return np.ones(e.W, bool)


@functools.lru_cache(maxsize=24)  # raw draws are a few MB each: keep few; responses below are cached separately and are small
def _sc_sims(rain_mult: float, temp_offset: float, year: int, draws: int, model: str):
    # seeded per year: deterministic, and scenarios share random numbers so differences are paired. No lock: the engine is read-only.
    return _sc_engine().simulate(model, draws, rain_mult, temp_offset, seed=1000 + year).astype(np.int32)


def _sc_params(scenario: str, rain_mult: Optional[float], temp_offset: Optional[float]):
    if scenario == "custom":
        return round(rain_mult if rain_mult is not None else 1.0, 2), round(temp_offset if temp_offset is not None else 0.0, 1)
    if scenario not in SC.SCENARIOS:
        bad(f"scenario must be one of {sorted(SC.SCENARIOS) + ['custom']}")
    return SC.SCENARIOS[scenario]


@app.get("/api/scenarios/run")
def scenarios_run(scenario: str = "typical", rain_mult: Optional[RainM] = None, temp_offset: Optional[TempO] = None,
                  year: SYear = 2026, city: Optional[str] = None, ward: Optional[str] = Query(None, max_length=20), draws: Draws = 500):
    rm, to = _sc_params(scenario, rain_mult, temp_offset)
    return _sc_run_cached(scenario, rm, to, year, city, ward, draws)


@functools.lru_cache(maxsize=512)
def _sc_run_cached(scenario, rm, to, year, city, ward, draws):
    e = _sc_engine(); m = _sc_mask(e, city, ward)
    sims = _sc_sims(rm, to, year, draws, "m1")[:, m]
    clim = _sc_sims(1.0, 0.0, year, draws, "m0")[:, m]
    years = {y: SC.summarize(_sc_sims(rm, to, y, draws, "m1")[:, m], [], np.array([]))["total"] for y in range(2026, 2031)}
    hist = {int(y): int(v) for y, v in zip(e.years, e.y[:, m].sum((1, 2)))}
    s = SC.summarize(sims, [w for w, k in zip(e.wards, m) if k], e.city[m])
    return {"scenario": scenario, "assumptions": {"rain_mult": rm, "temp_offset_c": to, "weather": "whole historical weather years 2016-2024 resampled per draw"},
            "year": year, "city": city or "All", "ward": ward, "draws": draws, "seed": 1000 + year, "summary": s,
            "climatology": SC.summarize(clim, [], np.array([]))["total"], "by_year": years, "history": hist,
            "threshold": {"definition": "historical median annual total of the selection (2016-2024)", "value": float(np.median(list(hist.values()))),
                          "p_exceed": float((sims.sum((1, 2)) > np.median(list(hist.values()))).mean())},
            "interval_label": "simulation ranges; retrospectively conservative at ward-week level (see backtest)", "note": SC_NOTE}


@app.get("/api/scenarios/compare")
def scenarios_compare(a: str = "typical", b: str = "wetter", a_rain: Optional[RainM] = None, a_temp: Optional[TempO] = None,
                      b_rain: Optional[RainM] = None, b_temp: Optional[TempO] = None, year: SYear = 2026,
                      city: Optional[str] = None, ward: Optional[str] = Query(None, max_length=20), draws: Draws = 500):
    pa, pb = _sc_params(a, a_rain, a_temp), _sc_params(b, b_rain, b_temp)
    return _sc_compare_cached(a, b, pa, pb, year, city, ward, draws)


@functools.lru_cache(maxsize=512)
def _sc_compare_cached(a, b, pa, pb, year, city, ward, draws):
    e = _sc_engine(); m = _sc_mask(e, city, ward)
    sa, sb = _sc_sims(*pa, year, draws, "m1")[:, m], _sc_sims(*pb, year, draws, "m1")[:, m]
    ta, tb = sa.sum((1, 2)), sb.sum((1, 2)); d = tb - ta
    thr = float(np.median(e.y[:, m].sum((1, 2))))
    return {"a": {"name": a, "rain_mult": pa[0], "temp_offset_c": pa[1], **SC.summarize(sa, [], np.array([]))["total"], "weekly_median": np.median(sa.sum(1), 0).tolist(), "p_exceed": float((ta > thr).mean())},
            "b": {"name": b, "rain_mult": pb[0], "temp_offset_c": pb[1], **SC.summarize(sb, [], np.array([]))["total"], "weekly_median": np.median(sb.sum(1), 0).tolist(), "p_exceed": float((tb > thr).mean())},
            "difference": {"mean": float(d.mean()), "q80": [float(np.quantile(d, .1)), float(np.quantile(d, .9))],
                           "relative_pct": float(100 * d.mean() / max(ta.mean(), 1e-9)), "share_of_draws_b_higher": float((d > 0).mean())},
            "threshold": thr, "paired": "both scenarios use the same random draws, so the difference isolates the weather assumption",
            "warning": "Conditional model output under hypothetical weather; not a demonstrated causal effect or a forecast of real climate change.", "note": SC_NOTE}


@functools.lru_cache(maxsize=1)
def _sc_backtest():
    with _SC_LOCK:  # only backtest requests wait here; computed once, in the background at startup
        return SC.backtest(_sc_engine().d, draws=300).round(4)


@app.on_event("startup")
def _warm_scenarios_and_threads():
    import anyio.to_thread
    anyio.to_thread.current_default_thread_limiter().total_tokens = 80  # slow requests must not starve quick ones
    threading.Thread(target=lambda: (_sc_backtest(), _sc_run_cached("typical", 1.0, 0.0, 2026, "All", None, 500)), daemon=True).start()


@app.get("/api/scenarios/backtest")
def scenarios_backtest():
    bt = _sc_backtest()
    keep = [c for c in bt.columns if "::" not in c]
    return {"rows": bt[keep].to_dict("records"), "mean": bt.groupby("model")[keep[3:]].mean().round(4).reset_index().to_dict("records"),
            "method": "Rolling origin: each year 2019-2024 simulated by a model fit only on 2016 to the previous year; 300 seeded draws.",
            "note": SC_NOTE}


# ------------------------------------------------------------------ methodology documents (allow-listed, read-only)
def _doc_index() -> dict:
    out = {}
    for pat in ("README.md", "ARCHITECTURE.md", "data/README.md", "docs/*.md", "docs/architecture/*.md", "docs/team/*.md"):
        for f in sorted(ROOT.glob(pat)):
            if f.is_file() and f.name not in {".env", ".env.example"}:
                out[f.relative_to(ROOT).as_posix()] = f
    return out


@app.get("/api/docs")
def docs_list():
    return [{"path": k, "title": next((l.lstrip("# ").strip() for l in v.read_text(errors="ignore").splitlines() if l.startswith("#")), k), "bytes": v.stat().st_size} for k, v in _doc_index().items()]


@app.get("/api/docs/read")
def docs_read(path: str = Query(max_length=80)):
    idx = _doc_index()
    if path not in idx:
        raise HTTPException(404, "document not found (only approved methodology documents can be read)")
    return {"path": path, "text": idx[path].read_text(errors="ignore")[:200_000]}


# ------------------------------------------------------------------ assistant
@app.post("/api/assistant/chat")
async def assistant_chat(req: ChatRequest, request: Request):
    from dengueshield.api import guard, rag
    # Body size is enforced as it streams by guard.BodyLimit (also for chunked bodies). The rate-limit key is the TCP peer,
    # or a configured number of trusted proxy hops from the right of X-Forwarded-For; never a caller-chosen value.
    sid = guard.client_key(request.client.host if request.client else None, request.headers.get("x-forwarded-for"))
    result = rag.answer(S, req, sid)
    if result.get("stream") is None:
        return JSONResponse(result["payload"], status_code=result.get("status", 200))
    return StreamingResponse(result["stream"], media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.get("/api/assistant/status")
def assistant_status():
    from dengueshield.api import rag
    return rag.status()


# ------------------------------------------------------------------ accounts, roles and officer workflows (V4); public routes above stay anonymous
from dengueshield.api import auth as _auth, ops as _ops  # noqa: E402
app.include_router(_auth.router)
app.include_router(_ops.router)


# ------------------------------------------------------------------ static frontend (built Next.js export)
WEB = ROOT / "frontend" / "out"
if WEB.exists():
    app.mount("/_next", StaticFiles(directory=WEB / "_next"), name="next")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "unknown API route")
        for cand in (WEB / path, WEB / f"{path}.html", WEB / path / "index.html"):
            if cand.is_file() and WEB in cand.resolve().parents:
                return FileResponse(cand)
        return FileResponse(WEB / "index.html")
