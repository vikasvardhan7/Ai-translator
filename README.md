# AI Voice Translator

A two-way, real-time voice translator. Two people who speak different languages (Telugu and English first) talk through one app: it recognizes speech, translates it into the other person's language, shows captions in both languages, speaks the translation aloud, and saves a downloadable transcript.

**Status:** Phase 1, Step 1A (project setup). The frontend and backend skeletons install, run and pass their tests. No translation features yet.

The full design is in [`docs/ARCHITECTURE_BLUEPRINT.md`](docs/ARCHITECTURE_BLUEPRINT.md), with an overview diagram in [`docs/architecture-overview.png`](docs/architecture-overview.png).

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Vitest |
| Backend | Python 3.12, FastAPI, Uvicorn, pytest, Ruff |
| AI services | Free tiers only (Gemini free API or local models), chosen in the AI pipeline step |
| Storage | SQLite (added in a later step) |

## Prerequisites (Windows)

- Node.js 22.12 or newer (tested with 24.20) and npm
- Python 3.12
- Git

If PowerShell blocks `npm` with "running scripts is disabled", run this once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Run the tests and lint:

```powershell
pytest
ruff check .
```

Start the server:

```powershell
uvicorn app.main:app --reload --port 8000
```

Check it at <http://localhost:8000/health>. It should return `{"status":"ok","version":"0.1.0"}`. Interactive API docs are at <http://localhost:8000/docs>.

## Frontend setup

Open a second terminal:

```powershell
cd frontend
npm install
npm test
npm run typecheck
npm run dev
```

Open <http://localhost:5173> to see the placeholder page.

## Project structure

```
Ai-translator/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app, CORS, /health
│   │   └── core/config.py   settings from backend/.env
│   ├── tests/
│   ├── requirements.txt     runtime dependencies
│   └── requirements-dev.txt test and lint tools
├── frontend/
│   ├── src/                 React app
│   ├── package.json
│   └── vite.config.ts
├── docs/                    architecture blueprint
├── CLAUDE.md                working rules for coding agents
└── README.md
```

Folders for audio, AI services, storage and exports are added in the steps that need them.

## Security

- API keys go only in `backend/.env`, which Git ignores. Never put keys in the frontend: anything starting with `VITE_` is visible in the browser.
- `.env.example` files contain placeholders only.
