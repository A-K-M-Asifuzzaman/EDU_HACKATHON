# Release checklist and deployment instructions

## Production state (checked 27 Nov 2026, read-only)

- The owner merged PR #9 (branch at `f9372e5`) into `main` (`6e53989`). Vercel published that frontend.
- The Deploy workflow reported success but **skipped both deploy jobs' steps** ("HF_TOKEN is not set"), so the backend Space still runs
  `4ce4801`.
- Result: on https://we-are-hack-squad.vercel.app/response/ the Hospital preparedness section shows
  **"Hospital preparedness is not available for this selection. Not Found."**; `/api/preparedness/*` and
  `/api/allocation/uncertainty` return 404. The other routes checked (allocation, overflow, intervention, dispatch) return 200.
- Nothing was deployed by this work.

## Fix now: deploy the backend that matches the live frontend (owner approval needed)

```bash
cd <a checkout of EDU_HACKATHON>
git fetch origin && git switch main && git pull --ff-only        # 6e53989
hf auth login                                                    # write token for AsifZaman1912 (skip if already logged in)
python3 scripts/deploy_space.py AsifZaman1912/dengueshield-ai-api
# wait for the Space to be RUNNING, then:
curl -s https://we-are-hack-squad.vercel.app/api/health            # build_commit 6e53989
curl -s "https://we-are-hack-squad.vercel.app/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North" | head -c 200
```
Rollback: re-upload the previous commit (`git switch --detach 4ce4801 && python3 scripts/deploy_space.py ...`), or revert PR #9 so the
frontend matches the old backend. Alternative for hands-free deploys: add an `HF_TOKEN` repository secret (never paste it in a chat),
then run the Deploy workflow.

## Release this sprint (after the fix above, owner approval needed)

1. Open a PR `upgrade/championship-engine-v2` → `main` (it adds the restore-race fix, the 28-day referral program, redistribution,
   playback, geography panel, contact re-check). CI must be green on the PR head.
2. Deploy the **backend first** (steps above from the new `main`), then confirm Vercel's deployment of the same commit.
3. Smoke test: health `build_commit` equals the interface commit in the footer; Response → Mentor demonstration shows tiles with
   "28-day plan"; CSV brief downloads; Geography shows the directory-modes panel.
4. Keep the previous Space revision and Vercel deployment as rollback targets.

## Submission

- [ ] Judging laptop: [WIFI_OFF_CHECKLIST.md](WIFI_OFF_CHECKLIST.md) completed.
- [ ] Seven-minute uncut video recorded from [JUDGE_DEMO_SCRIPT_7MIN.md](JUDGE_DEMO_SCRIPT_7MIN.md).
- [ ] Submission destination and deadline confirmed in the organizer PDF; repository access/visibility (owner).
- [ ] Teammate contributions recorded as they happened.
