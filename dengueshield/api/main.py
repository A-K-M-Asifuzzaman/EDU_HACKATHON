"""DengueShield AI API. Real inference from the serialized bundle; precomputed research artifacts; no 2025 data.

    uvicorn dengueshield.api.main:app --port 8000
"""
from __future__ import annotations

import base64
import json
import hmac
import os
import re
import time
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from dengueshield import decision, routing
from dengueshield.api import climate, geo, integrations
from dengueshield.api.schemas import ChatRequest, ForecastItem
from dengueshield.api.store import HORIZONS, ROOT, STARTED, TIER_ORDER, Store, records

app = FastAPI(title="DengueShield AI API", version="1.0.0",
              description="Ward-level dengue forecasting (2-4 weeks ahead). Historical Replay on the organizer dataset (2016-2024); the 2025 holdout is locked.")
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
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
            bad(f"no validated replay for origin {origin} at h={horizon}; replay origins span {rng.get('min')} to {rng.get('max')} "
                f"(target must fall in the same season). Use source=bundle for live inference.")
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


@app.get("/api/health")
def health():
    ok = {"dataset": S.panel is not None, "bundle": S.bundle is not None, "replay": S.replay is not None, "artifacts": not [k for k in S.errors if k in S.art or k in ("profile",)]}
    probe = _inference_probe()
    status = "ok" if all(ok.values()) else ("degraded" if ok["bundle"] or ok["replay"] else "down")
    return {"status": status, "components": ok, "errors": S.errors, "uptime_s": round(time.time() - STARTED), "inference_probe_ms": probe,
            "latency_ms": S.latency_ms, "openai_configured": integrations.openai_configured(), "cache_entries": len(S.cache)}


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
def forecast_series(ward_id: str, horizon: H = 3, year: Optional[int] = Query(None, ge=2019, le=2024)):
    """Out-of-time Historical Replay: median, mean, intervals and observed cases per target week (validation seasons 2019-2024)."""
    ward_check(ward_id), need("replay")
    r = S.replay[(S.replay.ward_id == ward_id) & (S.replay.horizon == horizon)]
    if year:
        r = r[r.year == year]
    r = r.sort_values("target_date")
    return {"ward_id": ward_id, "horizon": horizon, "convention": "B_start_of_week",
            "note": "Each season was predicted by a model trained only on earlier seasons; calibration used the two preceding seasons.", "series": records(r.drop(columns=["city"]))}


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


# ------------------------------------------------------------------ healthcare facilities, A* routing, emergency help (OpenStreetMap, ODbL)
APP_DATA_GEO = ROOT / "app_data" / "geo"
OSM_ATTR = "Facilities and roads (c) OpenStreetMap contributors, ODbL 1.0"
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
def emergency_nearest(lat: Lat, lon: Lon, k: Annotated[int, Query(ge=1, le=10)] = 5, kind: Literal["hospital", "clinic", "any"] = "hospital"):
    """Nearest facilities by estimated road travel time (not straight-line distance)."""
    _routing_ready()
    try:
        out = routing.nearest_facilities(lat, lon, k, None if kind == "any" else kind)
    except routing.RoutingError as e:
        bad(str(e))
    out.update({"attribution": OSM_ATTR, "note": FACILITY_NOTE, "emergency": EMERGENCY["numbers"]})
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


# ------------------------------------------------------------------ methodology documents (allow-listed, read-only)
def _doc_index() -> dict:
    out = {}
    for pat in ("README.md", "ARCHITECTURE.md", "data/README.md", "docs/*.md", "docs/team/*.md"):
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
    from dengueshield.api import rag
    if int(request.headers.get("content-length", 0)) > 20_000:
        raise HTTPException(413, "request too large")
    sid = request.client.host if request.client else "local"
    result = rag.answer(S, req, sid)
    if result.get("stream") is None:
        return JSONResponse(result["payload"], status_code=result.get("status", 200))
    return StreamingResponse(result["stream"], media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.get("/api/assistant/status")
def assistant_status():
    from dengueshield.api import rag
    return rag.status()


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
