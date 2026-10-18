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
| `GET /health` | live | Backend is running: `{"status":"ok","version":"0.4.0"}` |
| `POST /api/sessions` | live | Start a conversation; returns the session id |
| `WS /api/sessions/{session_id}/stream` | live | Live channel: audio in, captions and events out |

### Language codes

There is no fixed language list. A language is any ISO 639 code: two letters when one exists,
otherwise three (`te`, `hi`, `en`, `yue`, `fil`). The backend accepts regional forms such as
`pt-BR` or `zh_Hant` and keeps only the language part (`pt`, `zh`). Text that is not a code,
such as `Telugu`, is refused.

The frontend builds the language picker itself from the browser: `Intl.DisplayNames` gives the
name of every code it knows, in English and in the language itself, with no list in our code.

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
- `preferred_language`: a language code (see Language codes). Both people may choose the same language.
- No extra fields.

Sessions are held in memory only until used. A session's live channel opens once: the session leaves memory as soon as its channel opens, so a second connection, or reconnecting after the channel closes, gets `unknown_session`; start a new session instead. A session that is never opened expires 10 minutes after it was created. At most 100 sessions can wait to be opened; beyond that `POST /api/sessions` returns `503` with a readable `detail`.

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
| `4403` | The browser page's origin is not the configured frontend address (`FRONTEND_ORIGIN`). Connections that send no `Origin` header (not from a browser) are allowed |
| `4404` | Unknown session id (an `unknown_session` error is sent first) |
| `1011` | Unexpected failure of the live channel itself (an `internal_error` with `utterance_id: null` is sent first) |

## 3. Browser to server messages

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `ping` | live | none | Keep-alive; answered with `pong` |
| `session.stop` | live | none | End the conversation. Sentences already received are finished first, for up to the speech timeout plus 5 s in total; any still unfinished then get a `provider_unavailable` error. Then the server closes with 1000 |
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
| `transcript.final` | live | `utterance_id`, `speaker_id`, `text`, `language`, `language_name` | What was said, its detected language code and the English name of that language as reported live by the speech service |
| `translation.final` | live | `utterance_id`, `speaker_id`, `listener_id`, `target_language`, `text`, `translated` | Text for the listener; `translated: false` when it was already in their language, and `text` is then the original |
| `tts.audio` | 1E | `utterance_id`, `listener_id`, `format` (`mp3`/`wav`), `audio_base64` | Only if the server makes the voice |
| `transcript.partial` | 2A | `utterance_id`, `speaker_id`, `text` | Text so far while speaking |

After `utterance.received`, each utterance gets either `transcript.final` followed by
`translation.final`, or one `error` carrying its `utterance_id`. Results arrive in the order the
utterances were spoken. The listener is always the other participant, and the translation is
into their `preferred_language`. At most 5 sentences can wait for translation at once; more get
a retryable `provider_unavailable` error.

Show `text` fields as plain text, never as HTML: they contain whatever the speaker said.

### Example exchange

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
| `unknown_session` | live | no | The session id does not exist, has expired or its channel is already open (then close 4404) |
| `no_active_utterance` | live | no | Audio or `utterance.end` without an open utterance |
| `audio_too_short` | live | no | Under 0.3 s, silence, or no words recognised |
| `audio_too_long` | live | no | Over 30 s in one utterance |
| `unsupported_language` | live | yes | The speech service could not identify the language spoken |
| `provider_unavailable` | live | depends | Retryable: speech service unreachable, slow, erroring, returned an unreadable answer or did not translate the sentence, or 5 sentences are already waiting behind the one being translated. Not retryable: no key or model set up, key or model rejected, audio could not be processed, or the service refused the sentence |
| `quota_exceeded` | live | yes, later | Free-tier limit reached; try again after a minute |
| `internal_error` | live | yes | Unexpected server error; details only in the backend log. With an `utterance_id`: only that sentence failed and the connection stays open. With `utterance_id: null`: the live channel failed and closes with 1011 |
