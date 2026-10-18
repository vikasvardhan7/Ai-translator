# API and WebSocket protocol (v1)

This file is the contract between the frontend and the backend. Both sides build against it.
**Change it only in a pull request that both developers agree on.**

Status of each item: **live** = implemented on the backend; otherwise the step that adds it.

## 1. REST endpoints

Base address in development: `http://localhost:8000`. Bodies are JSON.
Every error response is `{"detail": "one readable sentence"}` with a 4xx or 5xx status, so the
frontend can show `detail` directly.

| Method and path | Status | Purpose |
| --- | --- | --- |
| `GET /health` | live | Backend is running: `{"status":"ok","version":"0.3.0"}` |
| `GET /api/languages` | live | Languages for the pickers |
| `POST /api/sessions` | live | Start a conversation; returns the session id |
| `WS /api/sessions/{session_id}/stream` | live | Live channel: audio in, captions and events out |
| `POST /api/sessions/{session_id}/stop` | 1F | End the conversation and save the transcript |
| `GET /api/sessions` | 1F | Past conversations, newest first |
| `GET /api/sessions/{session_id}/transcript` | 1F | All saved turns of one conversation |
| `GET /api/sessions/{session_id}/export?format=txt\|srt\|vtt\|json` | 1F | Download the transcript |
| `DELETE /api/sessions/{session_id}` | 1F | Delete a conversation |

### GET /api/languages

```json
{
  "languages": [
    { "code": "en", "name": "English", "native_name": "English" },
    { "code": "te", "name": "Telugu", "native_name": "తెలుగు" }
  ]
}
```

Codes are ISO 639-1. The list is sorted by English name. The frontend must not hard-code it.

### POST /api/sessions

Request:

```json
{
  "consent": true,
  "participants": [
    { "id": "A", "name": "Person A", "preferred_language": "en" },
    { "id": "B", "name": "Person B", "preferred_language": "te" }
  ]
}
```

Response `201 Created`:

```json
{
  "session_id": "6f1c2a9e-0d4b-4b8e-9a51-2f0e7c3d1a77",
  "participants": [ "...same as sent, ordered A then B..." ],
  "created_at": "2026-10-18T09:30:00Z"
}
```

Rules (otherwise `422` with a readable `detail`):

- `consent` must be `true`.
- Exactly two participants, ids `A` and `B`, one each.
- `name`: 1 to 40 characters after trimming spaces.
- `preferred_language`: a code from `/api/languages`. Both people may choose the same language.
- No extra fields.

Sessions are kept in memory until Step 1F, so they disappear when the backend restarts.

## 2. WebSocket connection

- URL: `ws://localhost:8000/api/sessions/{session_id}/stream`.
- Text frames are JSON objects with a string `type`. Maximum 64 KB per text message.
- The server is started with `--ws-max-size 65536`, so any single message over 64 KB closes the
  connection.
- Binary frames are microphone audio (section 4).
- Every server message has `type` and `seq`. `seq` starts at 1 for each connection and goes
  up by one per message. Use it to keep order and ignore duplicates.
- The first server message is always `session.ready`.

Close codes:

| Code | Meaning |
| --- | --- |
| `1000` | Normal close after `session.stop` |
| `4403` | The browser page's origin is not the configured frontend address (`FRONTEND_ORIGIN`) |
| `4404` | Unknown session id (an `unknown_session` error is sent first) |
| `1011` | Unexpected server error (an `internal_error` error is sent first) |

## 3. Browser to server messages

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `ping` | live | none | Keep-alive; answered with `pong` |
| `session.stop` | live | none | End the conversation; the server closes with 1000 |
| `utterance.start` | live | `utterance_id` (UUID), `speaker_id` (`A`/`B`), `spoken_language` (code or `null` for auto-detect) | A talk button was pressed; audio frames follow |
| binary audio frame | live | raw audio (section 4) | Audio for the open utterance |
| `utterance.end` | live | `utterance_id` | The person stopped talking |

Rules for utterances:

- `utterance_id` must be a UUID in its standard 36-character form (as `crypto.randomUUID()` makes).
- Only one utterance can be open per connection. If a new `utterance.start` arrives before the
  previous one ended, the previous one is discarded and reported with an `invalid_message` error
  carrying the previous `utterance_id`; the new one starts normally.
- After an utterance is rejected while audio is still arriving (`audio_too_long` or a malformed
  frame), its remaining frames and its `utterance.end` are ignored without further errors.
- `spoken_language` is optional. Send a code to skip automatic detection, or `null`.
- Unknown extra fields are rejected with `invalid_message`.

## 4. Audio format

| Property | Value |
| --- | --- |
| Encoding | PCM, signed 16-bit, little-endian |
| Channels | 1 (mono) |
| Sample rate | 16,000 Hz |
| Frame size | About 100 ms: 1,600 samples = 3,200 bytes per binary message. Must be an even number of bytes and at most 32,000 bytes (1 s), otherwise `invalid_message` and the utterance is dropped |
| When | Only between `utterance.start` and `utterance.end` |
| Limits | Under 0.3 s, or no 100 ms stretch louder than silence: `audio_too_short`. Over 30 s: `audio_too_long`, sent once; the rest of that utterance's frames and its `utterance.end` are ignored. The browser should stop at 30 s |

## 5. Server to browser messages

All include `type` and `seq`.

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `session.ready` | live | `session_id`, `participants` | Live channel is open |
| `pong` | live | none | Answer to `ping` |
| `error` | live | `code`, `message`, `retryable`, `utterance_id` (or `null`) | Show `message` to the user |
| `utterance.received` | live | `utterance_id`, `speaker_id`, `duration_ms` | Whole sentence received |
| `transcript.final` | 1D | `utterance_id`, `speaker_id`, `text`, `language`, `language_name` | What was said and its detected language |
| `translation.final` | 1D | `utterance_id`, `speaker_id`, `listener_id`, `target_language`, `text`, `translated` | Text for the listener; `translated: false` when it was already in their language |
| `tts.audio` | 1E | `utterance_id`, `listener_id`, `format` (`mp3`/`wav`), `audio_base64` | Only if the server makes the voice |
| `transcript.partial` | 2A | `utterance_id`, `speaker_id`, `text` | Text so far while speaking |

### Example exchange (from Step 1D)

```text
-> {"type":"utterance.start","utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","spoken_language":null}
-> (binary audio frames, about 100 ms each)
-> {"type":"utterance.end","utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7"}
<- {"type":"utterance.received","seq":4,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","duration_ms":2100}
<- {"type":"transcript.final","seq":5,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","text":"మీరు ఎలా ఉన్నారు?","language":"te","language_name":"Telugu"}
<- {"type":"translation.final","seq":6,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","listener_id":"A","target_language":"en","text":"How are you?","translated":true}
```

## 6. Error codes

| Code | Status | Retryable | When |
| --- | --- | --- | --- |
| `invalid_message` | live | no | Not valid JSON, not an object, missing or unknown `type`, invalid fields, too large, second open utterance, malformed audio frame |
| `unknown_session` | live | no | The session id does not exist (then close 4404) |
| `no_active_utterance` | live | no | Audio or `utterance.end` without an open utterance |
| `audio_too_short` | live | no | Under 0.3 s, or silence |
| `audio_too_long` | live | no | Over 30 s in one utterance |
| `unsupported_language` | 1D | no | Detected or requested language is not in the list |
| `provider_unavailable` | 1D | yes | AI service unreachable or timed out |
| `quota_exceeded` | 1D | yes, later | Free-tier limit reached |
| `internal_error` | live | yes | Unexpected server error; details only in the backend log. The connection closes with 1011 |
