"""Feature families. Each builder returns Feat records; the pipeline flattens them into a matrix.

Availability classes (docs/feature_engineering.md):
 1 observed directly at the origin         2 derived from already-observed history
 3 known in advance (calendar / static)    4 estimated from past-year climatology
 5 prohibited (needs data after the origin) - never built; see PROHIBITED.

Notation: `as-of` arrays are the raw weather/case arrays shifted by the availability lag, so column i holds the
latest week a forecast issued at origin i may use. Every feature below is a causal function of as-of columns <= i,
of calendar dates, or of previous-year values (>= 46 weeks before the origin).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from dengueshield.features import ops
from dengueshield.features.grid import Grid
from dengueshield.features.stats import FittedStats

# Weights of target-lag 2/3/4 rain, proportional to the jointly adjusted GLM rain coefficients on 2016-2021
# (reports/eda/tables/adjusted_glm_lag_coefficients.csv: 0.00263, 0.00551, 0.00420).
ALIGN_W = {2: 0.21, 3: 0.45, 4: 0.34}
TEMP_OPT, TEMP_SD = 28.5, 4.0  # a-priori broad suitability bump; NOT an entomologically validated parameter
RAIN_LAGS = (0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12)
ROLL_N = (2, 3, 4, 6, 8)
EWM_AGES = (2, 3, 4, 6)
ALIGN_K = (2, 3, 4, 5)
PROHIBITED = [f"{v}_obs_after_origin_{k}" for v in ("rain", "rh", "temp") for k in range(1, 5)] + ["cases_after_origin"]


@dataclass
class Feat:
    name: str
    values: np.ndarray
    family: str
    sub: str
    cls: int
    desc: str


@dataclass
class Ctx:
    grid: Grid
    h: int
    wlag: int            # weather availability lag (weeks)
    clag: int            # case availability lag (weeks); >= wlag in practice
    stats: FittedStats
    rain_est: str = "regime"  # how unobserved rain is projected: regime | clim | zero
    out: list = field(default_factory=list)
    _cache: dict = field(default_factory=dict)

    def __post_init__(self):
        g = self.grid
        self.rain = ops.lag(g.arr["rainfall_mm"], self.wlag)
        self.temp = ops.lag(g.arr["avg_temp_c"], self.wlag)
        self.tmax = ops.lag(g.arr["max_temp_c"], self.wlag)
        self.tmin = ops.lag(g.arr["min_temp_c"], self.wlag)
        self.rh = ops.lag(g.arr["relative_humidity_pct"], self.wlag)
        self.cases = ops.lag(g.arr[("dengue_cases")], self.clag)
        self.city_rain_raw = g.city_mean(g.arr["rainfall_mm"])
        self.city_rain = ops.lag(self.city_rain_raw, self.wlag)
        m2 = ops.roll(self.city_rain, 2, "mean")
        self.wet_now = np.where(np.isnan(m2), np.nan, (m2 > self.stats.wet_thr).astype(float))

    def add(self, name, values, family, sub, cls, desc):
        self.out.append(Feat(name, np.asarray(values, float), family, sub, cls, desc))

    def past(self, var: str, s: int, thr=None):
        key = (var, s, thr)
        if key not in self._cache:
            raw = self.city_rain_raw if var == "city_rain" else self.grid.arr[var]
            self._cache[key] = ops.past_stats(raw, s, thr)
        return self._cache[key]


def _calendar(c: Ctx):
    d = c.grid.dates
    T = len(d)
    dd = pd.date_range(d[0], periods=T + 8, freq="7D")
    mid_t = dd[c.h:c.h + T] + pd.Timedelta(days=3)  # target-week midpoint (Thursday); calendar-known in advance
    mid_o = d + pd.Timedelta(days=3)

    def ang(mid):
        diy = np.where(mid.is_leap_year, 366, 365)
        return 2 * np.pi * (mid.dayofyear.to_numpy() - 0.5) / diy

    bc = lambda v: np.broadcast_to(np.asarray(v, float), (len(c.grid.wards), T)).copy()
    a = ang(mid_t)
    for k in (1, 2, 3):
        c.add(f"cal_tgt_sin{k}", bc(np.sin(k * a)), "calendar", "fourier", 3, f"Fourier harmonic {k} of target-week midpoint day of year")
        c.add(f"cal_tgt_cos{k}", bc(np.cos(k * a)), "calendar", "fourier", 3, f"Fourier harmonic {k} (cos)")
    ao = ang(mid_o)
    for k in (1, 2):
        c.add(f"cal_org_sin{k}", bc(np.sin(k * ao)), "calendar", "fourier", 3, "origin-week harmonic")
        c.add(f"cal_org_cos{k}", bc(np.cos(k * ao)), "calendar", "fourier", 3, "origin-week harmonic (cos)")
    c.add("cal_tgt_month", bc(mid_t.month), "calendar", "discrete", 3, "calendar month of target-week midpoint")
    iso = np.minimum(mid_t.isocalendar().week.to_numpy().astype(float), 52)
    c.add("cal_tgt_isoweek", bc(iso), "calendar", "discrete", 3, "ISO week of target (week 53 folded into 52)")
    c.add("cal_tgt_monsoon", bc(np.isin(mid_t.month, [6, 7, 8, 9])), "calendar", "discrete", 3, "target midpoint in Jun-Sep (fixed calendar definition)")
    c.add("cal_org_monsoon", bc(np.isin(mid_o.month, [6, 7, 8, 9])), "calendar", "discrete", 3, "origin midpoint in Jun-Sep")
    return a


def _static(c: Ctx):
    g, W, T = c.grid, len(c.grid.wards), len(c.grid.dates)
    bc = lambda v: np.repeat(np.asarray(v, float)[:, None], T, axis=1)
    dens, wl, san = (g.static[k] for k in ("population_density_sqkm", "water_logging_risk_index", "sanitation_score"))
    c.add("pop_density", bc(dens), "static", "raw", 3, "population density per km2 (not a population count)")
    c.add("log_pop_density", bc(np.log(dens)), "static", "raw", 3, "log density")
    c.add("waterlogging", bc(wl), "static", "raw", 3, "water_logging_risk_index")
    c.add("sanitation", bc(san), "static", "raw", 3, "sanitation_score")
    return bc(dens), bc(wl), bc(san)


def _rain(c: Ctx):
    r, st = c.rain, c.stats
    wetf = np.where(np.isnan(r), np.nan, (r > st.wet_thr).astype(float))
    for k in RAIN_LAGS:
        c.add(f"rain_lag{k}", ops.lag(r, k), "rain_lag", "lag", 1 if k == 0 else 2, f"rain {k} weeks before the latest observed week")
    for n in ROLL_N:
        s = ops.roll(r, n, "sum")
        c.add(f"rain_sum{n}", s, "rain_roll", "sum", 2, f"{n}-week rain sum")
        c.add(f"rain_mean{n}", s / n, "rain_roll", "mean", 2, f"{n}-week rain mean (rescaled duplicate of the sum)")
        c.add(f"rain_max{n}", ops.roll(r, n, "max"), "rain_roll", "max", 2, f"{n}-week max weekly rain")
        if n >= 3:
            c.add(f"rain_std{n}", ops.roll(r, n, "std"), "rain_roll", "std", 2, f"{n}-week rain SD")
    for n in (4, 8, 12):
        c.add(f"rain_wetfreq{n}", ops.roll(wetf, n, "mean"), "rain_roll", "wetfreq", 2, f"share of the last {n} weeks above the fitted wet threshold")
    c.add("rain_consec_wet", ops.run_length(wetf), "rain_roll", "run", 2, "consecutive wet weeks ending at the latest observed week")
    c.add("rain_consec_dry", ops.run_length(np.where(np.isnan(wetf), np.nan, 1 - wetf)), "rain_roll", "run", 2, "consecutive dry weeks")
    m2 = ops.roll(r, 2, "mean")
    mom = m2 - ops.lag(m2, 2)
    c.add("rain_momentum", mom, "rain_roll", "shape", 2, "2-week mean minus the previous 2-week mean")
    c.add("rain_accel", mom - ops.lag(mom, 2), "rain_roll", "shape", 2, "change in rain momentum")
    for n in (4, 8):
        c.add(f"rain_trend{n}", ops.roll(r, n, "slope"), "rain_roll", "shape", 2, f"OLS slope of weekly rain over {n} weeks")
    with np.errstate(all="ignore"):
        wsum = ops.roll(np.where(np.isnan(wetf), np.nan, r * wetf), 8, "sum")
        wn = ops.roll(wetf, 8, "sum")
        c.add("rain_intensity8", np.where(np.isnan(wsum), np.nan, np.where(wn > 0, wsum / np.where(wn > 0, wn, 1), 0.0)), "rain_roll", "shape", 2, "mean rain of wet weeks within 8 weeks")
    for n in (4, 8):
        c.add(f"rain_excess{n}", ops.roll(np.maximum(r - st.rain_hi_thr, 0), n, "sum"), "rain_roll", "excess", 2, f"{n}-week sum of rain above the fitted wet-season q75")
    ewms = {}
    for a in EWM_AGES:
        ewms[a] = ops.ewm(r, a)
        c.add(f"rain_ewm{a}", ewms[a], "rain_roll", "ewm", 2, f"exponentially weighted rain, mean age {a} weeks")
    return ewms


def _aligned(c: Ctx, var_raw: np.ndarray, name: str, ks, family: str, sub: str, thr=None, mode="clim", weights=None):
    """Value of `var` at target_date - k weeks: observed when already available, else a climatological estimate."""
    h, d, g = c.h, c.wlag, c.grid
    est_cache, res = {}, {}
    for k in ks:
        m = k - h - d
        s = h - k
        if m >= 0:
            val, obs, cls = ops.lag(var_raw, m), np.ones(var_raw.shape), (1 if m == 0 else 2)
        else:
            ps = c.past("city_rain" if name == "rain" else {"rh": "relative_humidity_pct", "temp": "avg_temp_c"}[name], s,
                        c.stats.wet_thr if name == "rain" else None)
            base = ps["mean"]
            if name == "rain" and mode == "regime":
                cond = np.where(c.wet_now > 0, ps["mean_wet"], ps["mean_dry"])
                nn = np.where(c.wet_now > 0, ps["n_wet"], ps["n_dry"])
                base = np.where(nn >= 3, cond, ps["mean"])
            elif name == "rain" and mode == "zero":
                base = np.zeros_like(base)
            val, obs, cls = base, np.zeros(var_raw.shape), 4
        res[k] = (val, obs)
        c.add(f"{name}_tl{k}", val, family, sub, cls, f"{name} at target-date minus {k} weeks (observed if available, else estimate [{mode}])")
        c.add(f"{name}_tl{k}_obs", obs, family, sub, 3, f"1 if {name}_tl{k} is an observation, 0 if a projection")
    return res


def _rain_align(c: Ctx):
    st = c.stats
    res = _aligned(c, c.rain, "rain", ALIGN_K, "rain_align", "aligned", mode=c.rain_est)
    win = sum(ALIGN_W[k] * res[k][0] for k in ALIGN_W)
    c.add("rain_win", win, "rain_align", "aligned", 2 if all(res[k][1].all() for k in ALIGN_W) else 4,
          "Stage-1-weighted mean of rain at target-lags 2,3,4 (projected where unobserved)")
    c.add("rain_win_nobs", sum(res[k][1] for k in ALIGN_W), "rain_align", "aligned", 3, "how many of target-lags 2-4 are observed (weather-uncertainty indicator)")
    s3 = c.h - 3
    ps = c.past("city_rain", s3, st.wet_thr)
    c.add("rain_clim_tl3", ps["mean"], "rain_align", "clim", 4, "past-year city climatology (+-2 weeks) of rain at target-lag 3")
    c.add("rain_clim_sd_tl3", ps["sd"], "rain_align", "clim", 4, "across-year SD of that climatology (projection uncertainty)")
    c.add("rain_pwet_tl3", ps["p_wet"], "rain_align", "clim", 4, "share of past years wet at target-lag 3 (smoothed seasonal wet probability)")
    c.add("rain_clim_wetcond_tl3", np.where(ps["n_wet"] >= 3, ps["mean_wet"], np.nan), "rain_align", "clim", 4, "past-year mean among wet years at that week")
    c.add("rain_clim_drycond_tl3", np.where(ps["n_dry"] >= 3, ps["mean_dry"], np.nan), "rain_align", "clim", 4, "past-year mean among dry years at that week")
    pt = c.past("city_rain", c.h, st.wet_thr)
    c.add("rain_clim_target", pt["mean"], "rain_align", "clim", 4, "past-year climatology of rain in the target week itself")
    p0 = c.past("city_rain", -c.wlag, st.wet_thr)  # climatology of the latest observed week
    c.add("rain_anom_now", c.city_rain - p0["mean"], "rain_align", "clim", 2, "latest observed city rain minus its past-year climatology")
    c.add("regime_wet_now", c.wet_now, "rain_align", "regime", 2, "recent 2-week city rain above the fitted wet threshold")
    # monsoon onset clock, from observed rain only (calendar year of the origin)
    yr = c.grid.dates.year.to_numpy()
    started = np.zeros_like(c.wet_now)
    since = np.zeros_like(c.wet_now)
    cur_s = np.zeros(c.wet_now.shape[0])
    cur_n = np.zeros(c.wet_now.shape[0])
    for i in range(c.wet_now.shape[1]):
        if i == 0 or yr[i] != yr[i - 1]:
            cur_s[:], cur_n[:] = 0, 0
        w = np.nan_to_num(c.wet_now[:, i]) > 0
        new = w & (cur_s == 0)
        cur_s = np.where(new, 1, cur_s)
        cur_n = np.where(cur_s > 0, cur_n + 1, 0)
        started[:, i], since[:, i] = cur_s, np.where(cur_s > 0, cur_n - 1, 0)
    nanmask = np.isnan(c.wet_now)
    started[nanmask] = np.nan
    since[nanmask] = np.nan
    c.add("monsoon_started", started, "rain_align", "onset", 2, "monsoon onset observed this calendar year (first 2-week wet spell)")
    c.add("weeks_since_onset", since, "rain_align", "onset", 2, "weeks since the observed onset (0 before onset)")
    return res


def _temp_hum(c: Ctx, ewms):
    t, rh, st = c.temp, c.rh, c.stats
    for k in (0, 1, 2, 3, 4, 6, 8):
        c.add(f"temp_lag{k}", ops.lag(t, k), "temp", "lag", 1 if k == 0 else 2, f"average temperature {k} weeks back")
    c.add("tmax_lag0", c.tmax, "temp", "maxmin", 1, "weekly max temperature, latest observed week")
    c.add("tmin_lag0", c.tmin, "temp", "maxmin", 1, "weekly min temperature, latest observed week")
    c.add("temp_range0", c.tmax - c.tmin, "temp", "maxmin", 1, "max - min temperature (diurnal-range proxy)")
    c.add("tmax_mean4", ops.roll(c.tmax, 4, "mean"), "temp", "maxmin", 2, "4-week mean of max temperature")
    c.add("tmin_mean4", ops.roll(c.tmin, 4, "mean"), "temp", "maxmin", 2, "4-week mean of min temperature")
    for n in (4, 8):
        c.add(f"temp_mean{n}", ops.roll(t, n, "mean"), "temp", "roll", 2, f"{n}-week mean temperature")
    c.add("temp_std4", ops.roll(t, 4, "std"), "temp", "roll", 2, "4-week temperature SD")
    pa = c.past("avg_temp_c", -c.wlag)
    c.add("temp_anom0", t - pa["mean"], "temp", "anom", 2, "latest temperature minus past-year same-week climatology")
    c.add("temp_anom_mean4", ops.roll(t - pa["mean"], 4, "mean"), "temp", "anom", 2, "4-week mean temperature anomaly")
    suit = np.exp(-0.5 * ((t - TEMP_OPT) / TEMP_SD) ** 2)
    c.add("temp_suit0", suit, "temp", "nonlin", 2, f"Gaussian suitability around {TEMP_OPT} C (a-priori, unvalidated)")
    suit4 = ops.roll(suit, 4, "mean")
    c.add("temp_suit4", suit4, "temp", "nonlin", 2, "4-week mean suitability")
    c.add("temp_sq0", (t - TEMP_OPT) ** 2, "temp", "nonlin", 2, "squared deviation from the reference temperature")
    _aligned(c, t, "temp", (6, 7, 8), "temp", "aligned")
    for k in range(0, 7):
        c.add(f"rh_lag{k}", ops.lag(rh, k), "humidity", "lag", 1 if k == 0 else 2, f"humidity {k} weeks back")
    for n in (4, 8):
        c.add(f"rh_mean{n}", ops.roll(rh, n, "mean"), "humidity", "roll", 2, f"{n}-week mean humidity")
    pr = c.past("relative_humidity_pct", -c.wlag)
    c.add("rh_anom0", rh - pr["mean"], "humidity", "anom", 2, "latest humidity minus past-year climatology")
    c.add("rh_anom_mean4", ops.roll(rh - pr["mean"], 4, "mean"), "humidity", "anom", 2, "4-week mean humidity anomaly")
    hi = np.where(np.isnan(rh), np.nan, (rh > st.rh_hi_thr).astype(float))
    c.add("rh_hi_run", ops.run_length(hi), "humidity", "run", 2, "consecutive weeks above the fitted humidity q75")
    c.add("rh_hi_freq8", ops.roll(hi, 8, "mean"), "humidity", "run", 2, "share of last 8 weeks above that threshold")
    _aligned(c, rh, "rh", (2,), "humidity", "aligned", mode="clim")
    return suit, suit4


def _interactions(c: Ctx, ewms, suit, suit4, dens, wl, san, res):
    rh, r4 = c.rh, ops.roll(c.rain, 4, "sum")
    c.add("int_rain4_x_temp", r4 * suit4, "climate_int", "rain_temp", 2, "4-week rain sum x 4-week temperature suitability")
    c.add("int_ewm3_x_temp", ewms[3] * suit, "climate_int", "rain_temp", 2, "rain memory (age 3) x temperature suitability")
    c.add("int_rain4_x_rh", r4 * ops.roll(rh, 4, "mean") / 100, "climate_int", "rain_hum", 2, "4-week rain sum x humidity fraction")
    c.add("int_temp_x_rh", c.temp * rh / 100, "climate_int", "temp_hum", 2, "temperature x humidity fraction")
    c.add("int_rh_x_wl", ops.roll(rh, 4, "mean") * wl / 100, "climate_int", "hum_wl", 2, "humidity x waterlogging")
    rt3 = res[3][0]
    c.add("int_rtl3_x_temp", rt3 * suit4, "climate_int", "rain_temp", 2, "rain at target-lag 3 x temperature suitability")
    ew = ewms[3]
    for nm, v in {"breed_full": ew * suit * wl, "breed_no_temp": ew * wl, "breed_no_wl": ew * suit,
                  "breed_rain_only": ew, "breed_hum": ew * suit * wl * rh / 100,
                  "breed_aligned": c_win(c) * suit4 * wl, "breed_log": np.log1p(ew) * suit * (0.5 + wl)}.items():
        c.add(nm, v, "breeding", nm, 2, "hypothesised breeding index (rain memory x suitability x waterlogging variants); not validated")
    win, rtl3 = c_win(c), res[3][0]
    d1 = dens / 1e4
    for nm, base in (("ewm3", ew), ("rsum4", r4), ("rtl3", rtl3), ("win", win)):
        c.add(f"vuln_wl_x_{nm}", wl * base, "vuln", "wl_rain", 2, f"waterlogging x {nm}")
        c.add(f"vuln_san_x_{nm}", (1 - san) * base, "vuln", "san_rain", 2, f"(1 - sanitation) x {nm}")
        c.add(f"vuln_dens_x_{nm}", d1 * base, "vuln", "dens_rain", 2, f"density(1e4) x {nm}")
    c.add("vuln_wl_x_san", wl * (1 - san), "vuln", "static_int", 3, "waterlogging x (1 - sanitation)")
    c.add("vuln_dens_x_wl", d1 * wl, "vuln", "static_int", 3, "density x waterlogging")
    c.add("vuln_three_way", d1 * wl * (1 - san), "vuln", "static_int", 3, "density x waterlogging x (1 - sanitation)")
    c.add("vuln_three_way_x_win", d1 * wl * (1 - san) * win, "vuln", "wl_rain", 2, "three-way exposure x aligned rain")


def c_win(c: Ctx):
    return next(f.values for f in c.out if f.name == "rain_win")


def _cases(c: Ctx):
    y, hi = c.cases, c.stats.case_hi_thr
    for k in range(0, 12):
        c.add(f"case_lag{k}", ops.lag(y, k), "case", "lag", 2, f"cases {k} weeks before the latest reported week")
    c.add("case_log_last", np.log1p(y), "case", "lag", 2, "log1p of the latest reported count")
    c.add("case_log_mean4", np.log1p(ops.roll(y, 4, "mean")), "case", "lag", 2, "log1p of the 4-week mean count (Stage 1 baseline feature)")
    for n in (2, 4, 8, 12):
        c.add(f"case_sum{n}", ops.roll(y, n, "sum"), "case", "roll", 2, f"{n}-week case sum")
        c.add(f"case_max{n}", ops.roll(y, n, "max"), "case", "roll", 2, f"{n}-week max")
    zero = np.where(np.isnan(y), np.nan, (y == 0).astype(float))
    for n in (4, 8, 12):
        c.add(f"case_zero_frac{n}", ops.roll(zero, n, "mean"), "case", "zero", 2, f"share of zero weeks in the last {n}")
    nz = np.where(np.isnan(y), np.nan, (y > 0).astype(float))
    c.add("case_weeks_since_pos", ops.weeks_since(nz), "case", "zero", 2, "weeks since a non-zero count")
    m2 = ops.roll(y, 2, "mean")
    mom = m2 - ops.lag(m2, 2)
    c.add("case_momentum", mom, "case", "shape", 2, "2-week mean minus previous 2-week mean")
    c.add("case_accel", mom - ops.lag(mom, 2), "case", "shape", 2, "change in momentum")
    with np.errstate(all="ignore"):
        c.add("case_growth", np.log1p(m2) - np.log1p(ops.lag(m2, 2)), "case", "shape", 2, "log growth of the 2-week mean over 2 weeks")
    for a in (2, 4):
        c.add(f"case_ewm{a}", ops.ewm(y, a), "case", "ewm", 2, f"exponentially weighted cases, mean age {a} weeks")
    big = np.where(np.isnan(y), np.nan, (y >= hi).astype(float))
    c.add("case_outbreak_run", ops.run_length(big), "case", "outbreak", 2, "consecutive weeks at/above the fitted training q90 count")
    c.add("case_outbreak_freq8", ops.roll(big, 8, "mean"), "case", "outbreak", 2, "share of last 8 weeks at/above q90")
    mx = ops.roll(y, 12, "max")
    at_peak = np.where(np.isnan(mx), np.nan, (y >= mx).astype(float))
    c.add("case_since_peak12", ops.weeks_since(at_peak, cap=12), "case", "outbreak", 2, "weeks since the 12-week peak (0 if now)")
    with np.errstate(all="ignore"):
        c.add("case_recovery", np.where(np.isnan(mx), np.nan, np.where(mx > 0, y / np.where(mx > 0, mx, 1), 0.0)), "case", "outbreak", 2, "latest count / 12-week peak")
    c.add("case_zero_to_pos", ((y > 0) & (ops.lag(y, 1) == 0)).astype(float), "case", "outbreak", 2, "latest week is the first non-zero after a zero week")
    c.add("case_active", np.where(np.isnan(ops.roll(y, 4, "sum")), np.nan, (ops.roll(y, 4, "sum") > 0).astype(float)), "case", "outbreak", 2, "any case in the last 4 weeks")


def _hist(c: Ctx):
    s = c.h
    ph = c.past("dengue_cases", s)
    c.add("hist_case_mean_tgt", ph["mean"], "hist", "ward_season", 4, "ward's mean cases in the target week (+-2 weeks) over previous years")
    c.add("hist_case_sd_tgt", ph["sd"], "hist", "ward_season", 4, "across-year SD of that ward-season level")
    c.add("hist_case_mean_org", c.past("dengue_cases", 0)["mean"], "hist", "ward_season", 4, "ward's historical mean in the origin week")
    c.add("hist_prev_year_wk", ops.lag(c.grid.arr["dengue_cases"], 52 - s), "hist", "prev_year", 4, "cases one year (52 weeks) before the target week")
    c.add("hist_prev_year_win", sum(ops.lag(c.grid.arr["dengue_cases"], 52 - s + d) for d in (-1, 0, 1)) / 3, "hist", "prev_year", 4,
          "3-week mean around the same week one year earlier")
    c.add("hist_cases_52w", ops.roll(c.cases, 52, "sum"), "hist", "intensity", 2, "cases in the last 52 reported weeks")
    with np.errstate(all="ignore"):
        c.add("hist_ratio_org", (ops.roll(c.cases, 4, "mean") + 0.5) / (c.past("dengue_cases", 0)["mean"] + 0.5), "hist", "anomaly", 2,
              "recent 4-week mean vs the ward's historical origin-week level (season running hot/cold)")
    pr = c.past("city_rain", -c.wlag)
    c.add("hist_rain_anom4", ops.roll(c.city_rain - pr["mean"], 4, "mean"), "hist", "anomaly", 2, "4-week mean city-rain anomaly vs past-year climatology")


def _zero_infl(c: Ctx):
    s = c.h
    raw = c.grid.arr["dengue_cases"]
    stack = np.stack([ops.lag(raw, 52 * y - d - s) for y in range(1, 11) for d in (-2, -1, 0, 1, 2)], axis=2)
    ok = ~np.isnan(stack)
    n = ok.sum(2)
    with np.errstate(all="ignore"):
        zs = np.where(n > 0, ((stack == 0) & ok).sum(2) / n, np.nan)
    c.add("zi_hist_zero_share", zs, "zero_infl", "hist", 4, "share of previous years with zero cases at this ward-season")
    c.add("zi_city_zero_share", c.grid.city_mean(zs), "zero_infl", "hist", 4, "same, averaged over the city's wards (less noisy)")
    pos = np.where(np.isnan(c.cases), np.nan, (c.cases > 0).astype(float))
    c.add("zi_recent_pos", pos, "zero_infl", "recent", 2, "latest reported week non-zero")
    c.add("zi_pos_frac26", ops.roll(pos, 26, "mean"), "zero_infl", "recent", 2, "non-zero share over 26 weeks")
    c.add("zi_breeding_active", c.wet_now * (np.nan_to_num(ops.roll(c.rain, 3, "sum")) > c.stats.wet_thr), "zero_infl", "regime", 2,
          "wet regime and 3-week rain above the wet threshold (breeding-window activation proxy)")


def build_all(c: Ctx) -> list[Feat]:
    _calendar(c)
    dens, wl, san = _static(c)
    ewms = _rain(c)
    _rain_align_res = _rain_align(c)  # aligned rain first; the interactions reuse it
    suit, suit4 = _temp_hum(c, ewms)
    _interactions(c, ewms, suit, suit4, dens, wl, san, _rain_align_res)
    _cases(c)
    _hist(c)
    _zero_infl(c)
    return c.out
