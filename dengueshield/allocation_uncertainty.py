"""Planning comparisons over full historical ward residual vectors (development replay only)."""
from __future__ import annotations

from time import perf_counter

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix

from . import allocation

CONFIDENCE = 0.8


def joint_cases(replay: pd.DataFrame, origin: str, horizon: int, wards: list[str], median: np.ndarray):
    """Add complete residual vectors from the same seasonal week ±2, drawn from prior years."""
    issued = pd.Timestamp(origin)
    previous = replay.loc[(replay.horizon == horizon) & (replay.year < min(issued.year, 2025))
                          & (replay.target_date < origin) & replay.ward_id.isin(wards)]
    dates = pd.to_datetime(previous.origin_date)
    week_diff = np.abs(dates.dt.isocalendar().week.astype(int) - issued.isocalendar().week)
    previous = previous.loc[np.minimum(week_diff, 52 - week_diff) <= 2]
    residuals = previous.assign(residual=previous.y_true - previous["median"]).pivot(
        index="origin_date", columns="ward_id", values="residual").reindex(columns=wards).dropna().sort_index()
    if len(residuals) < 5:
        raise ValueError("At least five complete, prior-season replay weeks are required for this comparison.")
    observed = previous.pivot(index="origin_date", columns="ward_id", values="y_true").reindex(index=residuals.index, columns=wards)
    return np.maximum(median + residuals.to_numpy(), 0), observed.mean(axis=0).to_numpy(), residuals.index.tolist()


def shortages(demand: np.ndarray, assigned: np.ndarray, weights: np.ndarray):
    unmet = np.maximum(demand - assigned, 0)
    losses = unmet @ weights
    # The minimizer in the empirical CVaR expression can be chosen at an observed loss.
    tail = np.min(losses + np.maximum(losses[:, None] - losses, 0).mean(axis=0) / (1 - CONFIDENCE))
    return {"tail_weighted_shortage": float(tail), "mean_weighted_shortage": float(losses.mean()),
            "worst_unmet": int(unmet.sum(axis=1).max()), "unmet_by_scenario": unmet.sum(axis=1).tolist()}


def solve(nominal: np.ndarray, bounds: np.ndarray, budget: int, demand: np.ndarray, weights: np.ndarray):
    """Integer supply, continuous scenario shortages and CVaR auxiliaries. No constraint mixes city pools."""
    m, n = demand.shape
    eta, excess = n + m * n, n + m * n + 1
    size = excess + m
    matrix = lil_matrix((1 + m * n + m, size))
    matrix[0, :n] = 1
    lower = np.r_[budget, demand.ravel(), np.full(m, -np.inf)]
    upper = np.r_[budget, np.full(m * n, np.inf), np.zeros(m)]
    for j in range(m):
        for i in range(n):
            row = 1 + j * n + i
            matrix[row, i] = matrix[row, row + n - 1] = 1
        row = 1 + m * n + j
        matrix[row, n + j * n:n + (j + 1) * n] = weights
        matrix[row, eta] = matrix[row, excess + j] = -1
    objective = np.r_[np.zeros(eta), 1.0, np.full(m, 1 / (m * (1 - CONFIDENCE)))]
    start = perf_counter()
    result = milp(objective, integrality=np.r_[np.ones(n), np.zeros(size - n)],
                  bounds=Bounds(np.r_[bounds, np.zeros(size - n)], np.r_[nominal, np.full(size - n, np.inf)]),
                  constraints=LinearConstraint(matrix.tocsr(), lower, upper),
                  options={"time_limit": 1.5, "mip_rel_gap": 0.0})
    elapsed = (perf_counter() - start) * 1000
    if result.x is None or result.status not in (0, 1):
        return None, {"status": "unavailable", "runtime_ms": round(elapsed, 2)}
    assigned = np.rint(result.x[:n]).astype(int)
    if (np.abs(result.x[:n] - assigned) > 1e-5).any() or (assigned < bounds).any() or (assigned > nominal).any() or assigned.sum() != budget:
        raise RuntimeError("Solver returned a candidate that failed integer conservation checks.")
    status = "optimal" if result.status == 0 else "feasible_limit"
    gap = getattr(result, "mip_gap", None)
    return assigned, {"status": status, "runtime_ms": round(elapsed, 2), "gap": float(gap) if gap is not None and np.isfinite(gap) else None}


def compare_pool(ward_ids: list[str], nominal: np.ndarray, demand: np.ndarray, supply: int, reserve_pct: int,
                 floor: float, density: np.ndarray, history: np.ndarray, forecast: np.ndarray, hybrid: np.ndarray):
    reserve = supply * reserve_pct // 100
    budget = min(supply - reserve, int(nominal.sum()))
    effective_floor = min(floor, budget / max(1, int(nominal.sum())))
    lower = np.floor(effective_floor * nominal).astype(int)
    equal = lower.copy()
    left = budget - int(equal.sum())
    while left > 0:
        for index in np.flatnonzero(equal < nominal)[:left]:
            equal[index] += 1
            left -= 1
    # The incumbent hybrid policy is the existing greedy optimum for nominal weighted fulfillment.
    allocations = {"equal": equal, **{
        name: allocation.allocate_pool(nominal, budget, weight, ward_ids, floor)
        for name, weight in (("density", density), ("historical", history), ("forecast", forecast), ("hybrid", hybrid))
    }}
    candidate, certificate = solve(nominal, lower, budget, demand, hybrid)
    if candidate is not None:
        allocations["tail_risk"] = candidate
    results = {
        name: {**shortages(demand, assigned, hybrid),
               "allocated": int(assigned.sum()), "nominal_unmet": int(np.maximum(nominal - assigned, 0).sum()),
               "nominal_weighted_fulfillment": round(float(assigned @ hybrid), 6),
               "min_nominal_coverage": round(float(np.min(assigned / nominal.clip(min=1), where=nominal > 0, initial=1)), 6),
               "meets_floor": bool((assigned >= lower).all())}
        for name, assigned in allocations.items()
    }
    return {"stock": supply, "reserve": reserve, "assignable": budget, "unallocated": supply - reserve - budget,
            "nominal_demand": int(nominal.sum()), "floor_share": effective_floor,
            "nominal_extra_for_full_coverage": max(0, int(nominal.sum()) - budget), "solver": certificate,
            "policies": results,
            "wards": [{"ward_id": ward_id, "nominal_demand": int(nominal[i]), "fairness_floor": int(lower[i]),
                       "allocations": {name: int(assigned[i]) for name, assigned in allocations.items()}}
                      for i, ward_id in enumerate(ward_ids)]}
