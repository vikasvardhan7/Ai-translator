# Working rules for coding agents (Claude Code, Codex)

This repository is an AI two-way real-time voice translator. The owner decides what gets built; agents implement only the task they are given.

## Rules

1. Work only on the task you are explicitly given. Do not start the next step or phase on your own.
2. Before editing, check `git status` and read the relevant files. Never assume files are unchanged since the last task.
3. Do not overwrite or undo uncommitted changes from the owner or another agent. If changes conflict, stop and explain.
4. Make the smallest change that completes the task. Don't refactor unrelated code.
5. Ask before adding major dependencies, changing frameworks or architecture, changing the database schema, or using any paid service. The project uses **free tiers or local models only**.
6. Never commit, push, deploy or delete files unless the owner asks.
7. Never print, log or commit API keys or other secrets. Keys live only in `backend/.env`.
8. Run the relevant tests, type checks and lint before reporting. Never claim something works without testing it.
9. Finish with a report: what was done, files changed, commands run, test results, remaining issues, how to verify.

## Architecture

The full design is in `docs/ARCHITECTURE_BLUEPRINT.md`. Key points:

- Frontend: React + TypeScript + Vite in `frontend/`. Backend: Python 3.12 + FastAPI in `backend/`.
- Real-time audio and events travel over a WebSocket between frontend and backend.
- Audio sources (microphone, uploaded file, later telephony) sit behind a common adapter interface.
- Speech recognition, translation and text-to-speech each sit behind their own interface, so providers can be swapped by configuration.
- Both translation directions feed one conversation manager and one transcript.
- API keys stay on the backend. The browser never receives a provider key.

## Commands

Backend (from `backend/`, with `.venv` activated):

- Install: `pip install -r requirements-dev.txt`
- Test: `pytest`
- Lint and format check: `ruff check .` and `ruff format --check .`
- Run: `uvicorn app.main:app --reload --port 8000`

Frontend (from `frontend/`):

- Install: `npm install`
- Test: `npm test`
- Type check: `npm run typecheck`
- Build: `npm run build`
- Run: `npm run dev`

## Conventions

- Python: type hints everywhere, Ruff for lint and formatting, tests in `backend/tests/`.
- TypeScript: strict mode, tests next to the code as `*.test.ts`.
- Text files use LF line endings (see `.gitattributes`).
