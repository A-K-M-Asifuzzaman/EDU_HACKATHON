# DengueShield AI

Ward-level dengue forecasting for Bangladesh city corporations, built for the
EDU AI Engineering Hackathon 2026 (preliminary round). Goal: forecast weekly
dengue cases and outbreak risk tiers 2, 3 and 4 weeks ahead for each of 60 wards,
using only information available at the forecast origin.

## Status

**Stage 1 (complete): forensic data audit, EDA, leak-safe validation design, baselines.**
No forecasting app or UI yet; those arrive in later stages.

| Output | Location |
|---|---|
| Data integrity audit | `notebooks/01_data_audit.ipynb`, `docs/data_audit.md`, `reports/audit/` |
| Exploratory analysis | `notebooks/02_eda.ipynb`, `reports/eda/` |
| Validation and baselines | `notebooks/03_validation_and_baselines.ipynb`, `reports/baselines/` |
| Validation protocol | `docs/validation_protocol.md` |
| Feature research plan | `docs/feature_research_plan.md` |
| Leak-critical library code | `dengueshield/` (data loading, folds, metrics, baselines) |
| Leakage and alignment tests | `tests/test_temporal_invariants.py` |

## Setup (Python 3.12)

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# place the organizer CSV first: see data/README.md
```

## Reproduce Stage 1

```bash
pytest                                   # invariants (run without the raw CSV too)
jupyter nbconvert --to notebook --execute --inplace notebooks/01_data_audit.ipynb
jupyter nbconvert --to notebook --execute --inplace notebooks/02_eda.ipynb
jupyter nbconvert --to notebook --execute --inplace notebooks/03_validation_and_baselines.ipynb
```

Every notebook is deterministic and finishes in seconds on a laptop CPU.

## AI assistants and external APIs (disclosure)

The competition requires listing all AI assistants and external APIs.

| Tool | Provider | Used for |
|---|---|---|
| Claude Code (model: Claude Opus 5.5) | Anthropic | Stage 1 code, analysis notebooks, tests and documentation, under the team's direction and review |

- **External APIs at runtime:** none. All analysis runs locally on the organizer CSV.
- **Package downloads:** Python packages from PyPI (see `requirements.txt`).
- Team members must add any other AI assistant or external API they use to this table.
