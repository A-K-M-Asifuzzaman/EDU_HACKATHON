# Final release checklist

Nothing here has been merged or deployed. Production (`main`, Vercel, Hugging Face Space) is unchanged by this sprint.

- [ ] Owner reviews `upgrade/championship-engine-v2` (PR into `main`), CI green on the PR head.
- [ ] Owner approves deployment: backend Space (new endpoints `/api/preparedness/*`, fixture `app_data/preparedness/`) **before** the
      frontend (the new section calls those endpoints); then Vercel. Keep the previous Space revision and Vercel deployment as rollback.
- [ ] After deploy: `/api/health` build commit, `/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North` returns 200, the
      Response page `#prepare` Mentor demonstration loads, footer shows interface and API commits.
- [ ] Judging laptop: fresh clone or prepared clone, `npm run build`, Wi-Fi off, `scripts/launch_offline.sh`, run
      `scripts/offline_verify.py --compare` against a baseline written on that laptop.
- [ ] Record the uncut seven-minute video from [JUDGE_DEMO_SCRIPT_7MIN.md](JUDGE_DEMO_SCRIPT_7MIN.md); confirm the spoken numbers on that laptop.
- [ ] Confirm the submission destination and deadline in the organizer PDF; repository access/visibility (owner).
- [ ] Teammate contributions are recorded as they happened (no fabricated history).
