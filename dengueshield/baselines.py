"""Leak-safe baseline harness (driven by notebooks/03_validation_and_baselines.ipynb).

Every prediction for an evaluation row (ward, origin t, horizon h) is computed
from case counts reported by t (shifted by `report_lag` weeks), weather observed
up to t, static ward attributes, the calendar date of the target week, and
parameters fitted only on the fold's training rows.

`oracle_weather_glm` is NOT a forecast: it reads weather between the origin and
the target. It is reported only as a diagnostic ceiling for how much a perfect
weather forecast would be worth.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from dengueshield import metrics
from dengueshield.data import TARGET
from dengueshield.validation import HORIZONS, folds, forecast_frame, split

MODELS = ("global_mean", "ward_mean", "seasonal_avg", "last_known", "moving_avg_4", "poisson_glm")
ORACLE = "oracle_weather_glm"
STATIC_NUM = ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]
CALENDAR = ["doy_sin1", "doy_cos1", "doy_sin2", "doy_cos2"]
GLM_FEATURES = (["log_last", "log_ma4", "rain_o0", "rain_o1", "rain_o2", "rain_o3", "rh_o0", "rh_o1", "temp_ma4"]
                + STATIC_NUM + CALENDAR)
ORACLE_FEATURES = ([f"rain_t{l}" for l in range(2, 6)] + [f"rh_t{l}" for l in range(1, 4)]
                   + [f"temp_t{l}" for l in range(6, 9)] + STATIC_NUM + CALENDAR)
SEASONAL_YEARS = range(1, 10)


def origin_features(panel: pd.DataFrame, report_lag: int = 0) -> pd.DataFrame:
    """Features known at each (ward, origin). Panel must be regular and sorted (load_panel guarantees it)."""
    g = panel.groupby("ward_id", sort=False)
    reported = g[TARGET].shift(report_lag)
    f = panel[["ward_id", "date", *STATIC_NUM]].rename(columns={"date": "origin_date"})
    f["last"] = reported
    f["ma4"] = reported.groupby(panel["ward_id"]).transform(lambda s: s.rolling(4, min_periods=4).mean())
    f["log_last"], f["log_ma4"] = np.log1p(f["last"]), np.log1p(f["ma4"])
    for l in range(4):
        f[f"rain_o{l}"] = g["rainfall_mm"].shift(l)
    for l in range(2):
        f[f"rh_o{l}"] = g["relative_humidity_pct"].shift(l)
    f["temp_ma4"] = g["avg_temp_c"].transform(lambda s: s.rolling(4, min_periods=4).mean())
    return f


def target_features(panel: pd.DataFrame, max_horizon: int, report_lag: int = 0) -> pd.DataFrame:
    """Keyed by (ward, target_date): calendar terms, seasonal average and oracle-only weather."""
    if max_horizon + report_lag > 51:
        raise ValueError("seasonal average would read unreported weeks")
    g = panel.groupby("ward_id", sort=False)
    f = panel[["ward_id", "date"]].rename(columns={"date": "target_date"})
    doy = 2 * np.pi * panel["date"].dt.dayofyear / 365.25
    for k in (1, 2):
        f[f"doy_sin{k}"], f[f"doy_cos{k}"] = np.sin(k * doy), np.cos(k * doy)
    # Same ward, same season (+-1 week) in every previous year: all at least 51 weeks before the target.
    past = [g[TARGET].shift(52 * k + d) for k in SEASONAL_YEARS for d in (-1, 0, 1)]
    f["seasonal"] = pd.concat(past, axis=1).mean(axis=1, skipna=True)
    for l in range(9):  # oracle diagnostic only
        f[f"rain_t{l}"] = g["rainfall_mm"].shift(l)
        f[f"rh_t{l}"] = g["relative_humidity_pct"].shift(l)
        f[f"temp_t{l}"] = g["avg_temp_c"].shift(l)
    return f


def build_table(panel: pd.DataFrame, report_lag: int = 0, horizons=HORIZONS) -> pd.DataFrame:
    frame = forecast_frame(panel, horizons)
    frame = frame.merge(origin_features(panel, report_lag), on=["ward_id", "origin_date"], how="left")
    return frame.merge(target_features(panel, max(horizons), report_lag), on=["ward_id", "target_date"], how="left")


def _glm(train: pd.DataFrame, ev: pd.DataFrame, cols: list[str]) -> np.ndarray:
    tr = train.dropna(subset=cols)
    model = make_pipeline(StandardScaler(), PoissonRegressor(alpha=1e-4, max_iter=5000))
    model.fit(tr[cols], tr["y_true"])
    return model.predict(ev[cols])


def predict(train: pd.DataFrame, ev: pd.DataFrame, model: str) -> np.ndarray:
    """Predictions for eval rows of one fold and one horizon."""
    ward_mean = ev["ward_id"].map(train.groupby("ward_id")["y_true"].mean())
    if model == "global_mean":
        return np.full(len(ev), train["y_true"].mean())
    if model == "ward_mean":
        return ward_mean.to_numpy()
    if model == "seasonal_avg":
        return ev["seasonal"].fillna(ward_mean).to_numpy()
    if model == "last_known":
        return ev["last"].to_numpy(float)
    if model == "moving_avg_4":
        return ev["ma4"].to_numpy(float)
    if model == "poisson_glm":
        return _glm(train, ev, GLM_FEATURES)
    if model == ORACLE:
        return _glm(train, ev, ORACLE_FEATURES)
    raise KeyError(model)


def run(table: pd.DataFrame, report_lag: int = 0, models=MODELS) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Validation folds only (never the locked test year). Returns (predictions, per-fold metrics)."""
    preds, rows = [], []
    for fold in folds(include_test=False):
        train_all, ev_all = split(table, fold, report_lag)
        for h in sorted(table["horizon"].unique()):
            train, ev = train_all[train_all.horizon == h], ev_all[ev_all.horizon == h]
            thr = metrics.thresholds(train["y_true"])
            for m in models:
                p = predict(train, ev, m)
                if np.isnan(p).any():
                    raise ValueError(f"{m} produced NaN for {fold.name} h={h}")
                preds.append(ev[["ward_id", "city", "origin_date", "target_date", "horizon", "y_true"]]
                             .assign(fold=fold.name, model=m, y_pred=p))
                rows.append({"fold": fold.name, "horizon": h, "model": m,
                             **metrics.flatten(metrics.evaluate(ev["y_true"], p, thr))})
    return pd.concat(preds, ignore_index=True), pd.DataFrame(rows)
