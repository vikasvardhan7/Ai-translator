# Voice Translator

A two-way, real-time voice translator. Two people who speak different languages talk through one app: it recognizes speech, translates it into the other person's language, shows captions in each person's language and speaks the translation aloud.

**Status:** working end to end. Three ways to use it: two people at one device, two people on their own devices through an invite link, and captions for an online meeting (Google Meet, Teams or Zoom) in your language. Hands-free listening finds each sentence by itself; speech is recognized and translated from any language (Gemini API free tier) and spoken by a Gemini voice or the browser's own; the Meet-style screen has live captions, a transcript with text and subtitle downloads, and settings for language, voice and speed. Connections that drop come back by themselves. There is no fixed language list: any ISO 639 code is accepted.

Nothing is recorded. Audio is held in memory only until its sentence is translated, captions live only in the browser, and sessions and rooms leave memory when they end or after 10 to 30 minutes without a device.

The frontend/backend contract is [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Decisions are in [`docs/DECISIONS.md`](docs/DECISIONS.md). [`docs/DEVELOPER-HANDBOOK.docx`](docs/DEVELOPER-HANDBOOK.docx) is the original plan from the first day and is out of date; the protocol and decisions are current.

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

Check it at <http://localhost:8000/health>. It should return `{"status":"ok","version":"0.9.0"}`. The backend window also prints a **host key** (for example `ABCD-EF23-GH45`), new on every start; you need it only when you open the app through a public link (see below). Interactive API docs, where you can try every endpoint, are at <http://localhost:8000/docs>.

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

With the backend running, open <http://localhost:5173> in Edge or Chrome and press "I agree, let's start". The assistant asks whether you are talking to someone next to you, someone on another device, or people in an online meeting; then you say hello and it finds your language. Allow the microphone when asked, then just talk: each sentence appears as a caption in your language and is spoken aloud. The buttons at the bottom mute your microphone, switch between voice and captions only, open Settings (your language, a natural or fast voice, and its speed) and show the transcript, which you can download as text or subtitles. Use headphones or keep the volume low so the app does not hear its own voice.

If the connection drops, the screen says "Reconnecting" and comes back by itself with the transcript kept, for up to five minutes.

## Captions for an online meeting

Join your meeting as usual (Google Meet, Teams or Zoom, in a tab or in the app). In the translator choose "In an online meeting", say hello in the language you want the captions in, then press **Connect meeting** and pick the meeting's browser tab with **Share tab audio** turned on (for the Teams or Zoom app, pick **Entire screen** with **Share system audio**). From then on every sentence said in the meeting appears as a caption in your language, and your own words appear as you said them; the transcript panel keeps both and can be downloaded. Nothing is sent into the meeting, so tell the others that captions are on. Wear headphones so your microphone does not hear the meeting too (the app drops such doubles, but headphones are cleaner).

The backend log prints one line per sentence with how long each step took, so you can see where time goes.

## Talking to someone on another device

The other person can be on any phone or computer with Edge or Chrome. Your laptop runs everything, and a free Cloudflare tunnel gives it a public https link while it runs (no account needed).

1. Install the tunnel once: `winget install --id Cloudflare.cloudflared`
2. Build the frontend so the backend can serve it: in `frontend`, run `npm run build`.
3. Start the backend as above (`uvicorn ... --port 8000`).
4. In a third terminal run `cloudflared tunnel --url http://localhost:8000` and copy the `https://...trycloudflare.com` address it prints.
5. Open that address on your laptop (not localhost). The app asks for the host key printed in the backend window; type it once and it is remembered in that browser. Then press "I agree, let's start", choose "On another device" and say hello.
6. Send the invite link to the other person. They need no key. When they open it and say hello, the conversation starts on both devices: each of you talks into your own device, sees both sides of the chat and hears the other person in your language.

The host key keeps strangers who find the address from using your Gemini quota: only starting a conversation needs it, and invited guests are let in by their invite link. The address changes every time the tunnel starts, and the conversation stops when your laptop sleeps or the tunnel is closed. On a phone, keep the page open with the screen on: phones pause the microphone for pages in the background. If either phone loses its connection for a moment, both screens show it and the call continues when it is back.

## Project structure

```
Ai-translator/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app, CORS, /health, host key, log redaction
│   │   ├── api/             access, sessions, rooms, languages, voices, WebSocket streams
│   │   ├── core/            settings, access (host key), language codes, text matching, error format
│   │   ├── models/          request and response models
│   │   └── services/        session and room stores, speech detection, Gemini speech, translation and voice, retry
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
- Through a public link, starting conversations needs the host key printed by the backend; the backend's request log hides tokens and session ids. If you put your own proxy in front of the backend instead of cloudflared, set `HOST_KEY_EVERYWHERE=true` in `backend/.env` so requests through it are never mistaken for local ones.
- `.git/info/exclude` is the place for your own editor and agent folders; `.gitignore` covers build output, caches, Word lock files and coverage reports.
