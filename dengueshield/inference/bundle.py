"""Deployable forecast bundle: fitted feature pipeline + per-horizon count models + calibration + risk thresholds.

    bundle = ForecastBundle.load("models/dengueshield_bundle.joblib")
    out = bundle.predict(history_panel, origin="2024-12-30", horizon=3, wards=["DNCC_Ward_01"])

`history_panel` is the observed weekly data (same schema as the organizer CSV). The bundle never invents observations:
an origin whose required weeks are absent, an unknown ward, or an unsupported horizon raises ValueError.
"""
from __future__ import annotations

import hashlib
import platform
import time
from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd

from dengueshield import metrics
from dengueshield.calibration.intervals import _nb_int, _pois_int
from dengueshield.calibration.risk import TIERS, tier_index
from dengueshield.data import COLUMNS, WEEK
from dengueshield.features import FeaturePipeline
from dengueshield.models.distributions import CountDist
from dengueshield.models.zoo import make

BUNDLE_VERSION = "1.0.0"
MIN_HISTORY_WEEKS = 104   # past-year climatology needs at least two previous years


def family_of(col: str) -> str:
    if col.startswith(("cal_", "spl_")):
        return "seasonality (calendar)"
    if col in ("pop_density", "log_pop_density", "waterlogging", "sanitation"):
        return "ward vulnerability"
    if col.startswith(("rain_", "regime_", "monsoon", "weeks_since")):
        return "rainfall (observed + climatology)"
    return "other"


def interval_from_calibration(mu, cal: dict, level: float):
    """Interval from stored calibration: nb_coverage / nb_moment (NB with fitted alpha), conformal (scaled residual
    quantile), or poisson. Parameters were estimated on seasons before the bundle's training cutoff."""
    m = cal["method"]
    if m in ("nb_coverage", "nb_moment"):
        return _nb_int(mu, cal["alpha"], level)
    if m == "conformal":
        c = cal["q"] * np.sqrt(np.asarray(mu) + 1)
        return np.floor(np.maximum(mu - c, 0)), np.ceil(mu + c)
    if m == "poisson":
        return _pois_int(mu, level)
    raise ValueError(f"unknown calibration method {m}")


@dataclass
class HorizonModel:
    horizon: int
    model_name: str
    params: dict
    cols: list
    model: object
    calibration: dict          # {level: {"method":..., "alpha"| "q":...}}
    thresholds: dict           # training-target quantiles: outbreak q90, tier edges q60/q80/q95
    alert_prob: float          # P(Y >= outbreak threshold) cut for an outbreak alert (chosen on inner seasons)
    validation: dict = field(default_factory=dict)


