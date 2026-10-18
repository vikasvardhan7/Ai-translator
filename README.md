# Voice Translator

A two-way, real-time voice translator. Two people who speak different languages (Telugu and English first) talk through one app: it recognizes speech, translates it into the other person's language, shows captions in both languages, speaks the translation aloud, and saves a downloadable transcript.

**Status:** Phase 1, Step 1C (backend): languages list, sessions API, the live WebSocket channel and microphone audio intake are working. No speech recognition or translation yet.

While testing, set `SAVE_DEBUG_AUDIO=true` in `backend/.env` and every received sentence is saved as `backend/data/debug/<id>.wav` so you can listen to it. Keep it `false` otherwise: it records everything people say.

The frontend/backend contract is [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Decisions are in [`docs/DECISIONS.md`](docs/DECISIONS.md). The step-by-step plan for both developers is in [`docs/DEVELOPER-HANDBOOK.docx`](docs/DEVELOPER-HANDBOOK.docx).

The full design is in [`docs/ARCHITECTURE_BLUEPRINT.md`](docs/ARCHITECTURE_BLUEPRINT.md), with an overview diagram in [`docs/architecture-overview.png`](docs/architecture-overview.png).

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Vitest |
| Backend | Python 3.12, FastAPI, Uvicorn, pytest, Ruff |
| Speech and translation | Free tiers only (Gemini API free tier or local models), chosen in Step 1D |
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
uvicorn app.main:app --reload --port 8000 --ws-max-size 65536
```

Check it at <http://localhost:8000/health>. It should return `{"status":"ok","version":"0.3.0"}`. Interactive API docs, where you can try every endpoint, are at <http://localhost:8000/docs>.

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
│   │   ├── api/             languages, sessions, WebSocket stream
│   │   ├── core/            settings, language list, error format
│   │   ├── models/          request and response models
│   │   └── services/        session store
│   ├── tests/
│   ├── requirements.txt     runtime dependencies
│   └── requirements-dev.txt test and lint tools
├── frontend/
│   ├── src/                 React app
│   ├── package.json
│   └── vite.config.ts
├── docs/                    architecture blueprint
└── README.md
```

Folders for speech recognition, translation, storage and exports are added in the steps that need them.

## Automatic checks

Every pull request and every push to `main` runs the backend tests and lint (on Linux and Windows) and the frontend type check, tests and build on GitHub Actions. See `.github/workflows/checks.yml`. Merge only when all checks are green.

## Security

- API keys go only in `backend/.env`, which Git ignores. Never put keys in the frontend: anything starting with `VITE_` is visible in the browser.
- `.env.example` files contain placeholders only.
