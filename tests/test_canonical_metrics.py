"""The canonical metrics file is the single source for reported model metrics (V3)."""
import importlib.util
import json
from pathlib import Path

from fastapi.testclient import TestClient

from dengueshield.api.main import app

ROOT = Path(__file__).resolve().parents[1]


def _builder():
    spec = importlib.util.spec_from_file_location("bcm", ROOT / "scripts" / "build_canonical_metrics.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def test_shipped_file_matches_a_fresh_recomputation_from_the_replay_table():
    shipped = json.loads((ROOT / "app_data" / "metrics_canonical.json").read_text())
    assert shipped == json.loads(json.dumps(_builder().build()))


def test_regimes_are_labelled_honestly_and_2025_is_sealed():
    d = _builder().build()
    assert "Not a blind test" in d["regimes"]["selection_window_2022_2024"]["label"]
    assert d["blind_test_2025"] == {**d["blind_test_2025"], "status": "sealed", "evaluated": False}
    assert max(d["source"]["seasons"]) == 2024


def test_pooled_and_legacy_peak_figures_reconcile_the_documents():
    d = _builder().build()
    leg = d["legacy_cell_mean"]
    assert (leg["cov80_peaks"], leg["cov90_peaks"]) == (0.607, 0.74)          # the figures earlier documents quoted
    pooled = d["regimes"]["out_of_time_2019_2024"]["pooled_all_horizons"]
    assert pooled["coverage"]["peaks"]["80"] < leg["cov80_peaks"]              # pooled is worse; both are reported
    for h in ("2", "3", "4"):
        b = d["regimes"]["out_of_time_2019_2024"]["by_horizon"][h]
        assert b["coverage"]["peaks"]["80"] < b["coverage"]["positive_below_peak"]["80"] < b["coverage"]["zero_weeks"]["80"]


def test_api_serves_the_canonical_file():
    j = TestClient(app).get("/api/model/canonical-metrics").json()
    assert j["schema"] == "dengueshield.metrics/1" and "out_of_time_2019_2024" in j["regimes"]
