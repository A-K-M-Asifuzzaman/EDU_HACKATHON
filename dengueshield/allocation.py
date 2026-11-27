"""Problem 1 (Phase 2 onsite): constrained allocation of saline, diagnostic kits, hospital beds and spraying crews to the 60 wards.

Demand. For ward i and resource r, demand d_ir = floor(m_r * c_i + 1/2), where c_i is the ward's forecast case count at the chosen
service level (median, upper end of the 80% range, or upper end of the 90% range) and m_r is the multiplier identified on 2016-2018
(app_data/resource_rules.json; reproduces every 2016-2024 row of the onsite data). Forecasts come from origins in 2024 or earlier;
observed target-week cases and the dataset's resource columns are never inputs.

Supply (a configured assumption: the dataset has no stock inventory). Each city is its own pool. For stock level s in [0.30, 1.00]
the city receives S_cr = floor(s * sum of its wards' d_ir). Cities never share supply (no cross-city leakage).

Allocation per city and resource: choose integers x_i maximising sum(w_i * x_i) subject to
    f_i <= x_i <= d_i  (fairness floor f_i = floor(phi * d_i), phi = min(floor setting, s), so the floors always fit the supply),
    sum(x_i) = min(S, sum(d_i))  (all available stock is placed; nothing is created).
This is a linear programme with one budget row and box bounds (a fractional knapsack with unit costs), so filling wards to their
demand in descending order of w_i is optimal, and the optimum is integral because every bound is an integer. tests/test_allocation.py
checks the objective against scipy's exact LP solver. Ties are broken by ward_id, so results are deterministic.

Priority w_i = alpha * P(outbreak)_i + (1 - alpha) * density_i / max density of all 60 wards, alpha in [0, 1]. The density term uses
the dataset's population_density_sqkm; no population or capacity is invented.

Crews (an assumption: the dataset has no crew data). Ward crew need = 0 with no forecast cases, otherwise
min(max per ward, 1 + floor(c_i / cases per extra crew)). Crews are assigned in rounds: the first crew to every ward that needs one,
in priority order, then second crews, and so on. This is a stated rule (coverage first), not a claimed optimum.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "app_data" / "resource_rules.json"
RESOURCES = ("saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required")
SERVICE_COLUMN = {"median": "median_cases", "p80": "upper_80", "p90": "upper_90"}
SERVICE_LABEL = {"median": "median forecast", "p80": "upper end of the 80% range", "p90": "upper end of the 90% range"}
HIGH_TIERS = ("High", "Critical")


def load_rules(path: Path = RULES_PATH) -> dict[str, float]:
    rules = json.loads(path.read_text())["resources"]
    return {r: float(rules[r]["multiplier"]) for r in RESOURCES}


def demand(cases, multiplier: float) -> np.ndarray:
    c = np.asarray(cases, dtype=float)
    if (c < 0).any() or not np.isfinite(c).all():
        raise ValueError("case counts must be finite and non-negative")
    return np.floor(c * multiplier + 0.5).astype(np.int64)


def priority(p_outbreak, density, density_ref: float, alpha: float) -> np.ndarray:
    if not 0.0 <= alpha <= 1.0:
        raise ValueError("risk weight must be in [0, 1]")
    p = np.clip(np.asarray(p_outbreak, dtype=float), 0.0, 1.0)
    return alpha * p + (1.0 - alpha) * np.asarray(density, dtype=float) / float(density_ref)


def order_by_priority(w: np.ndarray, keys: list[str]) -> list[int]:
    """Descending priority; equal priorities are ordered by ward_id (deterministic, independent of input order)."""
    return sorted(range(len(keys)), key=lambda i: (-round(float(w[i]), 12), keys[i]))


def allocate_pool(d: np.ndarray, supply: int, w: np.ndarray, keys: list[str], floor_share: float) -> np.ndarray:
    """Integer allocation of one resource within one pool (see the module docstring for the programme it solves)."""
    d = np.asarray(d, dtype=np.int64)
    if (d < 0).any():
        raise ValueError("demand must be non-negative")
    if supply < 0 or int(supply) != supply:
        raise ValueError("supply must be a non-negative integer")
    if not 0.0 <= floor_share <= 1.0:
        raise ValueError("fairness floor must be in [0, 1]")
    total = int(d.sum())
    if supply >= total:
        return d.copy()
    phi = min(floor_share, supply / total)                            # floors always fit: sum(floor(phi*d)) <= phi*sum(d) <= supply
    x = np.floor(phi * d).astype(np.int64)
    left = int(supply - x.sum())
    for i in order_by_priority(w, keys):
        if left == 0:
            break
        give = min(int(d[i] - x[i]), left)
        x[i] += give
        left -= give
    return x


def pool_supply(stock: float, total_demand: int) -> int:
    """A city's configured supply of one resource: floor(stock x projected demand). Problem 2 reports it for beds, never adds it."""
    return int(np.floor(stock * total_demand + 1e-9))


