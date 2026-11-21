"""Vectorised time-series operators on [ward, week] arrays. Every operator is causal: output[:, i] uses columns <= i."""
from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def lag(a: np.ndarray, k: int) -> np.ndarray:
    """out[:, i] = a[:, i - k]. Negative k (reading the future) is refused."""
    if k < 0:
        raise ValueError("negative lag would read the future")
    out = np.full(a.shape, np.nan)
    if k == 0:
        return a.copy()
    if k < a.shape[1]:
        out[:, k:] = a[:, :-k]
    return out


def windows(a: np.ndarray, n: int) -> np.ndarray:
    """[W, T, n] trailing windows ending at column i (inclusive); NaN where history is incomplete."""
    pad = np.concatenate([np.full((a.shape[0], n - 1), np.nan), a], axis=1)
    return sliding_window_view(pad, n, axis=1)


def roll(a: np.ndarray, n: int, how: str) -> np.ndarray:
    w = windows(a, n)
    with np.errstate(all="ignore"):
        if how == "sum":
            return w.sum(2)
        if how == "mean":
            return w.mean(2)
        if how == "max":
            return w.max(2)
        if how == "std":
            return w.std(2, ddof=1)
        if how == "slope":  # OLS slope per week over the window
            x = np.arange(n) - (n - 1) / 2
            return (w * x).sum(2) / (x ** 2).sum()
    raise KeyError(how)


def run_length(ind: np.ndarray) -> np.ndarray:
    """Consecutive trailing True weeks ending at i. NaN input -> NaN output."""
    out = np.full(ind.shape, np.nan)
    cur = np.zeros(ind.shape[0])
    for i in range(ind.shape[1]):
        v = ind[:, i]
        ok = ~np.isnan(v)
        cur = np.where(ok & (v > 0), cur + 1, 0.0)
        out[ok, i] = cur[ok]
    return out


def weeks_since(ind: np.ndarray, cap: int = 52) -> np.ndarray:
    """Weeks since `ind` was last True (0 when True now); counts observed weeks if never True; capped."""
    out = np.full(ind.shape, np.nan)
    cur = np.zeros(ind.shape[0])
    for i in range(ind.shape[1]):
        v = ind[:, i]
        ok = ~np.isnan(v)
        cur = np.where(ok & (v > 0), 0.0, cur + 1)
        out[ok, i] = np.minimum(cur[ok], cap)
    return out


def ewm(a: np.ndarray, mean_age: float) -> np.ndarray:
    """Exponentially weighted mean with weights (1-alpha)^age, alpha = 1/(1+mean_age); mean age = `mean_age` weeks."""
    alpha = 1.0 / (1.0 + mean_age)
    out = np.full(a.shape, np.nan)
    prev = np.full(a.shape[0], np.nan)
    for i in range(a.shape[1]):
        v = a[:, i]
        ok = ~np.isnan(v)
        first = ok & np.isnan(prev)
        prev = np.where(first, v, np.where(ok, alpha * v + (1 - alpha) * prev, np.nan))
        out[:, i] = prev
    return out


def past_stats(a: np.ndarray, s: int, thr: float | None = None, hw: int = 2, years: int = 10) -> dict:
    """Same-season statistics from PREVIOUS years for the week `s` weeks after the origin column.

    For origin column i the target-side week is j = i + s. Values are read at j - 52*y + d for y >= 1 and
    |d| <= hw, so every value is at least 52 - hw - s >= 46 weeks before the origin: strictly past, no fitting needed.
    """
    if 52 - hw - s <= 8:
        raise ValueError("past window too close to the origin")
    st = np.stack([lag(a, 52 * y - d - s) for y in range(1, years + 1) for d in range(-hw, hw + 1)], axis=2)
    ok = ~np.isnan(st)
    n = ok.sum(2)
    z = np.where(ok, st, 0.0)
    with np.errstate(all="ignore"):
        mean = z.sum(2) / n
        sd = np.sqrt(np.maximum((z ** 2).sum(2) / n - mean ** 2, 0.0))
        out = {"mean": mean, "sd": np.where(n > 1, sd, np.nan), "n": n.astype(float)}
        if thr is not None:
            for name, m in (("wet", ok & (st > thr)), ("dry", ok & (st <= thr))):
                k = m.sum(2)
                out[f"mean_{name}"] = np.where(m, st, 0.0).sum(2) / k
                out[f"n_{name}"] = k.astype(float)
            out["p_wet"] = (ok & (st > thr)).sum(2) / n
    out["mean"] = np.where(n > 0, out["mean"], np.nan)
    return out
