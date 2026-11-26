"""Rainfall what-if (V3): re-run the SAVED model with hypothetical rainfall inputs. Never multiplies case counts.

Two modes, both under the deployed start-of-week convention (weather is known up to one week before the origin):

- "observed": scale the city's last TWO observed rainfall weeks. Those are the only observed weeks the 24 deployed features read
  (at a 2-week horizon: the aligned rain at target−3/−4 and the rain window; at 3 weeks: target−4 and the window; at 4 weeks only the
  recent-anomaly term), so scaling older weeks would change nothing.
- "upcoming": scale the climatology projection used for rainfall weeks that are not yet observed (what if the coming weeks are wetter or
  drier than typical). This is the forward-looking question and is the one that matters at 3–4 weeks.

The response reports which model inputs changed, flags inputs pushed beyond the model's training clip (where the response is capped), and
recomputes intervals and outbreak probability from the same model. Results are hypothetical model responses on synthetic data: not causal
effects and not weather forecasts. Prototype credit: the 2026-11-24 uncommitted rainfall what-if (see EDU_HACKATHON_V3_prep/preserved/).
"""
from __future__ import annotations

import copy

import numpy as np
import pandas as pd

from dengueshield.api.store import records

WEEK = pd.Timedelta(weeks=1)
MODES = ("observed", "upcoming")
LIMIT_PCT = 30


def _features(bundle, panel, origin, horizon, ward, pipeline=None):
    pipe = pipeline or bundle.pipeline
    fm = pipe.transform(panel, horizon, origins=[pd.Timestamp(origin)])
    cols = bundle.horizons[horizon].cols
    row = fm.X.loc[(fm.meta.ward_id == ward).to_numpy(), cols]
    return row.iloc[0] if len(row) else None


def _clip_bounds(bundle, horizon):
    """(lo, hi) winsorisation bounds of the deployed GLM per feature, if the model exposes them."""
    m = bundle.horizons[horizon].model
    st = getattr(m, "st", None) or getattr(getattr(m, "glm", None), "st", None)
    if not st or len(st) < 3:
        return None
    cols = bundle.horizons[horizon].cols
    return {c: (float(lo), float(hi)) for c, lo, hi in zip(cols, st[1], st[2])}


def rainfall_what_if(bundle, panel: pd.DataFrame, origin: str, horizon: int, ward: str, city: str, change_pct: int, mode: str = "observed") -> dict:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if abs(change_pct) > LIMIT_PCT:
        raise ValueError(f"change_pct must be within ±{LIMIT_PCT}")
    origin_ts = pd.Timestamp(origin)
    wlag = int(bundle.convention["wlag"])
    last_obs = origin_ts - wlag * WEEK
    base_panel = panel.loc[panel.date <= last_obs].copy()           # nothing after the last observed week is ever used
    factor = 1 + change_pct / 100.0
    scen_panel, pipe, weeks = base_panel, bundle.pipeline, []
    if mode == "observed":
        first = last_obs - WEEK
        sel = (scen_panel.city == city) & scen_panel.date.between(first, last_obs)
        scen_panel = scen_panel.copy()
        scen_panel.loc[sel, "rainfall_mm"] *= factor
        weeks = [first.date().isoformat(), last_obs.date().isoformat()]
    else:
        pipe = copy.copy(bundle.pipeline)
        pipe.proj_scale = factor
        weeks = [(origin_ts + i * WEEK).date().isoformat() for i in range(horizon)]     # projected weeks up to the target window

    base = records(bundle.predict(base_panel, origin_ts, horizon, wards=[ward]))[0]
    if mode == "upcoming":
        scen_bundle = copy.copy(bundle)                              # shallow copy: the shared bundle is never mutated (concurrent requests)
        scen_bundle.pipeline = pipe
        scen = records(scen_bundle.predict(scen_panel, origin_ts, horizon, wards=[ward]))[0]
    else:
        scen = records(bundle.predict(scen_panel, origin_ts, horizon, wards=[ward]))[0]

    fb = _features(bundle, base_panel, origin_ts, horizon, ward)
    fs = _features(bundle, scen_panel, origin_ts, horizon, ward, pipe)
    bounds = _clip_bounds(bundle, horizon)
    changed = []
    if fb is not None and fs is not None:
        for c in fb.index:
            a, b = float(fb[c]), float(fs[c])
            if not (np.isclose(a, b, rtol=1e-9, atol=1e-9) or (np.isnan(a) and np.isnan(b))):
                lo, hi = bounds.get(c, (None, None)) if bounds else (None, None)
                clipped = bool(lo is not None and (b > hi or b < lo))
                changed.append({"feature": c, "baseline": round(a, 4), "scenario": round(b, 4), "clipped_by_model": clipped})
    return {"mode": mode, "change_pct": change_pct, "weeks_changed": weeks, "city": city, "baseline": base, "scenario": scen,
            "changed_inputs": changed, "any_clipped": any(x["clipped_by_model"] for x in changed),
            "no_effect": not changed,
            "note": ("Hypothetical model response on synthetic data: the saved model is re-run with modified rainfall inputs. "
                     "Not a causal effect and not a weather forecast. Intervals come from the same model; their coverage under edited weather is unverified.")}
