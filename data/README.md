# Data

The organizer dataset is **not committed** in Stage 1. Redistribution terms were not
stated in the brief, so the raw file is kept local until the team confirms it may be
published (see "Open decision" below).

## Placement

Download the organizer sheet as CSV (link in the hackathon brief) and save it, unmodified, as:

```
data/raw/bangladesh_dengue_large_dataset.csv
```

`dengueshield.data.load_panel()` refuses to load a file whose SHA-256 differs from the audited one:

| File | SHA-256 | Bytes | Rows |
|---|---|---|---|
| `bangladesh_dengue_large_dataset.csv` (original name: `hackathon_preli_dataset - bangladesh_dengue_large_dataset.csv`) | `a4088765084a0bcf37b86222e22f89d06ef92ad2ac68a40c8057a21e13703dd7` | 2,581,377 | 31,320 + header |

```bash
shasum -a 256 data/raw/bangladesh_dengue_large_dataset.csv
```

The organizer brief (PDF) is kept locally in `data/reference/` and is also not committed.

## Automatic download

`python scripts/fetch_data.py` (run by `./scripts/launch.sh`) downloads the CSV from the organizers' own shared sheet, verifies the
SHA-256 above and writes the file atomically; it refuses to save a file with a different checksum. If the download fails, save the
sheet manually as described under "Placement".

## Open decision

The repository still does not contain the CSV, because the brief does not state redistribution terms. The team must either confirm
that the organizers allow it (then commit the 2.6 MB file) or keep the fetch script. Judges need internet access for the first run
either way. The repository is private until that decision and the final submission step are made.

## Phase 2 onsite dataset

The onsite brief adds a 15-column dataset: the 12 Phase 1 columns, unchanged (verified value by value for 2016-2024 and byte by
byte for the 2025 block), plus three weekly resource-demand columns. `python scripts/fetch_data.py` downloads it from the organizers'
onsite sheet and verifies its checksum; save it unmodified as:

```
data/raw/onsite/bangladesh_dengue_large_dataset_onsite.csv
```

| File | SHA-256 | Bytes | Rows |
|---|---|---|---|
| `onsite/bangladesh_dengue_large_dataset_onsite.csv` (original name: `bangladesh_dengue_large_dataset_onsite - bangladesh_dengue_large_dataset.csv`) | `3500fb22fc19afde9b242449f08e441eb88e62a8985411f54e915f6582daf7e4` | 2,781,040 | 31,320 + header |

Development code reads it only through `dengueshield.onsite_data.load_onsite_development_panel()`, which drops the sealed 2025 rows
before parsing. Integrity tests: `tests/test_onsite_dataset.py`; audit: `notebooks/09_onsite_dataset_and_resource_audit.ipynb`.