@dataclass
class ForecastBundle:
    version: str
    created: str
    convention: dict
    pipeline: FeaturePipeline
    horizons: dict
    wards: pd.DataFrame
    train_cutoff: str
    data_sha256: str
    manifest: pd.DataFrame
    notes: str = ""
    env: dict = field(default_factory=dict)

    # ---------------------------------------------------------------- validation of requests
    def _check(self, panel: pd.DataFrame, origin: pd.Timestamp, horizon: int, wards) -> list:
        if horizon not in self.horizons:
            raise ValueError(f"horizon must be one of {sorted(self.horizons)}")
        if list(panel.columns) != COLUMNS:
            raise ValueError("history must have the organizer CSV schema")
        wards = list(self.wards.ward_id) if wards is None else list(wards)
        unknown = sorted(set(wards) - set(self.wards.ward_id))
        if unknown:
            raise ValueError(f"unknown ward_id: {unknown[:5]}")
        d0, d1 = panel.date.min(), panel.date.max()
        if (origin - d0).days % 7 != 0:
            raise ValueError("origin must fall on the weekly grid of the data (Mondays)")
        wl, cl = self.convention["wlag"], self.convention["clag"]
        latest_needed = origin - max(wl, cl) * WEEK
        if latest_needed > d1:
            raise ValueError(f"origin {origin.date()} needs observations up to {latest_needed.date()}, but the data end on "
                             f"{d1.date()}; forecasts beyond the observed record are refused, not extrapolated")
        if (origin - d0).days < 7 * MIN_HISTORY_WEEKS:
            raise ValueError(f"origin needs at least {MIN_HISTORY_WEEKS} weeks of history")
        have = panel[(panel.ward_id.isin(wards)) & (panel.date == latest_needed)]
        if len(have) != len(wards):
            raise ValueError("the required latest observed week is missing for some wards")
        return wards

    # ---------------------------------------------------------------- prediction
    def predict(self, panel: pd.DataFrame, origin, horizon: int, wards=None, levels=(0.8, 0.9)) -> pd.DataFrame:
        origin = pd.Timestamp(origin)
        panel = panel.sort_values(["ward_id", "date"]).reset_index(drop=True)
        wards = self._check(panel, origin, horizon, wards)
        hm = self.horizons[horizon]
        fm = self.pipeline.transform(panel, horizon, origins=[origin])
        keep = fm.meta.ward_id.isin(wards).to_numpy()
        X, meta = fm.X.loc[keep, hm.cols].reset_index(drop=True), fm.meta[keep].reset_index(drop=True)
        if X.isna().any().any():
            bad = X.columns[X.isna().any()].tolist()
            raise ValueError(f"required inputs unavailable at this origin: {bad[:6]}")
        prm = hm.model.predict_params(X)
        d = hm.model.dist(prm)
        mu = d.mean()
        out = meta[["ward_id", "city", "origin_date", "target_date", "horizon"]].copy()
        out["expected_cases"] = mu
        out["median_cases"] = d.median()
        for lv in levels:
            lo, hi = interval_from_calibration(mu, hm.calibration[lv], lv)
            out[f"lower_{int(lv * 100)}"], out[f"upper_{int(lv * 100)}"] = lo, hi
        t = hm.thresholds
        out["p_outbreak"] = CountDist("nb", mu=mu, alpha=hm.calibration[levels[0]].get("alpha", 1e-6)).prob_ge(t["outbreak"])
        out["outbreak_alert"] = out.p_outbreak >= hm.alert_prob
        out["risk_tier"] = np.asarray(TIERS)[tier_index(out.median_cases, *t["tier_edges"])]
        out["convention"] = self.convention["name"]
        out["model"] = hm.model_name
        return out

    def explain(self, panel: pd.DataFrame, origin, horizon: int, wards=None) -> pd.DataFrame:
        """Additive log-rate contributions by driver family (GLM models only): coefficient x standardised input."""
        origin = pd.Timestamp(origin)
        wards = self._check(panel.sort_values(["ward_id", "date"]).reset_index(drop=True), origin, horizon, wards)
        hm = self.horizons[horizon]
        m = hm.model
        if not hasattr(m, "reg") or not hasattr(m, "st"):
            raise NotImplementedError("explanations are implemented for GLM champions")
        fm = self.pipeline.transform(panel, horizon, origins=[origin])
        keep = fm.meta.ward_id.isin(wards).to_numpy()
        X = fm.X.loc[keep, hm.cols].reset_index(drop=True)
        Xd = m._design(X) if hasattr(m, "_design") else X
        Z = m._prep(m.st, Xd)
        names = list(np.asarray(Xd.columns)[m.st[-1]])
        contrib = pd.DataFrame(Z * m.reg.coef_, columns=names)
        fam = contrib.T.groupby([family_of(c) for c in names]).sum().T
        fam.insert(0, "ward_id", fm.meta.ward_id[keep].to_numpy())
        fam["baseline_log_rate"] = m.reg.intercept_
        return fam

    def save(self, path) -> str:
        joblib.dump(self, path, compress=3)
        return hashlib.sha256(open(path, "rb").read()).hexdigest()

    @staticmethod
    def load(path) -> "ForecastBundle":
        b = joblib.load(path)
        if not isinstance(b, ForecastBundle):
            raise TypeError("not a ForecastBundle")
        return b


def build_bundle(panel, conv_name: str, wlag: int, clag: int, specs: dict, calibration: dict, alert_prob: dict,
                 validation: dict, cutoff="2024-12-31", data_sha256="", notes="") -> ForecastBundle:
    """specs: {h: (model_name, params, cols)}. Fits the pipeline and models on labels reported by `cutoff` only."""
    cutoff = pd.Timestamp(cutoff)
    pipe = FeaturePipeline(wlag, clag, rain_est="clim").fit(panel, cutoff)
    hz = {}
    for h, (name, params, cols) in specs.items():
        fm = pipe.transform(panel, h)
        tr = ((fm.meta.target_date + clag * WEEK) <= cutoff).to_numpy()
        Xtr, ytr = fm.X.loc[tr, cols].reset_index(drop=True), fm.meta.y_true[tr].to_numpy()
        years = fm.meta.origin_date[tr].dt.year.to_numpy()
        m = make(name, **params).fit(Xtr, ytr, years=years)
        thr = metrics.thresholds(pd.Series(ytr))
        hz[h] = HorizonModel(h, name, params, list(cols), m, calibration[h], {"outbreak": thr["outbreak"], "tier_edges": thr["tier_edges"]},
                             alert_prob[h], validation.get(h, {}))
    man = pipe.transform(panel, 3, origins=[panel.date.max()]).manifest
    wards = panel.groupby("ward_id")[["city", "population_density_sqkm", "water_logging_risk_index", "sanitation_score"]].first().reset_index()
    import sklearn, lightgbm
    return ForecastBundle(BUNDLE_VERSION, time.strftime("%Y-%m-%dT%H:%M:%S%z"), {"name": conv_name, "wlag": wlag, "clag": clag},
                          pipe, hz, wards, str(cutoff.date()), data_sha256, man, notes,
                          {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
                           "sklearn": sklearn.__version__, "lightgbm": lightgbm.__version__})
