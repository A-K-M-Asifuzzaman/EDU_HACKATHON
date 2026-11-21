#!/usr/bin/env python3
"""Download the organizer dataset from the organizers' own shared sheet (link in the hackathon brief) and verify its SHA-256.

The dataset is not redistributed in this repository. Usage:  python scripts/fetch_data.py
Standard library only. The file is written atomically and only if the checksum matches the audited file.
"""
import hashlib
import os
import sys
import urllib.request

SHEET = "1QFI0ACJRvJQkiQT3LfGHklM3g4PgaJWUt8xSVU07NIE"
URL = f"https://docs.google.com/spreadsheets/d/{SHEET}/export?format=csv"
SHA256 = "a4088765084a0bcf37b86222e22f89d06ef92ad2ac68a40c8057a21e13703dd7"
DEST = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "bangladesh_dengue_large_dataset.csv")


def main() -> int:
    dest = os.path.abspath(DEST)
    if os.path.exists(dest) and hashlib.sha256(open(dest, "rb").read()).hexdigest() == SHA256:
        print("dataset already present and verified:", dest)
        return 0
    print("downloading the organizer dataset ...")
    try:
        with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "dengueshield-fetch"}), timeout=60) as r:
            data = r.read()
    except Exception as e:
        print(f"download failed ({e}).\nDownload the sheet as CSV manually from the link in the brief and save it as:\n  {dest}", file=sys.stderr)
        return 1
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        print(f"checksum mismatch: got {digest}\nexpected {SHA256}\nRefusing to write a file that differs from the audited dataset.", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    open(tmp, "wb").write(data)
    os.replace(tmp, dest)
    print("saved and verified:", dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
