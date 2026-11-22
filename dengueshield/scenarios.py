"""Exploratory multi-year dengue scenario engine (research branch; separate from the 2-4-week champion).

Development data only (2016-2024 via `load_development_panel`); the 2025 holdout is never read.
Two seasonal models, both simulated by Monte Carlo:
  M0 climatology: ward x week-of-year mean of prior years (3-week circular smoothing).
  M1 weather-conditioned: Poisson GLM on ward effects, seasonal harmonics and 2-4-week lagged weather;
     future weather = a whole historical year resampled per draw (keeps rain, temperature and humidity coherent),
     optionally scaled by a rainfall multiplier and shifted by a temperature offset (hypothetical assumptions).
Uncertainty per draw: bootstrap of training years (model uncertainty) + year-level shock (interannual variation)
+ negative-binomial counts (dispersion). Future years are exchangeable draws: no trend, no 2025 data required.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor

NW = 52
BOUNDS = {"rain_mult": (0.7, 1.3), "temp_offset": (-1.0, 2.0), "draws": (50, 2000), "year": (2026, 2030)}
SCENARIOS = {"typical": (1.0, 0.0), "wetter": (1.2, 0.0), "drier": (0.8, 0.0), "warmer": (1.0, 1.0)}


def prepare(panel: pd.DataFrame) -> pd.DataFrame:
    d = panel.sort_values(["ward_id", "date"]).copy()
    if d.date.dt.year.max() > 2024:
        raise ValueError("scenario engine accepts development years 2016-2024 only")
    d["year"] = d.date.dt.year
    d["wk"] = np.minimum((d.date.dt.dayofyear - 1) // 7, NW - 1)
    g = d.groupby("ward_id")
    d["rain_lag"] = g.rainfall_mm.transform(lambda s: s.shift(2).rolling(3, min_periods=1).sum())  # weeks t-4..t-2
    d["temp_lag"] = g.avg_temp_c.transform(lambda s: s.shift(2).rolling(3, min_periods=1).mean())
    d["hum_lag"] = g.relative_humidity_pct.transform(lambda s: s.shift(2).rolling(3, min_periods=1).mean())
    return d.dropna(subset=["rain_lag", "temp_lag", "hum_lag"])


def _cube(d: pd.DataFrame, col: str, years, wards) -> np.ndarray:
    """years x wards x weeks array (mean within week bin; bin 51 may hold two weeks)."""
    t = d[d.year.isin(years)].pivot_table(index=["year", "ward_id"], columns="wk", values=col, aggfunc="mean")
    t = t.reindex(pd.MultiIndex.from_product([years, wards]), columns=range(NW))
    return t.to_numpy().reshape(len(years), len(wards), NW)


def _smooth(m: np.ndarray) -> np.ndarray:
    return (np.roll(m, 1, -1) + m + np.roll(m, -1, -1)) / 3


def _design(rain, temp, hum, wk, ward_idx, n_wards, stats):
    k = 2 * np.pi * wk / NW
    harm = np.column_stack([f(j * k) for j in (1, 2, 3) for f in (np.sin, np.cos)])
    w = np.zeros((len(wk), n_wards)); w[np.arange(len(wk)), ward_idx] = 1
    z = lambda x, s: (x - s[0]) / s[1]
    return np.column_stack([w, harm, z(np.log1p(rain), stats["rain"]), z(temp, stats["temp"]), z(hum, stats["hum"])])


class Engine:
    def __init__(self, d: pd.DataFrame, train_years, seed: int = 2026):
        self.d, self.years = d, list(train_years)
        self.wards = sorted(d.ward_id.unique()); self.W = len(self.wards)
        self.city = d.drop_duplicates("ward_id").set_index("ward_id").city.reindex(self.wards).to_numpy()
        self.y = np.nan_to_num(_cube(d, "dengue_cases", self.years, self.wards))      # Y x W x 52
        self.wx = {c: _cube(d, c, self.years, self.wards) for c in ("rain_lag", "temp_lag", "hum_lag")}
        for c in self.wx:  # fill rare gaps (first weeks of 2016) with the ward-week mean
            a = self.wx[c]; self.wx[c] = np.where(np.isnan(a), np.nanmean(a, 0, keepdims=True), a)
        tot = self.y.sum((1, 2)); self.year_sd = float(np.std(np.log(tot / tot.mean()), ddof=1))
        self.seed = seed
        self._fit_glm()

    def _fit_glm(self):
        Y, W = len(self.years), self.W
        wk = np.tile(np.arange(NW), Y * W); wi = np.tile(np.repeat(np.arange(W), NW), Y)
        r, t, h = (self.wx[c].ravel() for c in ("rain_lag", "temp_lag", "hum_lag"))
        self.stats = {"rain": (np.log1p(r).mean(), np.log1p(r).std()), "temp": (t.mean(), t.std()), "hum": (h.mean(), h.std())}
        self.range = {"rain": (r.min(), r.max()), "temp": (t.min(), t.max())}
        X = _design(r, t, h, wk, wi, W, self.stats)
        self.glm = PoissonRegressor(alpha=1e-4, max_iter=1000).fit(X, self.y.ravel())
        mu = self.glm.predict(X)
        self.alpha_m1 = max(1e-3, float(np.mean(((self.y.ravel() - mu) ** 2 - mu) / np.maximum(mu, 1e-6) ** 2)))
        self.coef = dict(zip(["rain", "temp", "hum"], self.glm.coef_[-3:]))
        mu0 = _smooth(self.y.mean(0)); res = self.y - mu0
        self.alpha_m0 = max(1e-3, float(np.mean((res ** 2 - mu0) / np.maximum(mu0, 1e-6) ** 2)))

    def m1_mean(self, rain, temp, hum):
        """Expected ward x week cases for one weather year (W x 52 arrays)."""
        wk = np.tile(np.arange(NW), self.W); wi = np.repeat(np.arange(self.W), NW)
        X = _design(rain.ravel(), temp.ravel(), hum.ravel(), wk, wi, self.W, self.stats)
        return self.glm.predict(X).reshape(self.W, NW)

    def simulate(self, model="m0", draws=500, rain_mult=1.0, temp_offset=0.0, oracle=None, seed=None):
        """draws x W x 52 simulated counts. oracle=(rain,temp,hum) uses given weather (diagnostic only)."""
        rng = np.random.default_rng(self.seed if seed is None else seed)        # structural draws: shared across scenarios
        pois = np.random.default_rng((self.seed if seed is None else seed) + 7_919)  # count noise on its own stream, so pairing holds
        Y = len(self.years); out = np.empty((draws, self.W, NW))
        if model == "m1" and oracle is None:  # cache one mean surface per analog year
            means = [self.m1_mean(self.wx["rain_lag"][a] * rain_mult, self.wx["temp_lag"][a] + temp_offset, self.wx["hum_lag"][a]) for a in range(Y)]
        for i in range(draws):
            boot = rng.integers(0, Y, Y)
            if model == "m0":
                mu = _smooth(self.y[boot].mean(0)); alpha = self.alpha_m0
            else:
                mu = self.m1_mean(*oracle) if oracle is not None else means[rng.integers(0, Y)]
                mu = mu * (self.y[boot].sum() / self.y.sum()); alpha = self.alpha_m1  # bootstrap level uncertainty
            lam = mu * np.exp(rng.normal(-self.year_sd ** 2 / 2, self.year_sd)) * rng.gamma(1 / alpha, alpha, mu.shape)
            out[i] = pois.poisson(lam)
        return out


def summarize(sims: np.ndarray, wards, city, levels=(0.5, 0.8, 0.9)) -> dict:
    """Totals, intervals, peak-week distribution, per city."""
    def band(x):
        q = {f"q{int(l*100)}": [float(np.quantile(x, (1 - l) / 2)), float(np.quantile(x, (1 + l) / 2))] for l in levels}
        return {"mean": float(x.mean()), "median": float(np.median(x)), **q}
    out = {"total": band(sims.sum((1, 2))), "weekly_median": np.median(sims.sum(1), 0).tolist(),
           "weekly_q10": np.quantile(sims.sum(1), 0.1, 0).tolist(), "weekly_q90": np.quantile(sims.sum(1), 0.9, 0).tolist(),
           "peak_week": np.bincount(sims.sum(1).argmax(1), minlength=NW).tolist(), "cities": {}}
    for c in sorted(set(city)):
        s = sims[:, city == c].sum(1)
        out["cities"][c] = {**band(s.sum(1)), "weekly_median": np.median(s, 0).tolist()}
    return out


def backtest(d: pd.DataFrame, years=range(2019, 2025), draws=400, seed=2026) -> pd.DataFrame:
    """Rolling origin: each target year is simulated from a model fit on all earlier years only."""
    rows = []
    for Y in years:
        eng = Engine(d, range(2016, Y), seed=seed)
        truth = np.nan_to_num(_cube(d, "dengue_cases", [Y], eng.wards))[0]
        obs = {c: np.where(np.isnan(a := _cube(d, c, [Y], eng.wards)[0]), np.nanmean(eng.wx[c], 0), a) for c in ("rain_lag", "temp_lag", "hum_lag")}
        for name, kw in {"M0 climatology": {"model": "m0"}, "M1 weather-resampled": {"model": "m1"},
                         "M1 oracle weather (diagnostic)": {"model": "m1", "oracle": (obs["rain_lag"], obs["temp_lag"], obs["hum_lag"])}}.items():
            sims = eng.simulate(draws=draws, **kw)
            mean = sims.mean(0)
            r = {"year": Y, "model": name, "train_years": f"2016-{Y-1}",
                 "ward_week_mae": float(np.abs(mean - truth).mean()), "ward_week_rmse": float(np.sqrt(((mean - truth) ** 2).mean())),
                 "annual_ape": float(abs(np.median(sims.sum((1, 2))) - truth.sum()) / truth.sum())}
            ct, cs = [], []
            for c in sorted(set(eng.city)):
                m = eng.city == c; ct.append(truth[m].sum()); cs.append(sims[:, m].sum((1, 2)))
                r[f"city_week_mae::{c}"] = float(np.abs(sims[:, m].sum(1).mean(0) - truth[m].sum(0)).mean())
            r["city_annual_ape"] = float(np.mean([abs(np.median(s) - t) / t for s, t in zip(cs, ct)]))
            tw = truth.sum(0); r["peak_week_error"] = int(abs(int(np.median(sims.sum(1).argmax(1))) - int(tw.argmax())))
            for l in (0.5, 0.8, 0.9):
                lo, hi = (1 - l) / 2, (1 + l) / 2
                r[f"cov{int(l*100)}_annual_city"] = float(np.mean([np.quantile(s, lo) <= t <= np.quantile(s, hi) for s, t in zip(cs, ct)]))
                qlo, qhi = np.quantile(sims, lo, 0), np.quantile(sims, hi, 0)
                r[f"cov{int(l*100)}_ward_week"] = float(((truth >= qlo) & (truth <= qhi)).mean())
                r[f"width{int(l*100)}_ward_week"] = float((qhi - qlo).mean())
            rows.append(r)
    return pd.DataFrame(rows)
