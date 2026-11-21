"""Loading and hard integrity guards for the organizer dataset.

The raw CSV is never modified. Both loaders verify the audited file and check
the structure of the panel they return.
"""
from __future__ import annotations

import hashlib
import io
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


def _verify_file(path: Path, verify_checksum: bool = True) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; see data/README.md for placement")
    if verify_checksum and sha256(path) != EXPECTED_SHA256:
        raise ValueError(f"{path} checksum differs from the audited file")


def _validate_panel(df: pd.DataFrame) -> pd.DataFrame:
    if list(df.columns) != COLUMNS:
        raise ValueError(f"unexpected columns: {list(df.columns)}")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    df = df.sort_values(["ward_id", "date"], ignore_index=True)
    assert_regular_panel(df)
    return df


def load_panel(path: Path = RAW_PATH, verify_checksum: bool = True) -> pd.DataFrame:
    """Load the raw CSV as a ward x week panel sorted by (ward_id, date)."""
    _verify_file(path, verify_checksum)
    return _validate_panel(pd.read_csv(path))


DEV_LAST_YEAR = 2024  # Stage 2+ development window; 2025 is the locked test year


def load_development_panel(path: Path = RAW_PATH) -> pd.DataFrame:
    """Parse only development rows, leaving the locked test year outside the panel.

    Use this in every development/tuning workflow. The locked 2025 test year is only
    read by the final one-shot evaluation, which must call `load_panel` explicitly.
    """
    _verify_file(path)
    cutoff = f"{DEV_LAST_YEAR + 1}-01-01".encode("ascii")
    with path.open("rb") as raw:
        # The checksum guarantees the organizer's unquoted ISO date in column one.
        development = io.BytesIO(raw.readline() + b"".join(row for row in raw if row.split(b",", 1)[0] < cutoff))
    return _validate_panel(pd.read_csv(development))
