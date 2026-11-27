"""Phase 2 onsite dataset (15 columns): loading, integrity guards and the sealed 2025 year.

The onsite CSV repeats the 12 Phase 1 forecasting columns unchanged (verified value by value for 2016-2024 and byte by byte for
2025 in tests/test_onsite_dataset.py) and adds three weekly resource-demand columns. Development code reads it only through
`load_onsite_development_panel()`, which drops 2025 rows before parsing, exactly as `dengueshield.data.load_development_panel()`
does for the Phase 1 file. The raw file is never modified.
"""
from __future__ import annotations

import io
from pathlib import Path

import pandas as pd

from .data import COLUMNS, DEV_LAST_YEAR, ROOT, assert_regular_panel, sha256

ONSITE_PATH = ROOT / "data" / "raw" / "onsite" / "bangladesh_dengue_large_dataset_onsite.csv"
ONSITE_SHA256 = "3500fb22fc19afde9b242449f08e441eb88e62a8985411f54e915f6582daf7e4"
RESOURCES = ["saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required"]
ONSITE_COLUMNS = COLUMNS + RESOURCES


def _verify_onsite_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; run scripts/fetch_data.py or see data/README.md")
    if sha256(path) != ONSITE_SHA256:
        raise ValueError(f"{path} checksum differs from the audited onsite file")


def load_onsite_development_panel(path: Path = ONSITE_PATH) -> pd.DataFrame:
    """Parse only development rows (2016-2024); the sealed 2025 rows are filtered out as bytes, before any value is parsed."""
    _verify_onsite_file(path)
    cutoff = f"{DEV_LAST_YEAR + 1}-01-01".encode("ascii")
    with path.open("rb") as raw:
        # The checksum guarantees the organizer's unquoted ISO date in column one.
        development = io.BytesIO(raw.readline() + b"".join(row for row in raw if row.split(b",", 1)[0] < cutoff))
    df = pd.read_csv(development)
    if list(df.columns) != ONSITE_COLUMNS:
        raise ValueError(f"unexpected columns: {list(df.columns)}")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d")
    df = df.sort_values(["ward_id", "date"], ignore_index=True)
    assert_regular_panel(df)
    return df


def forecast_view(df: pd.DataFrame) -> pd.DataFrame:
    """The Phase 1 forecaster's input schema (12 columns, same order): resource columns are never forecast inputs."""
    return df[COLUMNS].copy()
