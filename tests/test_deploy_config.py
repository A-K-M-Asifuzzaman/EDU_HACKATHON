"""Deploy configuration must not drift: Vercel installs from pyproject.toml, Docker/launch.sh from requirements.txt."""
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_pyproject_runtime_dependencies_equal_requirements_txt():
    reqs = sorted(l.strip() for l in (ROOT / "requirements.txt").read_text().splitlines() if l.strip() and not l.startswith("#"))
    deps = sorted(tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"])
    assert reqs and deps == reqs


def test_deploy_workflow_never_exposes_secrets_to_untrusted_runs():
    """CI runs on pull requests and `branches: [main]` matches a fork's branch name, so each deploy job must require a push event
    from this repository; secrets live only on the steps that use them; checkout keeps no credentials; no token on a command line."""
    import yaml
    d = yaml.safe_load((ROOT / ".github/workflows/deploy.yml").read_text())
    for name, job in d["jobs"].items():
        cond = " ".join(str(job["if"]).split())
        assert "workflow_run.event == 'push'" in cond and "head_repository.full_name == github.repository" in cond, name
        assert "secrets." not in str(job.get("env", "")), f"{name}: job-level secrets"
        for st in job["steps"]:
            if st.get("uses", "").startswith("actions/checkout"):
                assert st["with"].get("persist-credentials") is False, name
            assert "--token" not in st.get("run", ""), name
            if "pip install" in st.get("run", ""):
                assert "secrets." not in str(st.get("env", "")), "dependency install must not see secrets"


def test_space_deploy_refuses_secret_like_files():
    src = (ROOT / "scripts/deploy_space.py").read_text()
    assert '".env"' in src and "refusing to upload secret-like files" in src
