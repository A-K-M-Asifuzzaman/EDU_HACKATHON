# Deploying DengueShield AI to Render

One Docker web service serves the API and the dashboard (`Dockerfile`, `render.yaml`). The image build (≈ 1 min locally) compiles the
frontend, installs the runtime dependencies and downloads + checksum-verifies the organizer CSV (it is not in git). A running container uses
≈ 220 MB of RAM; the Starter plan (512 MB) is enough. The free plan sleeps after 15 minutes idle, so it is not suitable for a demo.

## Steps

1. Push the repository to GitHub (`git push origin main`; it stays private).
2. Render dashboard → **New → Blueprint** → select `EDU_HACKATHON` (authorise Render's GitHub app for that one private repo). Render reads `render.yaml`.
3. Enter the three secrets when prompted. All are optional; each feature switches off cleanly without its variable:

   | Variable | Effect |
   |---|---|
   | `ACCESS_PASSWORD` | Browser password prompt (any username) for everything except `/api/health`. **Set this**: the URL is otherwise public to anyone who has it. |
   | `OPENAI_API_KEY` | Enables the Copilot. Without it the Copilot shows its retrieval-only fallback. |
   | `NEXT_PUBLIC_MAPTILER_KEY` | Basemap tiles (baked into the frontend at build time). Without it the maps use a blank basemap or the table view. |

4. After the first deploy, open `https://<service>.onrender.com`. Health check: `/api/health`.

## Cost and abuse controls

- Copilot spend: ≈ US$0.003 per answer, 30 questions/hour per client IP (the container runs uvicorn with `--proxy-headers`), 900 output tokens,
  and `OPENAI_BUDGET_USD` (default 1.00; held in memory, so it resets when the service restarts). Also set a hard monthly limit in the OpenAI dashboard.
- MapTiler key: it is visible in the browser by design. In the MapTiler dashboard restrict it to your `onrender.com` domain.
- External services (NASA POWER, Open-Meteo, DGHS GIS) are optional and cached; the container's disk is ephemeral, so caches restart empty.

## Things to know

- The raw CSV exists only inside the container image, and the app serves derived views of it (profiles, forecasts, replay), never the file. The organizers' redistribution terms
  are still undecided (`data/README.md`), which is another reason to keep the password on.
- Updating: `git push` triggers a redeploy (`autoDeployTrigger: commit`). If you change any approved document (README, ARCHITECTURE, `docs/*.md`) rebuild the
  Copilot embedding index afterwards (`python -m dengueshield.api.rag build`, ≈ US$0.003) and commit `app_data/rag_index.npz`; otherwise the Copilot falls back to keyword-only retrieval.
- Local test of the exact image: `docker build -t dengueshield-ai . && docker run --rm -p 8300:10000 -e ACCESS_PASSWORD=test dengueshield-ai`.
