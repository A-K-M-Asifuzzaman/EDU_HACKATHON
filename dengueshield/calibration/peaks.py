"""High-incidence corrections and alert rules, each learned on inner seasons (< outer year) only."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.isotonic import IsotonicRegression

from dengueshield.models import seasons as S


def _alert_metrics(y, thr, alert):
    hi = y >= thr
    tp = int((alert & hi).sum())
    return {"recall": tp / max(hi.sum(), 1), "precision": tp / alert.sum() if alert.sum() else np.nan,
            "false_alert_rate": float((alert & ~hi).sum() / max((~hi).sum(), 1)), "alerts": int(alert.sum()), "high_n": int(hi.sum())}


def _point_metrics(y, thr, pred):
    hi = y >= thr
    return {"mae": float(np.mean(np.abs(pred - y))), "mae_ordinary": float(np.mean(np.abs(pred[~hi] - y[~hi]))),
            "high_mae": float(np.mean(np.abs(pred[hi] - y[hi]))) if hi.any() else np.nan,
            "high_bias": float(np.mean(pred[hi] - y[hi])) if hi.any() else np.nan,
            "high_under": float(np.mean(pred[hi] < y[hi])) if hi.any() else np.nan, "bias": float(np.mean(pred - y))}


def _best_f1_threshold(score, y, thr):
    hi = y >= thr
    best, bt = -1, 0.5
    for t in np.unique(np.quantile(score, np.linspace(0.5, 0.995, 120))):
        a = score >= t
        tp = (a & hi).sum()
        if a.sum() == 0:
            continue
        f1 = 2 * tp / (a.sum() + hi.sum())
        if f1 > best:
            best, bt = f1, t
    return float(bt)


def evaluate(count: pd.DataFrame, clf: pd.DataFrame | None = None, quantiles: dict | None = None, years=S.OUTER) -> pd.DataFrame:
    """count: season predictions of a count model (mu). clf: severity-classifier predictions (p). quantiles: {name: preds with q50}."""
    KEY = ["ward_id", "origin_date", "horizon", "year"]
    rows = []
    for h in sorted(count.horizon.unique()):
        for yr in years:
            inner = count[(count.horizon == h) & count.year.isin(S.inner_seasons(yr))]
            O = count[(count.horizon == h) & (count.year == yr)]
            y, mu, thr = O.y_true.to_numpy(float), O.mu.to_numpy(float), float(O.thr_q90.iloc[0])
            yi, mui = inner.y_true.to_numpy(float), inner.mu.to_numpy(float)
            thr_i = inner.thr_q90.to_numpy(float)
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0).fit(mui, yi)
            mu_iso = np.maximum(iso.predict(mu), 1e-9)
            big_i = mui >= inner.tier_e2.to_numpy()                       # inner rows with predicted mean >= training q80
            c = float(np.clip(yi[big_i].sum() / max(mui[big_i].sum(), 1e-9), 1.0, 2.0)) if big_i.any() else 1.0
            mu_pk = np.where(mu >= O.tier_e2.to_numpy(), mu * c, mu)
            p_ge_i = poisson.sf(np.ceil(thr_i) - 1, np.maximum(mui, 1e-9))
            t_pois = _best_f1_threshold(p_ge_i, yi, thr_i)
            p_ge = poisson.sf(np.ceil(thr) - 1, np.maximum(mu, 1e-9))
            variants = {
                "median (baseline)": poisson.median(np.maximum(mu, 1e-9)),
                "mean": mu,
                "isotonic-calibrated median": poisson.median(mu_iso),
                "peak multiplier on predicted means >= training q80 (median)": poisson.median(np.maximum(mu_pk, 1e-9)),
                "upper quantile 0.65 (Poisson)": poisson.ppf(0.65, np.maximum(mu, 1e-9)),
            }
            for name, pred in variants.items():
                alert = pred >= thr
                rows.append({"method": name, "horizon": h, "year": yr, "param": c if name.startswith("peak multiplier") else np.nan,
                             **_point_metrics(y, thr, pred), **_alert_metrics(y, thr, alert)})
            rows.append({"method": f"alert: P(Y>=q90) >= tuned", "horizon": h, "year": yr, "param": t_pois,
                         **_point_metrics(y, thr, poisson.median(np.maximum(mu, 1e-9))), **_alert_metrics(y, thr, p_ge >= t_pois)})
            for qname, qp in (quantiles or {}).items():
                Q = qp[(qp.horizon == h) & (qp.year == yr)].merge(O[KEY], on=KEY)
                pred = np.maximum(np.round(Q.q50.to_numpy()), 0)
                rows.append({"method": qname, "horizon": h, "year": yr, **_point_metrics(Q.y_true.to_numpy(float), thr, pred),
                             **_alert_metrics(Q.y_true.to_numpy(float), thr, pred >= thr)})
            if clf is not None:
                Ci = clf[(clf.horizon == h) & clf.year.isin(S.inner_seasons(yr))]
                Co = clf[(clf.horizon == h) & (clf.year == yr)]
                t_clf = _best_f1_threshold(Ci.p.to_numpy(), Ci.y_true.to_numpy(float), Ci.thr_q90.to_numpy(float))
                rows.append({"method": "severity classifier (tuned threshold)", "horizon": h, "year": yr, "param": t_clf,
                             **_alert_metrics(Co.y_true.to_numpy(float), float(Co.thr_q90.iloc[0]), Co.p.to_numpy() >= t_clf)})
    return pd.DataFrame(rows)
