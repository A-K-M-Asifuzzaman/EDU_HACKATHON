# DengueShield AI: one container serves the FastAPI backend and the pre-built dashboard.
# Build args (set in Render as env vars): NEXT_PUBLIC_MAPTILER_KEY (public browser key; restrict it by domain in MapTiler).
FROM node:22-slim AS web
WORKDIR /w/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG NEXT_PUBLIC_MAPTILER_KEY=""
ARG NEXT_PUBLIC_MAP_PROVIDER="maptiler"
ENV NEXT_PUBLIC_MAPTILER_KEY=$NEXT_PUBLIC_MAPTILER_KEY NEXT_PUBLIC_MAP_PROVIDER=$NEXT_PUBLIC_MAP_PROVIDER
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*   # LightGBM runtime
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY pyproject.toml README.md ARCHITECTURE.md ./
COPY dengueshield ./dengueshield
COPY models ./models
COPY app_data ./app_data
COPY scripts ./scripts
COPY docs ./docs
COPY data/README.md ./data/README.md
COPY reports/eda/README.md ./reports/eda/README.md
COPY reports/baselines/README.md ./reports/baselines/README.md
COPY --from=web /w/frontend/out ./frontend/out
# The organizer CSV is not in git: fetch + SHA-256 verify at build time (the build fails if the download or checksum fails).
RUN python scripts/fetch_data.py
ENV PYTHONUNBUFFERED=1
EXPOSE 10000
# --proxy-headers so the per-client Copilot rate limit sees the visitor's IP, not the platform proxy's.
CMD ["sh", "-c", "exec python -m uvicorn dengueshield.api.main:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips='*'"]
