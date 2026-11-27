#!/usr/bin/env python3
"""Download the organizer datasets from the organizers' own shared sheets (links in the hackathon briefs) and verify their SHA-256.

Phase 1: the 12-column dataset. Phase 2 (onsite): the 15-column dataset, which repeats the Phase 1 columns unchanged and adds
three weekly resource-demand columns. Neither is redistributed in this repository. Usage:  python scripts/fetch_data.py
Standard library only. Each file is written atomically and only if its checksum matches the audited file; a file that is already
present and verified is not downloaded again, so the script makes no network request when both files are in place (offline use).
"""
import hashlib
import os
import sys
import urllib.request

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
DATASETS = [
    ("Phase 1 organizer dataset", "1QFI0ACJRvJQkiQT3LfGHklM3g4PgaJWUt8xSVU07NIE",
     "a4088765084a0bcf37b86222e22f89d06ef92ad2ac68a40c8057a21e13703dd7", os.path.join(RAW, "bangladesh_dengue_large_dataset.csv")),
    ("Phase 2 onsite dataset", "1wAazQIRO-rzkrrlgD3YPcyyAPjMc1dN2pbr5rozA8BU",
     "3500fb22fc19afde9b242449f08e441eb88e62a8985411f54e915f6582daf7e4", os.path.join(RAW, "onsite", "bangladesh_dengue_large_dataset_onsite.csv")),
]


def fetch(name: str, sheet: str, sha: str, dest: str) -> int:
    dest = os.path.abspath(dest)
    if os.path.exists(dest) and hashlib.sha256(open(dest, "rb").read()).hexdigest() == sha:
        print(f"{name}: already present and verified: {dest}")
        return 0
    print(f"{name}: downloading ...")
    url = f"https://docs.google.com/spreadsheets/d/{sheet}/export?format=csv"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "dengueshield-fetch"}), timeout=60) as r:
            data = r.read()
    except Exception as e:
        print(f"{name}: download failed ({e}).\nDownload the sheet as CSV manually from the link in the brief and save it as:\n  {dest}", file=sys.stderr)
        return 1
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha:
        print(f"{name}: checksum mismatch: got {digest}\nexpected {sha}\nRefusing to write a file that differs from the audited dataset.", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    open(tmp, "wb").write(data)
    os.replace(tmp, dest)
    print(f"{name}: saved and verified: {dest}")
    return 0


def main() -> int:
    return max(fetch(*d) for d in DATASETS)


if __name__ == "__main__":
    sys.exit(main())