def crew_need(cases, cases_per_crew: int, max_per_ward: int) -> np.ndarray:
    c = np.asarray(cases, dtype=np.int64)
    return np.where(c > 0, np.minimum(max_per_ward, 1 + c // cases_per_crew), 0).astype(np.int64)


def assign_crews(need: np.ndarray, crews: int, w: np.ndarray, keys: list[str]) -> np.ndarray:
    need = np.asarray(need, dtype=np.int64)
    got = np.zeros_like(need)
    order = order_by_priority(w, keys)
    left = int(crews)
    for k in range(1, int(need.max(initial=0)) + 1):
        for i in order:
            if left == 0:
                return got
            if need[i] >= k:
                got[i] += 1
                left -= 1
    return got


@dataclass(frozen=True)
class Settings:
    service: str = "p80"
    stock: float = 0.6
    crews: int = 20
    alpha: float = 0.7
    floor_share: float = 0.25
    cases_per_crew: int = 10
    max_crews_per_ward: int = 3

    def validate(self) -> None:
        if self.service not in SERVICE_COLUMN:
            raise ValueError(f"service level must be one of {list(SERVICE_COLUMN)}")
        if not 0.30 <= self.stock <= 1.00:
            raise ValueError("regional stock must be between 30% and 100%")
        if not 0 <= self.crews <= 1000:
            raise ValueError("total crews must be between 0 and 1000")
        if not 0.0 <= self.alpha <= 1.0 or not 0.0 <= self.floor_share <= 0.5:
            raise ValueError("risk weight must be in [0, 1] and the fairness floor in [0, 0.5]")
        if not 1 <= self.cases_per_crew <= 100 or not 1 <= self.max_crews_per_ward <= 10:
            raise ValueError("crew settings out of range")


def plan(fc: pd.DataFrame, wards: pd.DataFrame, rules: dict[str, float], st: Settings, supply: dict | None = None) -> dict:
    """fc: one forecast row per ward (ward_id, city, median_cases, upper_80, upper_90, p_outbreak, risk_tier). Case columns may be
    fractional (scenario forecasts); demand rounds once, through the resource rule.
    wards: the 60 wards' static attributes (ward_id, population_density_sqkm); its maximum density scales the density term.
    supply: optional fixed pool per (city, resource), e.g. the baseline stock when demand changes under a scenario."""
    st.validate()
    if fc.ward_id.duplicated().any():
        raise ValueError("one forecast row per ward expected")
    df = fc.merge(wards[["ward_id", "population_density_sqkm"]], on="ward_id", how="left", validate="one_to_one")
    if df.population_density_sqkm.isna().any():
        raise ValueError("unknown ward in forecast")
    df = df.sort_values(["city", "ward_id"], ignore_index=True)
    df["cases"] = df[SERVICE_COLUMN[st.service]].astype(float)
    df["priority"] = priority(df.p_outbreak, df.population_density_sqkm, float(wards.population_density_sqkm.max()), st.alpha)
    for r in RESOURCES:
        df[f"{r}_demand"] = demand(df.cases, rules[r])
    df["crews_needed"] = crew_need(df.cases, st.cases_per_crew, st.max_crews_per_ward)

    cities = []
    for city, g in df.groupby("city", sort=True):
        idx, keys, w = g.index.to_numpy(), g.ward_id.tolist(), g.priority.to_numpy()
        summ = {"city": city, "wards": len(g)}
        for r in RESOURCES:
            d = g[f"{r}_demand"].to_numpy()
            pool = pool_supply(st.stock, int(d.sum())) if supply is None else int(supply[(city, r)])
            x = allocate_pool(d, pool, w, keys, st.floor_share)
            df.loc[idx, f"{r}_allocated"] = x
            summ[r] = {"demand": int(d.sum()), "supply": pool, "allocated": int(x.sum()), "unmet": int(d.sum() - x.sum()),
                       "surplus": int(pool - x.sum())}
        cities.append(summ)
    # crews: one regional team pool, assigned across all wards in view by priority (crews move between cities within the region)
    df["crews_assigned"] = assign_crews(df.crews_needed.to_numpy(), st.crews, df.priority.to_numpy(), df.ward_id.tolist())
    for r in RESOURCES:
        df[f"{r}_allocated"] = df[f"{r}_allocated"].astype(np.int64)
        df[f"{r}_unmet"] = df[f"{r}_demand"] - df[f"{r}_allocated"]
    unmet_any = (df[[f"{r}_unmet" for r in RESOURCES]] > 0).any(axis=1)
    fill = np.min([np.where(df[f"{r}_demand"] > 0, df[f"{r}_allocated"] / df[f"{r}_demand"].clip(lower=1), 1.0) for r in RESOURCES], axis=0)
    df["fill_rate"] = fill
    df["status"] = np.where(~unmet_any, "met", np.where((fill < 0.5) | df.risk_tier.isin(HIGH_TIERS), "critical", "deficit"))
    rank = order_by_priority(df.priority.to_numpy(), df.ward_id.tolist())
    df.loc[rank, "rank"] = np.arange(1, len(df) + 1)
    df["rank"] = df["rank"].astype(int)
    total = {r: {k: int(sum(c[r][k] for c in cities)) for k in ("demand", "supply", "allocated", "unmet", "surplus")} for r in RESOURCES}
    total["crews"] = {"total": int(st.crews), "needed": int(df.crews_needed.sum()), "assigned": int(df.crews_assigned.sum()),
                      "unassigned": int(st.crews - df.crews_assigned.sum()), "unmet_need": int(df.crews_needed.sum() - df.crews_assigned.sum())}
    for c in cities:
        g = df[df.city == c["city"]]
        c["crews"] = {"needed": int(g.crews_needed.sum()), "assigned": int(g.crews_assigned.sum())}
        c["critical_wards"] = int((g.status == "critical").sum())
        c["deficit_wards"] = int((g.status != "met").sum())
    return {"wards": df.sort_values("rank"), "cities": cities, "totals": total,
            "counts": {s: int((df.status == s).sum()) for s in ("met", "deficit", "critical")}}
