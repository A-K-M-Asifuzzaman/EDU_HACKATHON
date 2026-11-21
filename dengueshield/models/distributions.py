"""Predictive count distributions. Medians and intervals are exact distributional quantiles, never rounded means."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import nbinom, poisson

KMAX = 400


def _hurdle_lambda(m: np.ndarray, iters: int = 60) -> np.ndarray:
    """Invert m = lam / (1 - exp(-lam)) (mean of a zero-truncated Poisson); m <= 1 maps to lam -> 0."""
    m = np.asarray(m, float)
    lam = np.maximum(m - 0.5, 1e-6)
    for _ in range(iters):
        e = np.exp(-lam)
        f = lam / (1 - e) - m
        df = (1 - e - lam * e) / (1 - e) ** 2
        lam = np.maximum(lam - f / np.maximum(df, 1e-9), 1e-9)
    return np.where(m <= 1 + 1e-9, 1e-9, lam)


@dataclass
class CountDist:
    """kind: poisson (mu) | nb (mu, alpha: var = mu + alpha mu^2) | hurdle (p = P(Y>0), lam) | point (q50 only)."""
    kind: str
    mu: np.ndarray | None = None
    alpha: float | np.ndarray | None = None
    p: np.ndarray | None = None
    lam: np.ndarray | None = None
    q50: np.ndarray | None = None

    def mean(self) -> np.ndarray:
        if self.kind in ("poisson", "nb"):
            return np.asarray(self.mu, float)
        if self.kind == "hurdle":
            lam = np.asarray(self.lam, float)
            return self.p * lam / (1 - np.exp(-lam))
        return np.full(len(self.q50), np.nan)

    def _cdf_grid(self, k: np.ndarray) -> np.ndarray:
        """CDF evaluated on integer grid k (shape [K]) for every row -> [n, K]."""
        if self.kind == "poisson":
            return poisson.cdf(k[None, :], np.maximum(self.mu, 1e-9)[:, None])
        if self.kind == "nb":
            a = np.broadcast_to(np.maximum(np.asarray(self.alpha, float), 1e-8), np.shape(self.mu))
            n = 1 / a
            pr = 1 / (1 + a * np.maximum(self.mu, 1e-9))
            return nbinom.cdf(k[None, :], n[:, None], pr[:, None])
        if self.kind == "hurdle":
            lam = np.maximum(np.asarray(self.lam, float), 1e-9)[:, None]
            p = np.asarray(self.p, float)[:, None]
            e0 = np.exp(-lam)
            trunc = (poisson.cdf(k[None, :], lam) - e0) / (1 - e0)
            return np.where(k[None, :] >= 0, (1 - p) + p * np.clip(trunc, 0, 1), 0.0)
        raise ValueError("point forecasts have no distribution")

    def quantile(self, q: float) -> np.ndarray:
        if self.kind == "point":
            if abs(q - 0.5) > 1e-12:
                return np.full(len(self.q50), np.nan)
            return np.maximum(np.round(np.asarray(self.q50, float)), 0)
        if self.kind == "poisson":
            return poisson.ppf(q, np.maximum(self.mu, 1e-9))
        if self.kind == "nb":
            a = np.maximum(np.asarray(self.alpha, float), 1e-8)
            return nbinom.ppf(q, 1 / a, 1 / (1 + a * np.maximum(self.mu, 1e-9)))
        k = np.arange(KMAX + 1)
        F = self._cdf_grid(k)
        return np.argmax(F >= q - 1e-12, axis=1).astype(float)

    def median(self) -> np.ndarray:
        return self.quantile(0.5)

    def interval(self, level: float) -> tuple[np.ndarray, np.ndarray]:
        return self.quantile((1 - level) / 2), self.quantile((1 + level) / 2)

    def prob_ge(self, t: float) -> np.ndarray:
        """P(Y >= t) for integer threshold t."""
        t = int(np.ceil(t))
        if t <= 0:
            return np.ones(len(self.mean()))
        if self.kind == "poisson":
            return poisson.sf(t - 1, np.maximum(self.mu, 1e-9))
        if self.kind == "nb":
            a = np.maximum(np.asarray(self.alpha, float), 1e-8)
            return nbinom.sf(t - 1, 1 / a, 1 / (1 + a * np.maximum(self.mu, 1e-9)))
        if self.kind == "hurdle":
            return 1 - self._cdf_grid(np.array([t - 1]))[:, 0]
        return (np.asarray(self.q50) >= t).astype(float)


def moment_alpha(y, mu) -> float:
    """NB2 dispersion by moments: sum((y - mu)^2 - mu) / sum(mu^2), floored at 1e-6."""
    y, mu = np.asarray(y, float), np.asarray(mu, float)
    return float(max(np.sum((y - mu) ** 2 - mu) / max(np.sum(mu ** 2), 1e-12), 1e-6))
