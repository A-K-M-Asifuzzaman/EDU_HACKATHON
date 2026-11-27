"""Phase 2 onsite dataset: integrity, equivalence with the Phase 1 forecasting inputs, the sealed 2025 year, and the resource rule.

Value-level checks use development rows (2016-2024) only, through `load_onsite_development_panel()`. The sealed 2025 block is
checked as bytes (row, field and key counts, checksum of the forecasting columns) and never parsed into numbers.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

import numpy as np
import pytest

from dengueshield.data import COLUMNS, RAW_PATH, ROOT, load_development_panel, sha256
from dengueshield.onsite_data import (ONSITE_COLUMNS, ONSITE_PATH, ONSITE_SHA256, RESOURCES, forecast_view,
                                      load_onsite_development_panel)

CITY_WARDS = {"Chattogram": 10, "Dhaka North": 20, "Dhaka South": 20, "Gazipur": 5, "Narayanganj": 5}
PREFIX = {"Chattogram": "CCC", "Dhaka North": "DNCC", "Dhaka South": "DSCC", "Gazipur": "GCC", "Narayanganj": "NCC"}


@pytest.fixture(scope="module")
def dev():
    return load_onsite_development_panel()


def _lines(path):
    raw = path.read_bytes()
    return [l.rstrip(b"\r") for l in raw.split(b"\n")]


def _sealed(path):
    return [l for l in _lines(path)[1:] if l.strip() and l.split(b",", 1)[0] >= b"2025-01-01"]


def test_file_is_the_audited_onsite_dataset():
    assert ONSITE_PATH.exists(), "run scripts/fetch_data.py (downloads and verifies the onsite sheet)"
    assert sha256(ONSITE_PATH) == ONSITE_SHA256
    lines = [l for l in _lines(ONSITE_PATH) if l.strip()]
    assert lines[0].decode().split(",") == ONSITE_COLUMNS                       # 15 columns, Phase 1 order first
    assert ONSITE_COLUMNS[:12] == COLUMNS and len(ONSITE_COLUMNS) == 15
    assert len(lines) - 1 == 31_320                                               # 60 wards x 522 weeks


def test_development_panel_is_complete_and_regular(dev):
    assert dev.shape == (28_200, 15)                                              # 60 wards x 470 weeks, 2016-2024
    assert str(dev.date.min().date()) == "2016-01-04" and str(dev.date.max().date()) == "2024-12-30"
    assert (dev.date.dt.dayofweek == 0).all()                                     # weekly, Mondays (regularity checked on load)
    assert dev.isna().sum().sum() == 0 and not dev.duplicated().any() and not dev.duplicated(["ward_id", "date"]).any()
    assert dev.groupby("city").ward_id.nunique().to_dict() == CITY_WARDS
    assert (dev.groupby("ward_id").size() == 470).all()
    for city, prefix in PREFIX.items():
        assert dev.loc[dev.city == city, "ward_id"].str.startswith(prefix + "_Ward_").all()


def test_value_ranges_are_valid(dev):
    counts = ["dengue_cases", *RESOURCES, "population_density_sqkm"]
    assert (dev[counts] >= 0).all().all() and all(dev[c].dtype.kind == "i" for c in counts)
    assert dev.water_logging_risk_index.between(0, 1).all() and dev.sanitation_score.between(0, 1).all()
    assert dev.relative_humidity_pct.between(0, 100).all() and (dev.rainfall_mm >= 0).all()
    assert ((dev.min_temp_c <= dev.avg_temp_c) & (dev.avg_temp_c <= dev.max_temp_c)).all()


def test_forecasting_inputs_are_identical_to_phase_1(dev):
    """The champion bundle's inputs are unchanged, so Phase 1 models, replay and validation stay valid without retraining."""
    a, b = forecast_view(dev).reset_index(drop=True), load_development_panel().reset_index(drop=True)
    assert list(a.columns) == COLUMNS
    for c in COLUMNS:
        assert a[c].equals(b[c]), c


def test_sealed_2025_block_is_structurally_complete_and_unchanged_without_being_parsed():
    sealed = _sealed(ONSITE_PATH)
    assert len(sealed) == 3_120                                                   # 60 wards x 52 weeks
    assert {len(l.split(b",")) for l in sealed} == {15}
    assert not [l for l in sealed if b",," in l or l.endswith(b",")]
    keys = [tuple(l.split(b",")[:3]) for l in sealed]
    assert len(set(keys)) == len(keys) and len({k[0] for k in keys}) == 52 and len({k[2] for k in keys}) == 60
    digest = lambda ls: hashlib.sha256(b"\n".join(b",".join(l.split(b",")[:12]) for l in ls)).hexdigest()
    assert digest(sealed) == digest(_sealed(RAW_PATH))                           # same 12 forecasting columns as Phase 1


def test_development_loader_never_yields_the_sealed_year(dev):
    assert dev.date.dt.year.max() == 2024
    src = (ROOT / "dengueshield" / "onsite_data.py").read_text()
    assert not re.search(r"(?<!development_)load_panel\(", src) and "TEST_YEAR" not in src


def test_resources_are_a_function_of_same_week_cases(dev):
    assert (dev.groupby("dengue_cases")[RESOURCES].nunique() == 1).all().all()
    assert (dev.loc[dev.dengue_cases == 0, RESOURCES] == 0).all().all()


def test_identified_resource_rule_reproduces_every_development_row(dev):
    """The audited rule (notebooks/09) is floor(multiplier * cases + 0.5); its saved multipliers reproduce all 28,200 rows,
    and the rule identified on 2016-2018 alone reproduces 2019-2024, so applying it to forecasts uses no future information."""
    rule = json.loads((ROOT / "reports" / "onsite" / "resource_rule_identification.json").read_text())
    assert rule["dataset"]["sha256"] == ONSITE_SHA256
    for r in RESOURCES:
        v = rule["resources"][r]
        lo, hi = v["feasible_interval"]
        assert lo <= v["multiplier"] < hi
        pred = np.floor(dev.dengue_cases.to_numpy() * v["multiplier"] + 0.5).astype(int)
        assert (pred == dev[r].to_numpy()).all(), r
        assert v["reproduction_rate"] == 1.0 and v["reproduction_2019_2024_from_2016_2018_rule"] == 1.0


def test_replay_evaluation_is_saved_for_every_resource_and_horizon():
    ev = json.loads((ROOT / "reports" / "onsite" / "resource_rule_identification.json").read_text())["replay_evaluation_2019_2024"]
    assert {(e["resource"], e["horizon"]) for e in ev} == {(r, h) for r in RESOURCES for h in (2, 3, 4)}
    for e in ev:
        assert e["80% range held"] >= e["cases: 80% range held"] - 1e-9            # a monotone map cannot lose a covered week
        assert math.isfinite(e["MAE"]) and e["ward-weeks"] > 17_000
