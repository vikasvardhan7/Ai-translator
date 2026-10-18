# Voice Translator

A two-way, real-time voice translator. Two people who speak different languages (Telugu and English first) talk through one app: it recognizes speech, translates it into the other person's language, shows captions in both languages and speaks the translation aloud.

**Status:** Phase 1 (backend): sessions API, live WebSocket channel, hands-free listening that finds each sentence by itself, speech recognition with translation from any spoken language into each person's chosen language, and the translation spoken aloud (Gemini API free tier) are working. The backend side of call mode, for translating Google Meet calls and other calls in a browser tab, is ready (`docs/PROTOCOL.md`, section 7); its browser part is Step 1G. There is no fixed language list: any ISO 639 code is accepted.

Nothing is recorded. Audio is held in memory only until its sentence is translated, a session leaves memory when its live channel opens, and a session that is never opened expires after 10 minutes.

The frontend/backend contract is [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Decisions are in [`docs/DECISIONS.md`](docs/DECISIONS.md). The step-by-step plan for both developers is in [`docs/DEVELOPER-HANDBOOK.docx`](docs/DEVELOPER-HANDBOOK.docx).

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Vitest |
| Backend | Python 3.12, FastAPI, Uvicorn, pytest, Ruff |
| Speech, translation and voice | Gemini API free tier through `google-genai`; models set by `GEMINI_MODEL` and `GEMINI_TTS_MODEL` |
| Storage | None: nothing is recorded or saved |

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

Check it at <http://localhost:8000/health>. It should return `{"status":"ok","version":"0.8.0"}`. Interactive API docs, where you can try every endpoint, are at <http://localhost:8000/docs>.

### Speech recognition and translation

1. Create a free API key at <https://aistudio.google.com> (Get API key).
2. Put it in `backend/.env` as `GEMINI_API_KEY=...`. Never commit it or paste it anywhere else.
3. Set `GEMINI_MODEL` in `backend/.env` to a model from `python -m scripts.benchmark --list-models` (the benchmark below helps choose).
4. For the spoken translation, set `GEMINI_TTS_MODEL` to a voice model from the same list (names ending in `-tts`). Leave it empty and the browser speaks translations with its own voices instead.
5. Restart the backend. Without a key or model the app still runs, and each sentence gets a clear "not set up" message.

On the free tier Google may use what you send to improve its products, so avoid private conversations.

To compare Gemini models live, from `backend/`:

```powershell
python -m scripts.benchmark --list-models
python -m scripts.benchmark --fleurs te,hi,en --count 10 --target en --models <model>,<model>
```

`--list-models` asks Google which models your key can use. The benchmark streams real speech clips from Google's FLEURS dataset (CC BY 4.0, about 100 languages) straight into each model, one language at a time, and prints what each model heard, its translation and the correct translation, then a summary. Clips stay in memory only while their language is tested; nothing is saved. Without `--models` it tests `GEMINI_MODEL`. Each clip is sent as in a real conversation, with the clip's language and `--target` as the two people's languages, so the language score shows what the app will detect, not detection without any hint.

## Frontend setup

Open a second terminal:

```powershell
cd frontend
npm install
npm test
npm run typecheck
npm run dev
```

With the backend running, open <http://localhost:5173> in Edge or Chrome and press "We both agree, let's start". The assistant asks whether the other person is next to you or on another device, then each of you says hello and it finds your languages. Allow the microphone when asked, then just talk: each sentence appears as a caption in your language and is spoken aloud. The buttons at the bottom mute your microphone, switch between voice and captions only, open Settings (your language, a natural or fast voice, and its speed) and show the transcript, which you can download as text or subtitles. Use headphones or keep the volume low so the app does not hear its own voice.

## Talking to someone on another device

The other person can be on any phone or computer with Edge or Chrome. Your laptop runs everything, and a free Cloudflare tunnel gives it a public https link while it runs (no account needed).

1. Install the tunnel once: `winget install --id Cloudflare.cloudflared`
2. Build the frontend so the backend can serve it: in `frontend`, run `npm run build`.
3. Start the backend as above (`uvicorn ... --port 8000`).
4. In a third terminal run `cloudflared tunnel --url http://localhost:8000` and copy the `https://...trycloudflare.com` address it prints.
5. Open that address on your laptop (not localhost), press "We both agree, let's start", choose "On another device" and say hello.
6. Send the invite link to the other person. When they open it and say hello, the conversation starts on both devices: each of you talks into your own device, sees both sides of the chat and hears the other person in your language.

The address changes every time the tunnel starts, and the conversation stops when your laptop sleeps or the tunnel is closed. On a phone, keep the page open with the screen on: phones pause the microphone for pages in the background.

## Project structure

```
Ai-translator/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app, CORS, /health
│   │   ├── api/             sessions, WebSocket stream
│   │   ├── core/            settings, language codes, error format
│   │   ├── models/          request and response models
│   │   └── services/        session store, hands-free speech detection, speech translation, voice
│   ├── scripts/             live model comparison on FLEURS speech
│   ├── tests/
│   ├── requirements.txt     runtime dependencies
│   └── requirements-dev.txt test and lint tools
├── frontend/
│   ├── src/                 React app
│   ├── package.json
│   └── vite.config.ts
├── docs/                    protocol, decisions, developer handbook
└── README.md
```

## Automatic checks

Every pull request and every push to `main` runs the backend tests and lint (on Linux and Windows) and the frontend type check, tests and build on GitHub Actions. See `.github/workflows/checks.yml`. Merge only when all checks are green.

## Security

- API keys go only in `backend/.env`, which Git ignores. Never put keys in the frontend: anything starting with `VITE_` is visible in the browser.
- `.env.example` files contain placeholders only.
