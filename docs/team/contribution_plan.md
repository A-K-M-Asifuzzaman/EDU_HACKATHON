# Team contribution audit, responsibility matrix and workflow

Prepared 22 Nov 2026 for the EDU AI Engineering Hackathon 2026 preliminary round. Every statement below is backed by repository evidence or is
explicitly marked as *proposed*. Percentages are **responsibility targets for remaining work**, not measurements of work already done.

## 1. Audit of the existing history (evidence)

| Fact | Evidence (checked 22 Nov 2026) |
|---|---|
| 43 commits on `main`, one branch, no pull requests | `git log`, `git branch -a`, `gh pr list` |
| All 43 commits have one author and one committer: `Asif Zman <138548302+…@users.noreply.github.com>` | `git log --format='%an <%ae> %cn <%ce>'` |
| That address resolves to GitHub account **A-K-M-Asifuzzaman** (the number is the account ID, 138548302; `asif4762` is the account's former username) | `gh api users/A-K-M-Asifuzzaman`; GitHub's Contributors API lists exactly one contributor, A-K-M-Asifuzzaman, with 43 commits |
| No commit carries a `Co-authored-by` trailer or names an AI tool as author/committer | `git log --format=%B` scan |
| `Umair505` and `mdjameee400` are repository collaborators with *write* access, but have **no commits, branches or pull requests** | `gh api …/collaborators`, `git log --all` |
| No file or commit in the repository records their work | `git grep` for their names/emails: no results |

**Conclusion.** The repository evidence attributes all existing code, tests, documentation and deployment configuration to A-K-M-Asifuzzaman's
account. Existing commits were **not** altered, re-authored or split: doing so would fabricate authorship and would require rewriting published history.
If the teammates contributed in ways git does not show (design discussions, manual testing, reviews), the right fix is to record that evidence in
`CONTRIBUTORS.md` with links (issue comments, review comments, screenshots), not to change who authored commits.

Development was assisted by Claude Code under the lead's direction; this is disclosed in `README.md` ("AI assistants and external APIs") and is not
represented as human authorship.

## 2. Proposed responsibility matrix (forward-looking)

| Area | A-K-M-Asifuzzaman (target ≈ 60%) | Umair505 (target ≈ 20%) | mdjameee400 (target ≈ 20%) |
|---|---|---|---|
| Forecasting model, validation, calibration, inference bundle | **owner** | review only | read-only review |
| Backend API, routing, decision tools, architecture docs | **owner** | review | review |
| Deployment, release, security, Git release steps | **owner** | – | – |
| Bangla localisation of safety-critical UI | reviewer | **owner** (tasks U1, U2) | – |
| Mobile and cross-device QA | reviewer | **owner** (task U3) | – |
| Independent reproducibility verification | – | – | **owner** (task J1) |
| Data provenance spot-checks (OpenStreetMap facilities) | reviewer | – | **owner** (task J2) |
| Demo video and presentation readiness | script author | review | **owner** (task J3) |

The 60/20/20 split is a plan for who is *responsible* for what from now on. It is not applied to past commits and no commit will be created to reach a number.

## 3. Remaining tasks that teammates can genuinely complete

Rules: one feature branch per task, a pull request per branch, commits made by the teammate from **their own GitHub account**, reviewed by the lead
before merge. None of these touch the forecasting model, the 2025 holdout, or the deployment configuration. Time budget: pull request opened by
**09:00**, merged by **10:30** on 22 Nov (release freeze at noon, submission deadline 14:00 Asia/Dhaka). Anything not merged by 10:30 does not block the release.

### Umair505

| ID | Task | Branch | Done when |
|---|---|---|---|
| U1 | Bangla for the **Emergency help** panel and the **intro** text (`frontend/components/emergency.tsx`, `intro.tsx`): move the English strings into `frontend/lib/i18n.tsx` keys with Bangla translations, using the existing `t()` pattern | `feat/bn-emergency-intro` | `npm run build` passes; with Bangla selected the panel shows Bangla; one Playwright test added in `frontend/tests/e2e/app.spec.ts` |
| U2 | Review the Bangla text already in the app (navigation, Command Center, risk tiers) for correctness and tone; list fixes with page + current + proposed text in the PR description | `docs/bn-review` | PR with a reviewed table; corrections applied for strings they are confident about |
| U3 | Real-phone QA (one iOS or Android device) of the Map & Emergency Routing page and Emergency help: complete `docs/qa/mobile_qa.md` (device, browser, what worked, bugs, screenshots) | `docs/mobile-qa` | file committed; each bug is described with steps to reproduce |

### mdjameee400

| ID | Task | Branch | Done when |
|---|---|---|---|
| J1 | **Fresh-clone verification on their own machine**: follow the README Quick start exactly, record OS, Python/Node versions, wall-clock time to a healthy server and every problem hit; fix any README inaccuracy they find | `docs/fresh-clone-verification` | `docs/qa/fresh_clone_<os>.md` committed with real timings; README corrections in the same PR |
| J2 | **Facility data spot-check**: take 30 hospitals/clinics from `app_data/geo/facilities.geojson` (suggested: `python3 -c "import json,random;f=json.load(open('app_data/geo/facilities.geojson'))['features'];random.seed(1);[print(x['properties']['id'],x['properties']['name'])for x in random.sample(f,30)]"`), open each `osm_url`, and record whether name, location and phone match the OpenStreetMap page, plus any obvious real-world mismatch | `docs/facility-spot-check` | `docs/qa/facility_spot_check.md` with the 30 results and a one-paragraph summary; no data files edited |
| J3 | Record the three-minute demo following `docs/demo_script.md`; upload it unlisted and add the link to the README "Demo" line | `docs/demo-video` | link works for a logged-out viewer; the video shows the real app, uncut, within three minutes |

### Lead (A-K-M-Asifuzzaman)

Core forecasting and engineering architecture (already in the repository), deployment, final integration, reviewing and merging the pull requests above.

## 4. How GitHub attribution works (and how to verify it)

| Item | What it is | Where to verify |
|---|---|---|
| Git **author** | who wrote the change (`user.name` / `user.email` at commit time) | `git log --format='%an <%ae>'` |
| Git **committer** | who created the commit object; differs from the author after a rebase or a GitHub merge | `git log --format='%cn <%ce>'` |
| **Pusher** | the GitHub account whose credentials ran `git push`; shown on the push event, not in the commit | repository → Activity |
| Linking to an account | GitHub links a commit to a user only if its author email is a **verified email on that account**, or is that account's `ID+username@users.noreply.github.com` address | commit page shows the avatar; API: `gh api repos/OWNER/REPO/commits/SHA --jq .author.login` (null = unlinked) |
| **Contributors** list and contribution graph | built from commits on the default branch whose author email is linked to an account (graph also needs the repo to be non-fork and the commit to be on `main` or `gh-pages`) | repository → Insights → Contributors, GitHub profile graph |

Consequences:
- **Each teammate uses their own identity** for the work they authored. Set that identity with `git config --local user.name` and `git config --local user.email` in their clone. A push authenticates the pusher and does not change the authors of the commits it uploads. The lead can merge teammate-authored commits into `main`.
- A teammate's email must be **added and verified in their GitHub account** (Settings → Emails) or they must use their `ID+username@users.noreply.github.com` address. Otherwise their commits appear as an unlinked name.
- **Merging a PR**: Use *Create a merge commit* to preserve the original commits and their authors. Use GitHub's *Rebase and merge* if the repository requires linear history. It preserves each author and creates new commit IDs. Avoid squashing when the separate commits are needed for review or attribution.
- GitHub links the lead's commit `f154588` to **A-K-M-Asifuzzaman** as both author and committer. Each teammate can verify their account link on their commit page or through the Commits API.
- Commits are currently **unsigned**, so GitHub shows no "Verified" badge. Signing is optional; if wanted, set up SSH/GPG signing under the lead's own account.

## 5. Safe commands

Teammate, from their own machine and GitHub login:

```bash
git clone https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON.git && cd EDU_HACKATHON
git config --local user.name  "<your GitHub username>"
git config --local user.email "<your GitHub-linked commit email or GitHub-provided noreply address>"
git switch -c feat/<task-branch>            # one branch per task, from main
# ... make the genuine change, run: pytest -q   and   (cd frontend && npx tsc --noEmit)
git add <only the files you changed> && git commit -m "<what and why>"
git push -u origin feat/<task-branch>       # authenticated as YOU (gh auth login / your own SSH key or PAT)
gh pr create --fill --base main             # request review from the lead
```

Lead, release (no force, no rewrites):

```bash
git fetch origin && git status                      # confirm main is up to date and the tree is clean
gh pr list                                          # review each PR; run pytest and the Playwright suite on the merged result
gh pr merge <N> --merge                             # use --rebase if linear history is required
git pull --ff-only && git push origin main          # plain fast-forward push only
git ls-remote origin refs/heads/main && git rev-parse HEAD   # remote HEAD must equal local HEAD
gh api repos/A-K-M-Asifuzzaman/EDU_HACKATHON/contributors --jq '.[] | "\(.login) \(.contributions)"'
```

## 6. Not done, on purpose

- No existing commit was rewritten, split or re-authored; no force-push; no backdating; no empty or artificial commits.
- No commit was created in a teammate's name, and no teammate credentials or e-mail addresses are stored in the repository.
- Repository visibility and the production deployment were not touched.
