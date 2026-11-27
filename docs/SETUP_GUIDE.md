# DengueShield AI — Setup & Installation Guide

> Step-by-step instructions to get the project running locally on **Windows**, **macOS**, or **Linux**.

---

## Prerequisites

Before you begin, make sure you have these installed:

| Tool | Required Version | Check Command | Download |
|---|---|---|---|
| **Python** | 3.12 or later | `python --version` | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 20.9+ (22 recommended) | `node --version` | [nodejs.org](https://nodejs.org/) |
| **npm** | comes with Node.js | `npm --version` | Bundled with Node.js |
| **Git** | any recent version | `git --version` | [git-scm.com](https://git-scm.com/) |

> **Note:** Python 3.13 and 3.14 also work. The app was developed on Python 3.12.

---

## Option A: One-Command Launch (Linux / macOS)

```bash
git clone https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON_FINAL.git
cd EDU_HACKATHON_FINAL
./scripts/launch.sh
```

Done! Open **http://127.0.0.1:8000** in your browser.

If port 8000 is busy:
```bash
PORT=8100 ./scripts/launch.sh
```

---

## Option B: Step-by-Step Setup (Windows / Manual)

### 1. Clone the Repository

```powershell
git clone https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON_FINAL.git
cd EDU_HACKATHON_FINAL
```

### 2. Download the Dataset

The organizer dataset is not included in the repository. Download it automatically:

```powershell
python scripts/fetch_data.py
```

You should see: `saved and verified: ...\data\raw\bangladesh_dengue_large_dataset.csv`

> **If the download fails** (firewall, VPN, etc.):
> Download the CSV manually from the hackathon brief link and save it as:
> `data/raw/bangladesh_dengue_large_dataset.csv`

### 3. Create Python Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

**Windows (Command Prompt):**
```cmd
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
```

**macOS / Linux:**
```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Build the Frontend Dashboard

```bash
cd frontend
npm ci
npm run build
cd ..
```

> On Windows, if `npm` is blocked in PowerShell, use: `cmd /c "cd frontend && npm ci && npm run build"`

### 5. Start the Server

**Windows:**
```powershell
.\.venv\Scripts\python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port 8000
```

**macOS / Linux:**
```bash
.venv/bin/python -m uvicorn dengueshield.api.main:app --host 127.0.0.1 --port 8000
```

### 6. Open the App 🎉

Open your browser and go to: **http://127.0.0.1:8000**

You should see the DengueShield AI dashboard with the Command Center as the landing page.

---

## Optional: Enable Extra Features

The app works fully without any API keys. These are optional enhancements:

### AI Copilot (OpenAI)

1. Copy `.env.example` to `.env` in the repo root
2. Add your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart the server

### City Map Tiles (MapTiler)

1. Get a free API key from [maptiler.com](https://www.maptiler.com/)
2. Copy `frontend/.env.example` to `frontend/.env.local`
3. Add your key:
   ```
   NEXT_PUBLIC_MAPTILER_KEY=your_key_here
   ```
4. Rebuild the frontend:
   ```bash
   cd frontend && npm run build
   ```

> **Without the map key:** the map uses a blank basemap, but facilities, routing, and the hospital directory still work normally.

---

## Docker Setup (Alternative)

### Full Stack (Dashboard + API in one container)

```bash
docker build -t dengueshield .
docker run --rm -p 10000:10000 dengueshield
# Open http://localhost:10000
```

### Backend Only (API without dashboard)

```bash
docker build -f Dockerfile.backend -t dengueshield-api .
docker run --rm -p 7860:7860 -e ACCESS_PASSWORD=test dengueshield-api
# API at http://localhost:7860/api/health
```

---

## Verifying the Installation

After starting the server, check these to confirm everything works:

| Check | URL | Expected |
|---|---|---|
| Health endpoint | http://127.0.0.1:8000/api/health | `{"status": "ok", ...}` |
| Dashboard home | http://127.0.0.1:8000 | Command Center page loads |
| API docs (Swagger) | http://127.0.0.1:8000/docs | Interactive API documentation |
| Ward list | http://127.0.0.1:8000/api/wards | JSON array of 60 ward IDs |

---

## Running Tests

```bash
# Install test dependencies
pip install -r requirements-research.txt

# Run Python tests
python -m pytest tests -q

# Frontend typecheck
cd frontend && npx tsc --noEmit

# Browser tests (needs a running server + Playwright)
npx playwright install --with-deps chromium
npx playwright test
```

---

## Common Issues

| Problem | Solution |
|---|---|
| `npm` blocked in PowerShell | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` or use `cmd /c "npm ci"` |
| Port 8000 in use | Use `--port 8100` instead |
| Dataset download fails | Download CSV manually from hackathon brief → save as `data/raw/bangladesh_dengue_large_dataset.csv` |
| Map shows blank tiles | Add MapTiler key (see "Optional" section above) |
| `ModuleNotFoundError: resource` | Already fixed for Windows. If you see this, pull the latest code |

---

## Project Runtime Dependencies

The app needs only 10 Python packages (defined in `requirements.txt`):

| Package | Version | Purpose |
|---|---|---|
| numpy | 2.5.1 | Numerical computing |
| pandas | 3.0.5 | Data manipulation |
| scipy | 1.18.0 | Scientific computing, statistical distributions |
| scikit-learn | 1.9.0 | ML pipeline, model fitting |
| statsmodels | 0.14.6 | Statistical models |
| lightgbm | 4.7.0 | Gradient boosting (ensemble comparison) |
| fastapi | 0.165.0 | Web API framework |
| uvicorn | 0.54.0 | ASGI server |
| httpx | 0.28.1 | HTTP client (external weather APIs) |
| openai | 3.57.0 | Copilot integration (optional) |

Frontend: Next.js 16, React 19, TypeScript, Tailwind 4, ECharts 6, MapLibre 6 (see `frontend/package.json`).

---

<p align="center">
  <strong>DengueShield AI</strong> — Predict Earlier. Respond Smarter.<br/>
  Questions? Open an issue on GitHub.
</p>
