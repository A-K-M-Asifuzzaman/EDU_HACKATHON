"""Offline readiness check: every file and module the offline launch needs. Exit 0 when complete, 3 with a list of what is missing.

    python scripts/offline_check.py            # checksums verified
    python scripts/offline_check.py --fast     # existence only
    python scripts/offline_check.py --root DIR # check another installation
Nothing is downloaded or created here: a missing artifact is reported with the command that restores it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dengueshield.offline import check_artifacts, external_assets  # noqa: E402

FIX = {"data/": "python scripts/fetch_data.py (online, once)", "frontend/out": "cd frontend && npm ci && npm run build (online, once)",
       "python module": "python -m pip install -r requirements.txt (online, once)"}


def main() -> int:
    root = Path(sys.argv[sys.argv.index("--root") + 1]).resolve() if "--root" in sys.argv else Path(__file__).resolve().parents[1]
    rows = check_artifacts(root, verify_checksums="--fast" not in sys.argv)
    bad = [r for r in rows if not r["ok"]]
    ext = external_assets(root / "frontend" / "out") if (root / "frontend" / "out").exists() else []
    for r in rows:
        print(f"  {'ok ' if r['ok'] else 'MISSING'}  {r['path']}  ({r['purpose']}){'' if r['ok'] else ': ' + r['problem']}")
    for e in ext:
        print(f"  EXTERNAL  frontend/out/{e} loads an asset from another host")
    if bad or ext:
        print("\nNot ready for offline use. To restore:")
        for key, fix in FIX.items():
            if any(r["path"].startswith(key) for r in bad):
                print(f"  {fix}")
        if any(not r["path"].startswith(tuple(FIX)) for r in bad):
            print("  models/ and app_data/ are part of the repository: restore them with git checkout")
        return 3
    print(f"\nReady for offline use: {len(rows)} artifacts and modules present, no external assets in the dashboard.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
