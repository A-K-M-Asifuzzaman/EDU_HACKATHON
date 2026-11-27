# Judging-laptop Wi-Fi-off checklist (physical)

Not yet performed on the judging laptop. Tick each line on the day; record the output.

## Once, with the internet on (day before)

1. `git clone --branch upgrade/championship-engine-v2 https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON.git && cd EDU_HACKATHON`
   (or `main` once the owner has merged and deployed).
2. `./scripts/setup.sh` (Python 3.12 venv, both organizer datasets checksum-verified, dashboard build, readiness check). Expect
   "Setup complete".
3. `.venv/bin/python -m pip install pytest` and run `.venv/bin/python -m pytest -q tests/test_preparedness.py tests/test_offline.py`.
4. Start online once: `.venv/bin/python -m uvicorn dengueshield.api.main:app --port 8000` and write the baseline:
   `.venv/bin/python scripts/offline_verify.py --base http://127.0.0.1:8000 --write killswitch/baseline.json` (28 hashes). Stop the server.

## On the day, Wi-Fi off

5. Switch Wi-Fi off (menu bar shows no network). Optional: `ping -c1 8.8.8.8` fails.
6. `./scripts/launch_offline.sh` → note the port. Open `http://127.0.0.1:<port>/`.
7. `.venv/bin/python scripts/offline_verify.py --base http://127.0.0.1:<port> --compare killswitch/baseline.json` → expect
   "28 of 28 results identical".
8. Click through: landing (footer stamps), Response → Mentor demonstration (tiles, Play 28 days, inventory policies, referral plan),
   Operations engine stages 01-04, Dispatch HTML and PDF downloads, preparation brief HTML/CSV/TXT, Geography facility card and route
   (blank basemap is expected offline; points and routes draw), Copilot shows its offline notice.
9. Check the server log: no outbound attempts other than optional services refused.

Expected offline limits: no street basemap tiles, no live weather, no Copilot generation, no DGHS polygons, no sign-in.
