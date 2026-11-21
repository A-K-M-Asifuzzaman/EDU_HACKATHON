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

## Open decision

The judging rubric requires a clone-and-launch in three minutes or less. If the team confirms
that the organizer CSV may be redistributed, commit it (2.6 MB) before the final submission;
otherwise the README must instruct judges to download it.
