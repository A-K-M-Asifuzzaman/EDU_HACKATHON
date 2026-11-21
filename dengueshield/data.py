"""Loading and hard integrity guards for the organizer dataset.

The raw CSV is never modified. Every downstream module loads it through
`load_panel`, which fails loudly if the file or its panel structure differs
from what the research was validated against.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "data" / "raw" / "bangladesh_dengue_large_dataset.csv"
EXPECTED_SHA256 = "a4088765084a0bcf37b86222e22f89d06ef92ad2ac68a40c8057a21e13703dd7"

COLUMNS = [
    "date", "city", "ward_id",
    "population_density_sqkm", "water_logging_risk_index", "sanitation_score",
    "avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm", "relative_humidity_pct",
    "dengue_cases",
]
STATIC = ["city", "population_density_sqkm", "water_logging_risk_index", "sanitation_score"]
WEATHER = ["avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm", "relative_humidity_pct"]
TARGET = "dengue_cases"
WEEK = pd.Timedelta(weeks=1)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def assert_regular_panel(df: pd.DataFrame) -> None:
    """Every ward must have the same consecutive weekly dates, once each.

    Positional groupby shifts are only equivalent to calendar lags when this holds.
    """
    if df.duplicated(["ward_id", "date"]).any():
        raise ValueError("duplicate (ward_id, date) rows")
    steps = df.sort_values(["ward_id", "date"]).groupby("ward_id")["date"].diff().dropna()
    if not (steps == WEEK).all():
        raise ValueError("non-weekly step inside a ward series")
    per_ward = df.groupby("ward_id")["date"].agg(["min", "max", "size"])
    if per_ward.nunique().max() != 1:
        raise ValueError("wards cover different date ranges")
    if (df.groupby("ward_id")[STATIC].nunique() != 1).any().any():
        raise ValueError("a static ward attribute varies over time")


def load_panel(path: Path = RAW_PATH, verify_checksum: bool = True) -> pd.DataFrame:
    """Load the raw CSV as a ward x week panel sorted by (ward_id, date)."""
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; see data/README.md for placement")
    if verify_checksum and sha256(path) != EXPECTED_SHA256:
        raise ValueError(f"{path} checksum differs from the audited file")
    df = pd.read_csv(path)
    if list(df.columns) != COLUMNS:
        raise ValueError(f"unexpected columns: {list(df.columns)}")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    df = df.sort_values(["ward_id", "date"], ignore_index=True)
    assert_regular_panel(df)
    return df


DEV_LAST_YEAR = 2024  # Stage 2+ development window; 2025 is the locked test year


def load_development_panel(path: Path = RAW_PATH) -> pd.DataFrame:
    """Panel restricted to 2016-2024. Rows after 2024 are dropped immediately and never analysed.

    Use this in every development/tuning workflow. The locked 2025 test year is only
    read by the final one-shot evaluation, which must call `load_panel` explicitly.
    """
    df = load_panel(path)
    df = df[df["date"].dt.year <= DEV_LAST_YEAR].reset_index(drop=True)
    assert df["date"].max() < pd.Timestamp(f"{DEV_LAST_YEAR + 1}-01-01")
    return df
