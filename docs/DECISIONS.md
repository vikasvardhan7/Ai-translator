# Decisions

Agreed product and technical decisions. Newest first. Change only with the owner's approval.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-18 | Two-person split: Vikas owns `backend/` and merges frontend pull requests; the teammate owns `frontend/` and works only through pull requests. | Parallel work without editing the same files. |
| 2026-10-18 | The WebSocket checks the browser's `Origin` and only accepts the configured frontend address (close code 4403). | Stops other websites from opening the live channel. |
| 2026-10-18 | Tap-to-talk first, one button per person. Hands-free comes in Phase 2. | The app always knows who is speaking, even when both speak the same language. |
| 2026-10-18 | **Any spoken language in, the listener's chosen language out.** Each participant picks a preferred language. Speech language is detected automatically. Translation is skipped when the speech is already in the listener's language. | Core product requirement. Telugu and English are only the first test pair. |
| 2026-10-18 | Free services only: Gemini API free tier, local models (Whisper) and browser voices. | Cost requirement. Paid services need the owner's approval. |
| 2026-10-18 | Project lives in `C:\dev\Ai-translator`, outside OneDrive. | OneDrive syncing breaks package installs. |
| 2026-10-18 | React + TypeScript + Vite frontend; Python 3.12 + FastAPI backend; SQLite until multi-user is needed. | Agreed stack; AI libraries are Python-first. |
