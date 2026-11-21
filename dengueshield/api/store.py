"""Application state: dataset, serialized bundle, precomputed artifacts and caches. Read-only; nothing here trains models."""
from __future__ import annotations

import gzip
import hashlib
import json
import time
from collections import OrderedDict
import os
from pathlib import Path

import numpy as np
import pandas as pd

from dengueshield.data import DEV_LAST_YEAR, RAW_PATH, ROOT, load_development_panel, sha256
from dengueshield.inference import ForecastBundle

APP_DATA = ROOT / "app_data"
CACHE_ROOT = Path(os.environ.get("DENGUESHIELD_CACHE", str(ROOT / ".cache")))   # set to /tmp/... on read-only hosts
BUNDLE_PATH = ROOT / "models" / "dengueshield_B.joblib"
HORIZONS = (2, 3, 4)
TIER_ORDER = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
STARTED = time.time()


class LRU(OrderedDict):
    def __init__(self, cap=256):
        super().__init__()
        self.cap = cap

    def get_or(self, key, fn):
        if key in self:
            self.move_to_end(key)
            return self[key], True
        v = fn()
        self[key] = v
        if len(self) > self.cap:
            self.popitem(last=False)
        return v, False


class Store:
    def __init__(self):
        self.errors: dict[str, str] = {}
        self.panel: pd.DataFrame | None = None
        self.bundle: ForecastBundle | None = None
        self.replay: pd.DataFrame | None = None
        self.art: dict = {}
        self.cache = LRU(512)
        self.latency_ms: dict[str, float] = {}
        self.load()

    # ------------------------------------------------------------------ loading
    def load(self):
        for name in ("profile", "distributions", "correlations", "seasonality", "lag_analysis", "validation"):
            p = APP_DATA / f"{name}.json"
            try:
                self.art[name] = json.loads(p.read_text())
            except Exception as e:                                            # keep serving other routes
                self.errors[name] = f"{type(e).__name__}: {e}"
        try:
            with gzip.open(APP_DATA / "replay.csv.gz", "rt") as f:
                self.replay = pd.read_csv(f)
            assert pd.to_datetime(self.replay.target_date).dt.year.max() <= DEV_LAST_YEAR
        except Exception as e:
            self.errors["replay"] = f"{type(e).__name__}: {e}"
        try:
            self.bundle = ForecastBundle.load(BUNDLE_PATH)
            self.bundle_sha = hashlib.sha256(BUNDLE_PATH.read_bytes()).hexdigest()
        except Exception as e:
            self.errors["bundle"] = f"{type(e).__name__}: {e}"
        try:
            self.panel = load_development_panel()                           # 2025 is dropped on load
            self.data_sha = sha256(RAW_PATH)
            self.last_week = self.panel.date.max()
        except Exception as e:
            self.errors["dataset"] = f"{type(e).__name__}: {e}. Place the organizer CSV as described in data/README.md"
        if self.panel is not None:
            self.wards = (self.panel.groupby("ward_id")[["city", "population_density_sqkm", "water_logging_risk_index", "sanitation_score"]]
                          .first().reset_index())
        elif self.bundle is not None:
            self.wards = self.bundle.wards.copy()
        else:
            self.wards = pd.DataFrame(columns=["ward_id", "city", "population_density_sqkm", "water_logging_risk_index", "sanitation_score"])
        self.ward_ids = set(self.wards.ward_id)

    # ------------------------------------------------------------------ helpers
    def need(self, what: str):
        if what == "dataset" and self.panel is None:
            raise RuntimeError(self.errors.get("dataset", "dataset unavailable"))
        if what == "bundle" and self.bundle is None:
            raise RuntimeError(self.errors.get("bundle", "bundle unavailable"))
        if what == "replay" and self.replay is None:
            raise RuntimeError(self.errors.get("replay", "replay table unavailable"))

    def origin_range(self) -> dict:
        out = {}
        if self.replay is not None:
            g = self.replay.groupby("horizon").origin_date.agg(["min", "max"])
            out["replay"] = {int(h): {"min": r["min"], "max": r["max"]} for h, r in g.iterrows()}
        if self.panel is not None:
            latest = (self.last_week + pd.Timedelta(weeks=1)).date().isoformat()
            first = (self.panel.date.min() + pd.Timedelta(weeks=104)).date().isoformat()
            out["bundle"] = {"min": first, "max": latest, "latest_forward_origin": latest}
        return out

    def timed(self, name, fn):
        t = time.perf_counter()
        v = fn()
        self.latency_ms[name] = round((time.perf_counter() - t) * 1000, 1)
        return v

    def bundle_forecast(self, origin: str, horizon: int) -> pd.DataFrame:
        """All wards for one origin/horizon from the deployed bundle (live inference, cached by origin+horizon)."""
        self.need("bundle"), self.need("dataset")
        key = ("bundle", self.bundle_sha, origin, horizon)
        v, hit = self.cache.get_or(key, lambda: self.timed("bundle_predict", lambda: self.bundle.predict(self.panel, origin, horizon)))
        return v

    def drivers(self, origin: str, horizon: int) -> pd.DataFrame:
        key = ("drv", self.bundle_sha, origin, horizon)
        v, _ = self.cache.get_or(key, lambda: self.bundle.explain(self.panel, origin, horizon))
        return v


def records(df: pd.DataFrame) -> list:
    out = df.replace({np.nan: None}).to_dict("records")
    for r in out:
        for k, v in r.items():
            if isinstance(v, (np.floating,)):
                r[k] = None if not np.isfinite(v) else round(float(v), 4)
            elif isinstance(v, (np.integer,)):
                r[k] = int(v)
            elif isinstance(v, (np.bool_,)):
                r[k] = bool(v)
            elif isinstance(v, pd.Timestamp):
                r[k] = v.date().isoformat()
    return out
