"""Problem 3 (Phase 2 onsite): vector-control scenario simulator. An assumption-driven, forecast-informed response model, not a
measured or validated causal effect: the organizer data contain no interventions and no intervention outcomes.

Inputs per ward i and horizon h (2, 3, 4 weeks after the forecast origin): mu_ih, the saved origin-safe forecast of expected weekly
cases (fractional), and the service-level quantile q_ih used for resource demand. Crews k_i are deployed once, at the origin.

Response model (every parameter is a user-set, labelled assumption):
  coverage   C(k)   = 1 - (1 - a)^k                       a = share of a ward one crew treats; crews overlap at random, so each extra
                                                          crew covers a share a of what is still untreated (diminishing returns)
  timing     T(h)   = min(1, max(0, (h - d) / w))          d = weeks before any effect reaches reported cases, w = build-up weeks
  reduction  R(k,h) = E * C(k) * T(h)                      E = largest share of projected cases averted at full coverage, E <= 0.8
  scenario   mu'_ih = (1 - R(k_i, h)) * mu_ih,  prevented_ih = R(k_i, h) * mu_ih,  q'_ih = (1 - R(k_i, h)) * q_ih
k = 0 or E = 0 gives R = 0 and reproduces the forecast exactly. 0 <= R <= E <= 0.8, so scenario cases stay non-negative. R rises with k
for fixed assumptions, so adding crews never worsens the modelled reduction.

Optimised deployment. Maximise prevented cases over the window, sum_i sum_h R(k_i, h) mu_ih = sum_i E * W_i * C(k_i) with
W_i = sum_h T(h) mu_ih, subject to sum_i k_i <= K and 0 <= k_i <= k_max, integers. The marginal value of the k-th crew in ward i is
g_i(k) = E * W_i * a * (1 - a)^(k - 1), non-increasing in k, so the objective is a sum of concave functions under one budget and the
greedy rule (always give the next crew to the largest marginal value; ties by outbreak probability, then ward_id) is exact. Crews with
zero marginal value are left unassigned and reported. tests/test_intervention.py checks the optimum against brute force and dynamic
programming.
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass

import numpy as np

HORIZONS = (2, 3, 4)
MAX_EFFECT = 0.8


@dataclass(frozen=True)
class Effect:
    max_reduction: float = 0.30          # E
    coverage: float = 0.35               # a
    delay: int = 1                       # d (weeks)
    buildup: int = 2                     # w (weeks)
    sens_low: float = 0.5                # sensitivity multipliers on E
    sens_high: float = 1.5

    def validate(self) -> None:
        if not 0.0 <= self.max_reduction <= MAX_EFFECT:
            raise ValueError(f"maximum reduction must be between 0 and {MAX_EFFECT}")
        if not 0.05 <= self.coverage <= 1.0:
            raise ValueError("coverage per crew must be between 0.05 and 1")
        if not 0 <= self.delay <= 3 or not 1 <= self.buildup <= 3:
            raise ValueError("delay must be 0-3 weeks and build-up 1-3 weeks")
        if not 0.0 <= self.sens_low <= 1.0 <= self.sens_high <= 2.0:
            raise ValueError("sensitivity multipliers must satisfy 0 <= low <= 1 <= high <= 2")

    def scaled(self, m: float) -> "Effect":
        return Effect(min(MAX_EFFECT, self.max_reduction * m), self.coverage, self.delay, self.buildup, self.sens_low, self.sens_high)


def coverage(k, a: float) -> np.ndarray:
    k = np.asarray(k, dtype=float)
    if (k < 0).any():
        raise ValueError("crews must be non-negative")
    return 1.0 - (1.0 - a) ** k


def timing(h: int, delay: int, buildup: int) -> float:
    return float(min(1.0, max(0.0, (h - delay) / buildup)))


def reduction(k, h: int, eff: Effect) -> np.ndarray:
    return eff.max_reduction * coverage(k, eff.coverage) * timing(h, eff.delay, eff.buildup)


def window_weight(mu: dict[int, np.ndarray], eff: Effect) -> np.ndarray:
    """W_i = sum_h T(h) mu_ih over the available horizons."""
    return sum(timing(h, eff.delay, eff.buildup) * np.asarray(m, dtype=float) for h, m in mu.items())


def marginal(weight, k, eff: Effect) -> np.ndarray:
    """Value of the k-th crew (k >= 1) in each ward: E * W * a * (1 - a)^(k - 1)."""
    return eff.max_reduction * np.asarray(weight, dtype=float) * eff.coverage * (1.0 - eff.coverage) ** (np.asarray(k, dtype=float) - 1)


def optimise(weight, crews: int, kmax: int, eff: Effect, tie: list) -> np.ndarray:
    """Greedy marginal-value allocation (exact for this concave separable objective). tie: sortable key per ward, smaller = earlier."""
    w = np.asarray(weight, dtype=float)
    if crews < 0 or kmax < 0:
        raise ValueError("crew budget and per-ward maximum must be non-negative")
    k = np.zeros(len(w), dtype=np.int64)
    heap = [(-float(marginal(w[i], 1, eff)), tie[i], i) for i in range(len(w)) if kmax > 0]
    heapq.heapify(heap)
    left = int(crews)
    while left and heap:
        neg, t, i = heapq.heappop(heap)
        if neg >= 0:                                                              # no modelled benefit left anywhere
            break
        k[i] += 1
        left -= 1
        if k[i] < kmax:
            heapq.heappush(heap, (-float(marginal(w[i], k[i] + 1, eff)), t, i))
    return k


def simulate(mu: dict[int, np.ndarray], crews_by_ward, eff: Effect) -> dict:
    """Per-horizon baseline, scenario and prevented expected cases for one deployment (unrounded floats)."""
    eff.validate()
    k = np.asarray(crews_by_ward, dtype=np.int64)
    out = {}
    for h, m in mu.items():
        m = np.asarray(m, dtype=float)
        r = reduction(k, h, eff)
        lo, hi = reduction(k, h, eff.scaled(eff.sens_low)), reduction(k, h, eff.scaled(eff.sens_high))
        out[h] = {"baseline": m, "reduction": r, "scenario": (1.0 - r) * m, "prevented": r * m, "prevented_low": lo * m, "prevented_high": hi * m}
    return out
