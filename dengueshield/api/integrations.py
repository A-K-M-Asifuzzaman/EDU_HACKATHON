"""External integrations: registry with provenance, Open-Meteo adapter (real-world weather, kept separate from the training data)."""
from __future__ import annotations

import os
import time
from typing import Optional

import httpx

CITY_COORDS = {"Dhaka": (23.8103, 90.4125), "Chattogram": (22.3569, 91.7832), "Gazipur": (23.9999, 90.4203), "Narayanganj": (23.6238, 90.5000)}
TTL = {"current": 600, "forecast": 3600, "history": 86400}
_cache: dict = {}
_last_ok: dict = {}
_last_err: dict = {}


def openai_configured() -> bool:
    from dengueshield import offline
    return bool(os.environ.get("OPENAI_API_KEY")) and not offline.active()       # offline mode: Copilot falls back to local retrieval


def _load_env():
    p = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    if os.path.exists(p) and not os.environ.get("OPENAI_API_KEY"):
        for line in open(p):
            if line.startswith("OPENAI_API_KEY="):
                os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip()
            elif "=" in line and line.split("=", 1)[0] in ("OPENAI_MODEL", "OPENAI_EMBED_MODEL", "OPENAI_BUDGET_USD", "FIREBASE_PROJECT_ID"):
                os.environ.setdefault(*[x.strip() for x in line.split("=", 1)])


_load_env()


def _dghs_entry() -> dict:
    from dengueshield.api import geo as G
    ok = G.STATE["last_ok"]
    return {"id": "dghs_gis", "provider": "DGHS Bangladesh GIS (ArcGIS REST FeatureServer)", "purpose": "Official ward boundaries: contextual geography only",
            "feeds_inference": False, "network": True, "status": "reachable" if ok and not G.STATE["last_err"] else ("unavailable" if G.STATE["last_err"] else "not queried yet"),
            "last_success": ok, "last_error": G.STATE["last_err"], "update_frequency": "boundaries cached 7 days", "license": G.LICENSE,
            "cache": ".cache/geo (disk) + memory, stale copy served if the service is down", "attribution": G.ATTRIBUTION,
            "fallback": "boundaries hidden; the abstract ward-risk matrix is unaffected. Dataset ward IDs are never joined to official polygons (no verified mapping)."}


def _climate_entries() -> list:
    from dengueshield.api import climate as C
    out = []
    for pid, label, freq in (("nasa_power", "NASA POWER daily point API (AG community)", "history 24 h cache"), ("open_meteo", "Open-Meteo archive + forecast", "history 24 h, current 10 min, forecast 1 h cache")):
        st, pv = C.STATE[pid], C.PROVIDERS[pid]
        status = "unavailable (serving stale cache if present)" if st["last_err"] and not st["last_ok"] else ("ok" if st["last_ok"] else "not yet queried")
        out.append({"id": pid, "provider": label, "purpose": "Real-world climate context in the Climate Observatory (separate from the synthetic organizer data)", "feeds_inference": False,
                    "network": True, "status": status, "last_success": st["last_ok"], "last_error": st["last_err"], "requests": st["calls"], "update_frequency": freq,
                    "license": pv["license"], "attribution": pv["attribution"], "resolution": pv["resolution"], "cache": "memory + disk (.cache/weather), stale copy served if provider is down",
                    "fallback": "panel shows an unavailable notice; organizer weather and forecasts unaffected"})
    return out


def status(store) -> dict:
    return {"integrations": [
        {"id": "model_bundle", "provider": "local (joblib bundle)", "purpose": "Forecast inference (ridge Poisson GLM, 24 features)", "feeds_inference": True,
         "network": False, "status": "ok" if store.bundle is not None else "unavailable", "last_success": None, "update_frequency": "static (retrain by Stage 3 notebooks)",
         "license": "project code (see repository)", "cache": "predictions cached in memory by (bundle sha256, origin, horizon)", "fallback": "validated replay table"},
        {"id": "organizer_dataset", "provider": "EDU AI Engineering Hackathon organizers", "purpose": "Training/validation data and weather context (2016-2024)",
         "feeds_inference": True, "network": False, "status": "ok" if store.panel is not None else "missing (see data/README.md)", "last_success": None,
         "update_frequency": "static", "license": "not stated in the brief; not redistributed in this repository", "cache": "loaded once at startup", "fallback": "precomputed artifacts"},
        {"id": "openai_responses", "provider": "OpenAI Responses API", "purpose": "DengueShield Copilot answer generation + read-only tool calls", "feeds_inference": False,
         "network": True, "status": "configured" if openai_configured() else "not configured (set OPENAI_API_KEY in .env)", "last_success": _last_ok.get("openai"),
         "update_frequency": "on demand", "license": "OpenAI API terms; paid usage, capped per session and by budget", "cache": "identical questions cached 1 h",
         "fallback": "retrieval-only sources, rest of app unaffected", "last_error": _last_err.get("openai")},
        {"id": "openai_embeddings", "provider": "OpenAI Embeddings (text-embedding-3-small, 512 dims)", "purpose": "Multilingual retrieval over project documents",
         "feeds_inference": False, "network": True, "status": "index built" if os.path.exists(os.path.join(os.path.dirname(__file__), "..", "..", "app_data", "rag_index.npz")) else "index not built (BM25 fallback)",
         "last_success": _last_ok.get("embeddings"), "update_frequency": "index rebuilt manually (about $0.003)", "license": "OpenAI API terms", "cache": "index stored in app_data/",
         "fallback": "BM25 lexical retrieval"},
        *_climate_entries(),
        _dghs_entry(),
        {"id": "maplibre_osm", "provider": "MapLibre / OpenStreetMap", "purpose": "Map base layers", "feeds_inference": False, "network": True, "status": "not used",
         "last_success": None, "update_frequency": "-", "license": "ODbL (OSM)", "cache": "-", "fallback": "no ward geometry is rendered because no verified boundary exists"}]}
