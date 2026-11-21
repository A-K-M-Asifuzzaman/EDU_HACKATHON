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
