#!/usr/bin/env python3
"""Deploy the DengueShield backend to a Hugging Face Space (Docker SDK) as ONE commit on top of the Space's history.

    python scripts/deploy_space.py AsifZaman1912/dengueshield-ai-api     # needs `hf auth login` with a write token

Stages only what the backend image needs, adds the Space README front matter, and uploads with upload_folder (replaces files in a single
commit; earlier commits stay in the Space's git history). Secrets (OPENAI_API_KEY, ACCESS_PASSWORD) are set in the Space settings, never in git.
"""
import shutil, sys, tempfile
from pathlib import Path
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ["pyproject.toml", "requirements.txt", "ARCHITECTURE.md", "dengueshield", "models", "app_data", "scripts", "docs",
           "data/README.md", "reports/eda/README.md", "reports/baselines/README.md"]
FRONT = "---\ntitle: DengueShield AI API\nemoji: 🦟\ncolorFrom: green\ncolorTo: blue\nsdk: docker\napp_port: 7860\npinned: false\nlicense: other\nshort_description: Ward-level dengue forecasting API (EDU AI Hackathon 2026)\n---\n\n"

def main(repo_id: str) -> None:
    stage = Path(tempfile.mkdtemp(prefix="space_stage_"))
    try:
        for rel in INCLUDE:
            src, dst = ROOT / rel, stage / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store", "screenshots")) if src.is_dir() else shutil.copy2(src, dst)
        shutil.copy2(ROOT / "Dockerfile.backend", stage / "Dockerfile")
        (stage / "README.md").write_text(FRONT + (ROOT / "README.md").read_text())
        api = HfApi()
        api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
        print("committed:", api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(stage), delete_patterns=["*"],
                                              commit_message="Deploy DengueShield AI backend (Docker, FastAPI)").commit_url)
    finally:
        shutil.rmtree(stage, ignore_errors=True)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "AsifZaman1912/dengueshield-ai-api")
