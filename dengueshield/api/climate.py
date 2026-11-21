"""Real-world climate observations for the Climate Observatory: NASA POWER (daily point API) and Open-Meteo (archive/forecast).

These are REAL observations/reanalysis at city-centre coordinates. They are never merged into the organizer (synthetic) dataset and never
reach the validated forecasting model. Requests are cached in memory and on disk (stale copies are served, labelled, if a provider is down).
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import pandas as pd

from dengueshield.api.store import ROOT

CITY_COORDS = {"Dhaka": (23.8103, 90.4125), "Chattogram": (22.3569, 91.7832), "Gazipur": (23.9999, 90.4203), "Narayanganj": (23.6238, 90.5000)}
CACHE_DIR = ROOT / ".cache" / "weather"
TTL = {"history": 86400, "current": 600, "forecast": 3600}
MEM: dict = {}
STATE: dict = {"nasa_power": {"last_ok": None, "last_err": None, "calls": 0}, "open_meteo": {"last_ok": None, "last_err": None, "calls": 0}}
WET_DAY_MM = 1.0   # a "wet day" is >= 1 mm/day (stated convention, not an official definition)
MAX_DAYS = 3700

PROVIDERS = {
    "nasa_power": {"name": "NASA POWER (Prediction Of Worldwide Energy Resources), daily point API", "url": "https://power.larc.nasa.gov/api/temporal/daily/point",
                   "community": "AG (agroclimatology)", "variables": {"T2M": "2 m air temperature, daily mean (degC)", "RH2M": "2 m relative humidity (%)",
                                                                       "PRECTOTCORR": "bias-corrected total precipitation (mm/day)"},
                   "resolution": "Gridded MERRA-2 reanalysis/model data: the grid cell is roughly 0.5 deg latitude x 0.625 deg longitude (about 50 km), so values describe a regional cell, not a ward or street.",
                   "time_standard": "LST (local solar time) per the API header", "fill_value": -999.0,
                   "attribution": "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program.",
                   "license": "NASA POWER data are openly available; no key required. Please acknowledge as above.", "nature": "reanalysis/model-assimilated, not a station measurement"},
    "open_meteo": {"name": "Open-Meteo (archive, forecast and current APIs)", "url": "https://archive-api.open-meteo.com/v1/archive | https://api.open-meteo.com/v1/forecast",
                   "variables": {"temperature_2m_mean": "daily mean 2 m air temperature (degC)", "relative_humidity_2m_mean": "daily mean 2 m relative humidity (%)",
                                 "precipitation_sum": "daily precipitation sum (mm)"},
                   "resolution": "Reanalysis-based archive (ERA5-family, roughly 10-25 km depending on the underlying model); forecast uses blended national models.",
                   "time_standard": "Asia/Dhaka local time (requested)", "attribution": "Weather data by Open-Meteo.com (https://open-meteo.com), CC BY 4.0.",
                   "license": "Free API for non-commercial use; attribution required.", "nature": "reanalysis / numerical weather prediction, not a station measurement"},
}


# ------------------------------------------------------------------ cache
def _ck(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:24]


def cached_fetch(key: str, ttl: int, fn):
    """Fresh memory > fresh disk > network > stale disk (flagged). Returns (payload, meta)."""
    now = time.time()
    if key in MEM and now - MEM[key][0] < ttl:
        return MEM[key][1], {"cached": True, "stale": False, "age_s": int(now - MEM[key][0])}
    path = CACHE_DIR / f"{key}.json"
    if path.exists() and now - path.stat().st_mtime < ttl:
        try:
            v = json.loads(path.read_text())
            MEM[key] = (path.stat().st_mtime, v)
            return v, {"cached": True, "stale": False, "age_s": int(now - path.stat().st_mtime)}
        except Exception:
            pass
    try:
        v = fn()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(v))
        MEM[key] = (now, v)
        return v, {"cached": False, "stale": False, "age_s": 0}
    except Exception:
        if path.exists():                                              # provider down: serve the stale copy, clearly labelled
            return json.loads(path.read_text()), {"cached": True, "stale": True, "age_s": int(now - path.stat().st_mtime)}
        raise


# ------------------------------------------------------------------ provider fetchers (return daily records)
def _nasa(lat: float, lon: float, start: str, end: str) -> dict:
    r = httpx.get(PROVIDERS["nasa_power"]["url"], timeout=40, params={"parameters": "T2M,RH2M,PRECTOTCORR", "community": "AG", "latitude": lat, "longitude": lon,
                                                                      "start": start.replace("-", ""), "end": end.replace("-", ""), "format": "JSON"})
    r.raise_for_status()
    b = r.json()
    p = b["properties"]["parameter"]
    days = sorted(p["T2M"])
    fill = b["header"].get("fill_value", -999.0)
    clean = lambda v: None if v is None or v == fill or v <= -990 else float(v)
    return {"daily": [{"date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "temp_c": clean(p["T2M"][d]), "rh_pct": clean(p["RH2M"][d]), "rain_mm": clean(p["PRECTOTCORR"][d])} for d in days],
            "units": {k: v["units"] for k, v in b["parameters"].items()}, "grid_point": b["geometry"]["coordinates"], "api_version": b["header"]["api"]["version"],
            "sources": b["header"].get("sources")}


def _om_archive(lat: float, lon: float, start: str, end: str) -> dict:
    r = httpx.get("https://archive-api.open-meteo.com/v1/archive", timeout=40, params={"latitude": lat, "longitude": lon, "timezone": "Asia/Dhaka", "start_date": start, "end_date": end,
                                                                                         "daily": "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean"})
    r.raise_for_status()
    b = r.json()
    d = b["daily"]
    return {"daily": [{"date": t, "temp_c": d["temperature_2m_mean"][i], "rh_pct": d["relative_humidity_2m_mean"][i], "rain_mm": d["precipitation_sum"][i]} for i, t in enumerate(d["time"])],
            "units": b["daily_units"], "grid_point": [b["longitude"], b["latitude"], b.get("elevation")], "api_version": "v1"}


# ------------------------------------------------------------------ aggregation
def aggregate(daily: list) -> dict:
    df = pd.DataFrame(daily)
    df["date"] = pd.to_datetime(df.date)
    df["rain_mm"] = df.rain_mm.clip(lower=0)
    wk = df.assign(week=df.date.dt.to_period("W-SUN").dt.start_time).groupby("week").agg(temp_c=("temp_c", "mean"), rh_pct=("rh_pct", "mean"), rain_mm=("rain_mm", "sum"), n=("date", "size"))
    wk = wk[wk.n == 7]                                                 # complete Monday-Sunday weeks only (the organizer's weekly grid)
    mo = df.assign(year=df.date.dt.year, month=df.date.dt.month).groupby(["year", "month"]).agg(
        temp_c=("temp_c", "mean"), rh_pct=("rh_pct", "mean"), rain_mm=("rain_mm", "sum"), wet_days=("rain_mm", lambda s: int((s >= WET_DAY_MM).sum())),
        max_daily_mm=("rain_mm", "max"), days=("date", "size")).reset_index()
    clim = mo.groupby("month").agg(temp_c=("temp_c", "mean"), rh_pct=("rh_pct", "mean"), rain_mm=("rain_mm", "mean"), wet_days=("wet_days", "mean")).reset_index()
    r7 = df.set_index("date").rain_mm.rolling(7, min_periods=7).sum()
    ann = df.assign(year=df.date.dt.year).groupby("year").agg(rain_mm=("rain_mm", "sum"), days=("date", "size")).reset_index()
    rd = lambda x, k=2: None if pd.isna(x) else round(float(x), k)
    return {"weekly": [{"week": str(i.date()), "temp_c": rd(r.temp_c), "rh_pct": rd(r.rh_pct), "rain_mm": rd(r.rain_mm)} for i, r in wk.iterrows()],
            "monthly": [{k: (rd(v) if isinstance(v, float) else (int(v) if isinstance(v, (np.integer, int)) else v)) for k, v in r.items()} for r in mo.to_dict("records")],
            "monthly_climatology": [{k: (rd(v) if isinstance(v, float) else int(v)) for k, v in r.items()} for r in clim.to_dict("records")],
            "annual_rain": [{"year": int(r.year), "rain_mm": rd(r.rain_mm), "days": int(r.days)} for r in ann.itertuples()],
            "extremes": {"max_daily_rain_mm": rd(df.rain_mm.max()), "max_daily_rain_date": str(df.loc[df.rain_mm.idxmax(), "date"].date()) if df.rain_mm.notna().any() else None,
                         "max_7day_rain_mm": rd(r7.max()), "wet_day_threshold_mm": WET_DAY_MM, "missing_days": int(df[["temp_c", "rh_pct", "rain_mm"]].isna().any(axis=1).sum())},
            "n_days": len(df)}


def validate_range(start: str, end: str) -> tuple[str, str]:
    s, e = pd.Timestamp(start), pd.Timestamp(end)
    if s > e:
        raise ValueError("start must be on or before end")
    if s < pd.Timestamp("1981-01-01"):
        raise ValueError("start must be on or after 1981-01-01 (earliest year common to both providers)")
    if e > pd.Timestamp.today().normalize() - pd.Timedelta(days=3):
        e = pd.Timestamp.today().normalize() - pd.Timedelta(days=3)    # both archives lag real time by a few days
    if (e - s).days + 1 > MAX_DAYS:
        raise ValueError(f"range too long (max {MAX_DAYS} days)")
    return s.date().isoformat(), e.date().isoformat()


def observations(provider: str, city: str, start: str, end: str, include_daily: bool = False) -> dict:
    lat, lon = CITY_COORDS[city]
    try:
        start, end = validate_range(start, end)
    except ValueError as e:
        return {"status": "bad_request", "error": str(e)}
    fn = {"nasa_power": _nasa, "open_meteo": _om_archive}[provider]
    STATE[provider]["calls"] += 1
    try:
        raw, meta = cached_fetch(_ck(provider, city, start, end), TTL["history"], lambda: fn(lat, lon, start, end))
        STATE[provider]["last_ok"] = time.strftime("%Y-%m-%dT%H:%M:%S%z") if not meta["stale"] else STATE[provider]["last_ok"]
        if meta["stale"]:
            STATE[provider]["last_err"] = "provider unreachable; serving stale cache"
        out = {"status": "ok", "provider": provider, "provenance": PROVIDERS[provider], "city": city, "coordinates": {"latitude": lat, "longitude": lon,
               "note": "city-centre coordinates; wards have no coordinates in the organizer data"}, "range": {"start": start, "end": end}, "cache": meta,
               "units": raw["units"], "grid_point": raw["grid_point"], "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(MEM.get(_ck(provider, city, start, end), (time.time(),))[0])),
               "separation_notice": "Real-world observations. Shown beside, never merged into, the synthetic organizer dataset; not used by any forecast in this application.",
               **aggregate(raw["daily"])}
        if include_daily:
            out["daily"] = raw["daily"]
        return out
    except Exception as e:
        STATE[provider]["last_err"] = f"{type(e).__name__}: {str(e)[:120]}"
        return {"status": "unavailable", "provider": provider, "provenance": PROVIDERS[provider],
                "error": f"{PROVIDERS[provider]['name']} is currently unavailable and no cached copy exists. The rest of DengueShield is unaffected.", "detail": str(e)[:160]}


def current_and_forecast(city: str) -> dict:
    lat, lon = CITY_COORDS[city]

    def fetch():
        r = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=15, params={"latitude": lat, "longitude": lon, "timezone": "Asia/Dhaka", "forecast_days": 7,
                      "current": "temperature_2m,relative_humidity_2m,precipitation", "daily": "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean"})
        r.raise_for_status()
        return r.json()
    STATE["open_meteo"]["calls"] += 1
    try:
        b, meta = cached_fetch(_ck("om_fc", city), TTL["current"], fetch)
        if not meta["stale"]:
            STATE["open_meteo"]["last_ok"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        d = b["daily"]
        return {"status": "ok", "provider": "open_meteo", "provenance": PROVIDERS["open_meteo"], "city": city, "cache": meta,
                "current": {"observed_at": b["current"]["time"], "temperature_c": b["current"]["temperature_2m"], "relative_humidity_pct": b["current"]["relative_humidity_2m"],
                            "precipitation_mm": b["current"]["precipitation"]},
                "forecast_7d": [{"date": t, "temp_c": d["temperature_2m_mean"][i], "rh_pct": d["relative_humidity_2m_mean"][i], "rain_mm": d["precipitation_sum"][i]} for i, t in enumerate(d["time"])],
                "separation_notice": "A real-world numerical weather forecast. It is NOT an input to the dengue model: validated forecasts use only observed organizer-data history plus past-year climatology."}
    except Exception as e:
        STATE["open_meteo"]["last_err"] = f"{type(e).__name__}: {str(e)[:120]}"
        return {"status": "unavailable", "provider": "open_meteo", "provenance": PROVIDERS["open_meteo"], "error": "Open-Meteo is unavailable; the rest of the application is unaffected.", "detail": str(e)[:160]}


def provider_status() -> dict:
    return STATE
