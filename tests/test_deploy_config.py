"""Deploy configuration must not drift: Vercel installs from pyproject.toml, Docker/launch.sh from requirements.txt."""
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_pyproject_runtime_dependencies_equal_requirements_txt():
    reqs = sorted(l.strip() for l in (ROOT / "requirements.txt").read_text().splitlines() if l.strip() and not l.startswith("#"))
    deps = sorted(tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"])
    assert reqs and deps == reqs
