"""Retrospective decision-support tools over the saved out-of-time replay (seasons 2019-2024).

Nothing here fits a model, touches 2025, or changes the deployed alert rule. Inputs are the Stage 3 out-of-time predictions
(app_data/replay.csv.gz: each season predicted by a model trained on earlier seasons) and, for the historical-risk baseline,
cases observed strictly before each forecast origin.

Outbreak week (the event): actual cases >= the training-fold q90 (`thr_q90`), the same definition used to validate the deployed alert.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

GRID = np.round(np.arange(0.02, 1.0, 0.02), 2)


def _metrics(alert: np.ndarray, event: np.ndarray) -> dict:
    tp = int((alert & event).sum()); fp = int((alert & ~event).sum()); fn = int((~alert & event).sum()); tn = int((~alert & ~event).sum())
    rec = tp / (tp + fn) if tp + fn else None
    prec = tp / (tp + fp) if tp + fp else None
    f1 = 2 * rec * prec / (rec + prec) if rec and prec else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "flagged": tp + fp, "recall": rec, "precision": prec, "f1": round(f1, 4),
            "false_alert_rate": fp / (fp + tn) if fp + tn else None}


def _subset(R: pd.DataFrame, horizon: int | None, years: list[int] | None) -> pd.DataFrame:
    d = R
    if horizon is not None:
        d = d[d.horizon == horizon]
    if years:
        d = d[d.year.isin(years)]
    return d


def alert_curve(R: pd.DataFrame, horizon: int | None = None, years: list[int] | None = None) -> dict:
    """Retrospective policy exploration: metrics of `alert if P(outbreak) >= tau` for every tau on a grid, the deployed rule,
    and a nested estimate (tau re-chosen each season from the two previous seasons only, then applied to that season)."""
    d = _subset(R, horizon, years)
    if d.empty:
        raise ValueError("no replay rows for this selection")
    event, p = (d.y_true >= d.thr_q90).to_numpy(), d.p_outbreak.to_numpy()
    curve = [{"threshold": float(t), **_metrics(p >= t, event)} for t in GRID]
    best = max(curve, key=lambda r: r["f1"])
    # nested: for season Y choose tau maximising F1 on seasons Y-2, Y-1 (replay rows only), evaluate on Y. Honest out-of-sample number.
    nested_rows, picks = [], []
    full = _subset(R, horizon, None)
    for y in sorted(d.year.unique()):
        inner = full[full.year.isin([y - 2, y - 1])]
        if inner.year.nunique() < 2:
            continue
        ie, ip = (inner.y_true >= inner.thr_q90).to_numpy(), inner.p_outbreak.to_numpy()
        tau = float(max(GRID, key=lambda t: _metrics(ip >= t, ie)["f1"]))
        outer = d[d.year == y]
        picks.append({"year": int(y), "tau": tau})
        nested_rows.append(((outer.p_outbreak >= tau).to_numpy(), (outer.y_true >= outer.thr_q90).to_numpy()))
    nested = None
    if nested_rows:
        a = np.concatenate([x for x, _ in nested_rows]); e = np.concatenate([x for _, x in nested_rows])
        nested = {"seasons": picks, **_metrics(a, e)}
    return {"rows": int(len(d)), "outbreak_weeks": int(event.sum()), "base_rate": round(float(event.mean()), 4), "horizon": horizon,
            "years": sorted(int(y) for y in d.year.unique()), "curve": curve,
            "deployed": _metrics(d.alert.astype(bool).to_numpy(), event),
            "best_in_sample": {**best, "warning": "chosen on the same rows it is scored on: optimistic, not a validated result"},
            "nested": nested,
            "definition": "outbreak week = actual cases >= training-fold q90; alert = calibrated P(outbreak) >= threshold",
            "status": "retrospective policy exploration on saved out-of-time predictions; the deployed alert rule is unchanged"}


def historical_risk(panel: pd.DataFrame, origin: str) -> pd.Series:
    """Mean weekly cases per ward over all weeks strictly before the origin (information available at forecast time)."""
    past = panel[panel.date < pd.Timestamp(origin)]
    return past.groupby("ward_id").dengue_cases.mean()


def _equal_order(wards: pd.DataFrame) -> list[str]:
    """Risk-blind baseline: round-robin across cities (alphabetical), wards in ID order: spreads teams evenly."""
    by_city = {c: sorted(g.ward_id) for c, g in wards.groupby("city")}
    order, i = [], 0
    while any(by_city.values()):
        for c in sorted(by_city):
            if i < len(by_city[c]):
                order.append(by_city[c][i])
        i += 1
        if i > max(len(v) for v in by_city.values()):
            break
    return order


def allocate(R: pd.DataFrame, panel: pd.DataFrame, origin: str, horizon: int, teams: int) -> dict:
    """Compare three transparent ways to send `teams` teams to wards (one team per ward) for the target week of a replay origin."""
    d = R[(R.origin_date == origin) & (R.horizon == horizon)].copy()
    if d.empty:
        raise ValueError("allocation is evaluated on validation origins (2019-2024 replay) only")
    teams = max(1, min(int(teams), len(d)))
    d["hist_mean"] = d.ward_id.map(historical_risk(panel, origin)).fillna(0.0)
    d["outbreak"] = d.y_true >= d.thr_q90
    orders = {"equal": _equal_order(d),
              "historical": list(d.sort_values(["hist_mean", "ward_id"], ascending=[False, True]).ward_id),
              "forecast": list(d.sort_values(["p_outbreak", "mean", "ward_id"], ascending=[False, False, True]).ward_id)}
    total_out, total_cases = int(d.outbreak.sum()), float(d.y_true.sum())
    out = {}
    for name, order in orders.items():
        pick = d.set_index("ward_id").loc[order[:teams]]
        out[name] = {"wards": [{"ward_id": w, "city": r.city, "p_outbreak": round(float(r.p_outbreak), 3), "hist_mean": round(float(r.hist_mean), 2),
                                "forecast_mean": round(float(r["mean"]), 2), "actual": int(r.y_true), "outbreak": bool(r.outbreak)} for w, r in pick.iterrows()],
                     "forecast_cases_covered": round(float(pick["mean"].sum()), 1),
                     "outbreak_wards_covered": int(pick.outbreak.sum()), "actual_cases_covered": int(pick.y_true.sum())}
    return {"origin": origin, "target_date": str(d.target_date.iloc[0]), "horizon": horizon, "teams": teams, "wards": int(len(d)),
            "actual_outbreak_wards": total_out, "actual_cases": int(total_cases), "strategies": out,
            "rules": {"equal": "risk-blind: round-robin across cities, wards in ID order",
                      "historical": "highest mean weekly cases observed before the origin",
                      "forecast": "highest calibrated outbreak probability at the origin (ties: expected cases)"},
            "status": "planning simulation on historical replay; outcomes are retrospective coverage counts, not prevented infections or real capacity"}


def allocation_season(R: pd.DataFrame, panel: pd.DataFrame, year: int, horizon: int, teams: int) -> dict:
    """Average retrospective coverage of actual outbreak wards over every origin of one validation season."""
    origins = sorted(R[(R.year == year) & (R.horizon == horizon)].origin_date.unique())
    acc = {k: {"outbreak_wards_covered": 0, "actual_cases_covered": 0} for k in ("equal", "historical", "forecast")}
    tot_out = tot_cases = 0
    for o in origins:
        a = allocate(R, panel, o, horizon, teams)
        tot_out += a["actual_outbreak_wards"]; tot_cases += a["actual_cases"]
        for k in acc:
            acc[k]["outbreak_wards_covered"] += a["strategies"][k]["outbreak_wards_covered"]
            acc[k]["actual_cases_covered"] += a["strategies"][k]["actual_cases_covered"]
    for k in acc:
        acc[k]["share_outbreak_wards"] = round(acc[k]["outbreak_wards_covered"] / tot_out, 3) if tot_out else None
        acc[k]["share_cases"] = round(acc[k]["actual_cases_covered"] / tot_cases, 3) if tot_cases else None
    return {"year": year, "horizon": horizon, "teams": teams, "origins": len(origins), "outbreak_ward_weeks": tot_out, "case_total": tot_cases, "strategies": acc}
