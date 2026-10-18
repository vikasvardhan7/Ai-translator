# API and WebSocket protocol (v2)

This file is the contract between the frontend and the backend. Both sides build against it.
**Change it only in a pull request that both developers agree on.**

Status of each item: **live** = implemented on the backend; otherwise the step that adds it.

## 1. REST endpoints

Base address in development: `http://localhost:8000`. Bodies are JSON.
Every error response is `{"detail": "one readable sentence"}` with a 4xx or 5xx status, so the
frontend can show `detail` directly.

| Method and path | Status | Purpose |
| --- | --- | --- |
| `GET /health` | live | Backend is running: `{"status":"ok","version":"0.6.0"}` |
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
| binary audio frame | live | raw audio (section 4) | Microphone audio, sent continuously while listening |
| `audio.pause` | live | none | The browser stopped sending audio (for example while a translation is being spoken). Any sentence in progress ends now |
| `ping` | live | none | Keep-alive; answered with `pong` |
| `session.stop` | live | none | End the conversation. A sentence in progress is ended and translated; sentences already received are finished first, for up to the speech timeout plus 5 s in total; any still unfinished then get a `provider_unavailable` error. Then the server closes with 1000 |

Listening is hands-free: there are no talk buttons. The browser streams the microphone and the
server finds each sentence by itself. A sentence starts when speech is heard (about 0.3 s of the
quiet before it is kept so the first word is not cut), ends after about 1.5 s of silence, and is
split at 30 s if nobody pauses. Silence and short noises are not sent anywhere.

While a translation is being spoken aloud, the browser sends `audio.pause` and stops sending audio,
so the app never hears itself; it resumes sending frames when playback ends.

## 4. Audio format

| Property | Value |
| --- | --- |
| Encoding | PCM, signed 16-bit, little-endian |
| Channels | 1 (mono) |
| Sample rate | 16,000 Hz |
| Frame size | About 100 ms: 1,600 samples = 3,200 bytes per binary message. Must be a non-empty even number of bytes and at most 32,000 bytes (1 s), otherwise `invalid_message` and that frame is dropped |

## 5. Server to browser messages

All include `type` and `seq`.

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `session.ready` | live | `session_id`, `participants`, `server_voice` | Live channel is open. `server_voice: true` means the server sends `tts.audio` for translations; `false` means the browser speaks translations itself |
| `pong` | live | none | Answer to `ping` |
| `error` | live | `code`, `message`, `retryable`, `utterance_id` (or `null`); `voice_unavailable` also has `listener_id` | Show `message` to the user |
| `utterance.received` | live | `utterance_id`, `duration_ms` | The server heard a sentence and is processing it. `utterance_id` is made by the server |
| `utterance.ignored` | live | `utterance_id` | No words were recognised (noise, coughing). Remove the pending turn quietly and keep listening |
| `transcript.final` | live | `utterance_id`, `speaker_id` (`A`, `B` or `null`), `text`, `language`, `language_name` | What was said, in the words and script spoken, its detected language code and English language name |
| `translation.final` | live | `utterance_id`, `speaker_id`, `listener_id`, `target_language`, `text` | The sentence translated into this listener's chosen language |
| `tts.audio` | live | `utterance_id`, `listener_id`, `format` (`wav`), `audio_base64` | The translation spoken in the listener's language, as base64 WAV audio. Only when `server_voice` is `true` |
| `transcript.partial` | 2A | `utterance_id`, `speaker_id`, `text` | Text so far while speaking |

Who spoke is decided by the language heard. A person's language matches when its code or English
name is the same, or, when no code or name matches, when that person's translation is exactly the
words spoken:

- The language matches exactly one person's chosen language: that person is the speaker
  (`speaker_id`), and the other person gets one `translation.final`.
- It matches neither person (a third language): `speaker_id` is `null` and both people get a
  `translation.final` in their own language.
- It matches both people (both chose that language): `speaker_id` is `null` and nobody needs a
  translation, so only `transcript.final` is sent.

After `utterance.received`, each utterance gets exactly one of: `transcript.final` followed by its
`translation.final` messages (if any), `utterance.ignored`, or one `error` carrying its
`utterance_id`. Results arrive in the order the sentences were spoken. At most 5 sentences can
wait for translation at once; more get a retryable `provider_unavailable` error.

Voice, when `server_voice` is `true`: each `translation.final` later gets either one `tts.audio`
or one `voice_unavailable` error for the same `utterance_id` and `listener_id`. When both
people need the same words, the voice is made once and sent to each of them. On
`voice_unavailable`, speak that translation with the browser's own voice if it has one, otherwise
show captions only. Voices arrive in the order the sentences were spoken (a `voice_unavailable` for a full voice queue is sent at once, so it can arrive before earlier voices), and making a voice never
delays the next translation. At most 5 voices can wait at once; more get `voice_unavailable`. On
`session.stop`, voices still being made are finished within the same grace period as translations;
any not ready by then get `voice_unavailable` before the close.

Show `text` fields as plain text, never as HTML: they contain whatever the speaker said.

### Example exchange

```text
-> (binary audio frames, about 100 ms each, continuously)
<- {"type":"utterance.received","seq":2,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","duration_ms":2100}
<- {"type":"transcript.final","seq":3,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","text":"మీరు ఎలా ఉన్నారు?","language":"te","language_name":"Telugu"}
<- {"type":"translation.final","seq":4,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","listener_id":"A","target_language":"en","text":"How are you?"}
<- {"type":"tts.audio","seq":5,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","listener_id":"A","format":"wav","audio_base64":"UklGR..."}
-> {"type":"audio.pause"}
```

## 6. Error codes

| Code | Status | Retryable | When |
| --- | --- | --- | --- |
| `invalid_message` | live | no | Not valid JSON, not an object, missing or unknown `type`, too large, malformed audio frame |
| `unknown_session` | live | no | The session id does not exist, has expired or its channel is already open (then close 4404) |
| `provider_unavailable` | live | depends | Retryable: speech service unreachable, slow, erroring, returned an unreadable answer or did not translate the sentence, or 5 sentences are already waiting behind the one being translated. Not retryable: no key or model set up, key or model rejected, audio could not be processed, or the service refused the sentence |
| `quota_exceeded` | live | yes, later | Free-tier limit reached; try again after a minute |
| `voice_unavailable` | live | no | The server could not make the voice for this translation (free voice limit, service unreachable, too many waiting); use the browser voice or captions only |
| `internal_error` | live | yes | Unexpected server error; details only in the backend log. With an `utterance_id`: only that sentence failed and the connection stays open. With `utterance_id: null`: the live channel failed and closes with 1011 |
