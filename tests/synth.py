"""Synthetic ward x week panel shaped like the organizer data (2016-2025, Mondays), for tests that need no raw file."""
import numpy as np
import pandas as pd

from dengueshield.data import COLUMNS


def synthetic_panel(seed=0, wards=(("A_1", "X"), ("A_2", "X"), ("B_1", "Y")), end="2024-12-30"):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2016-01-04", end, freq="7D")
    wk = dates.isocalendar().week.to_numpy().astype(float)
    wet = (wk >= 20) & (wk <= 39)
    parts = []
    for i, (w, c) in enumerate(wards):
        n = len(dates)
        rain = np.where(wet, rng.gamma(2, 45, n), rng.gamma(1, 3, n))
        parts.append(pd.DataFrame({
            "date": dates, "city": c, "ward_id": w, "population_density_sqkm": 30000 + 5000 * i,
            "water_logging_risk_index": 0.3 + 0.2 * i, "sanitation_score": 0.4 + 0.1 * i,
            "avg_temp_c": 27 + 5 * np.sin(2 * np.pi * (wk - 12) / 52) + rng.normal(0, 1, n),
            "max_temp_c": 0.0, "min_temp_c": 0.0, "rainfall_mm": rain,
            "relative_humidity_pct": np.clip(60 + 25 * wet + rng.normal(0, 5, n), 40, 99),
            "dengue_cases": rng.poisson(np.where(wet, 3 + 4 * i, 0.2), n)}))
    df = pd.concat(parts, ignore_index=True)[COLUMNS]
    df["max_temp_c"], df["min_temp_c"] = df.avg_temp_c + 5, df.avg_temp_c - 5
    return df.sort_values(["ward_id", "date"], ignore_index=True)


def corrupt_future(panel, origin, wlag, clag, weather_value=1e4, case_value=999):
    """Make everything not yet observable at `origin` extreme: weather rows dated after origin - wlag, cases after origin - clag."""
    p = panel.copy()
    o = pd.Timestamp(origin)
    wmask = p["date"] > o - pd.Timedelta(weeks=wlag)
    cmask = p["date"] > o - pd.Timedelta(weeks=clag)
    for c in ["avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm", "relative_humidity_pct"]:
        p.loc[wmask, c] = weather_value
    p.loc[cmask, "dengue_cases"] = case_value
    return p
