# API and WebSocket protocol (v3)

This file is the contract between the frontend and the backend. Both sides build against it.
**Change it only in a pull request that both developers agree on.**

Status of each item: **live** = implemented on the backend; otherwise the step that adds it.

## 1. REST endpoints

Base address in development: `http://localhost:8000`. Bodies are JSON.
Every error response is `{"detail": "one readable sentence"}` with a 4xx or 5xx status, so the
frontend can show `detail` directly.

| Method and path | Status | Purpose |
| --- | --- | --- |
| `GET /health` | live | Backend is running: `{"status":"ok","version":"0.8.0"}` |
| `GET /api/voices` | live | The natural (Gemini) voices a person can choose, listed live from Google: `{"voices": [{id, display_name, description, gender, language_code, pitch, accent}]}`. Empty when no voice model is set up; `503` when Google cannot be reached or the free limit is used up |
| `POST /api/languages/detect` | live | Find the language spoken in a short recording, for setting up by voice |
| `POST /api/sessions` | live | Start a conversation on one device; returns the session id |
| `POST /api/rooms` | live | Start a conversation across two devices; returns the room id and two tokens |
| `GET /api/rooms/{room_id}` | live | See who is in a room (token in the `X-Room-Token` header) |
| `POST /api/rooms/{room_id}/join` | live | The invited person joins with the guest token |
| `WS /api/rooms/{room_id}/stream?token=` | live | One device's live channel in a two-device conversation |
| `WS /api/sessions/{session_id}/stream` | live | Live channel: audio in, captions and events out |

### Language codes

There is no fixed language list. A language is any ISO 639 code: two letters when one exists,
otherwise three (`te`, `hi`, `en`, `yue`, `fil`). The backend accepts regional forms such as
`pt-BR` or `zh_Hant` and keeps only the language part (`pt`, `zh`). Text that is not a code,
such as `Telugu`, is refused.

The frontend builds the language picker itself from the browser: `Intl.DisplayNames` gives the
name of every code it knows, in English and in the language itself, with no list in our code.

### POST /api/languages/detect

Setting up by voice: each person says a few words and this finds their language. The body is the
raw recording as a WAV file (`Content-Type: audio/wav`): 16-bit PCM, mono, 16 kHz, at most 10 s.
One Gemini request is made; nothing is kept.

| Status | Body |
| --- | --- |
| `200` | `{"language": "te", "language_name": "Telugu"}`: the ISO 639 code and English name of the language heard |
| `413` | The recording is longer than 10 seconds |
| `422` | Not a WAV file, or no speech was heard |
| `429` | The free speech service limit was reached |
| `503` | Detection is not set up (`GEMINI_API_KEY`, `GEMINI_MODEL`) or the speech service failed |

### POST /api/sessions

Request:

```json
{
  "consent": true,
  "mode": "together",
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
  "mode": "together",
  "participants": [ "...same as sent, ordered A then B..." ],
  "created_at": "2026-10-18T09:30:00Z"
}
```

Rules (otherwise `422` with a readable `detail`):

- `consent` must be `true`.
- `mode`: `together` (default; two people share one microphone) or `call` (section 7). `call` needs
  the server voice; without it the response is `503` with a readable `detail`.
- Exactly two participants, ids `A` and `B`, one each.
- `name`: 1 to 40 characters after trimming spaces.
- `preferred_language`: a language code (see Language codes). Both people may choose the same language.
- No extra fields.

Sessions are held in memory only until used. A session's live channel opens once: the session leaves memory as soon as its channel opens, so a second connection, or reconnecting after the channel closes, gets `unknown_session`; start a new session instead. A session that is never opened expires 10 minutes after it was created. At most 100 sessions can wait to be opened; beyond that `POST /api/sessions` returns `503` with a readable `detail`.

### Conversations across two devices (rooms)

Person A starts a room and shares an invite link (`<app address>/#join/<room_id>/<guest_token>`).
Person B opens it on their own phone or computer. Each device then opens its own live channel with
its own token, sends only its own microphone, and hears only the translations meant for it.
The invite link works once: joining returns a new token for the guest's device and the invite
token stops working, so a forwarded link cannot be used to listen in. Rooms live in memory only: a
room nobody joined expires after 10 minutes, a joined room with no device connected after 30, and a
room is removed once both devices have connected and left. At most 100 rooms can wait at once.

| Request | Body | Answers |
| --- | --- | --- |
| `POST /api/rooms` | `{"consent": true, "host": {"name", "preferred_language"}}` | `201` `{room_id, host_token, guest_token, host, guest: null}`; `422` bad body; `503` too many waiting rooms |
| `GET /api/rooms/{room_id}` with header `X-Room-Token` | none | `200` `{room_id, host, guest}` (`guest` is `null` until someone joins); `403` wrong token; `404` unknown or expired |
| `POST /api/rooms/{room_id}/join` | `{"consent": true, "token": guest_token, "guest": {"name", "preferred_language"}}` | `200` as GET plus `token`, the guest device's own token (the guest is participant `B`); `403` not the invite token; `404`; `409` someone already joined; `422` same language as the host or bad body |

`WS /api/rooms/{room_id}/stream?token=` works like the session stream, with these differences:

- Before the guest has joined it sends a `not_joined` error and closes with `4409`. A wrong or used
  token closes with `4401`; a token whose device is already connected gets `unknown_session` and
  `4404`. The token is part of the address, so share the app only over https (the tunnel does).
- `session.ready` has `mode: "remote"` and `you`: `A` or `B`, the person on this device.
- Audio frames are plain PCM (no source tag). Whatever this device hears is this person speaking;
  the translation, and its voice, are made for the other person.
- Both devices get `utterance.received`, `transcript.final`, `translation.final`,
  `utterance.ignored`, `speech.activity` and sentence errors. `tts.audio` and `voice_unavailable`
  go only to the listener's device. Everything else (`session.ready`, `pong`, other errors) goes
  only to the device it concerns.
- `voice.settings` sets whether, and in which voice, the server makes voices for this device's own person.
- `language.set` changes this device's person's language; both devices get `participants.updated`.
- When one device leaves, the other gets `{"type": "peer.left", "participant_id": "A" | "B"}`.

When the backend serves the built frontend (`frontend/dist`, at `/`), the app and the API share one
address, so a free tunnel such as `cloudflared tunnel --url http://localhost:8000` gives both
devices a single https link. Live channels accept `FRONTEND_ORIGIN` and pages from the same
address as the backend.

## 2. WebSocket connection

- URL: `ws://localhost:8000/api/sessions/{session_id}/stream`.
- Text frames are JSON objects with a string `type`. Maximum 64 KB per text message.
- The server is started with `--ws-max-size 65536`, so any single message over 64 KB closes the
  connection.
- Binary frames are microphone audio (section 4); in call mode each starts with a one-byte source tag (section 7).
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
| `audio.pause` | live | `participant_id` (optional, call mode only) | The browser stopped sending audio (for example while a translation is being spoken). Any sentence in progress ends now; in call mode, only that side's sentence when `participant_id` is given (`A` or `B`; anything else gets `invalid_message`; absent or `null` ends both) |
| `voice.settings` | live | `listener_id` (`A` or `B`), `server_voice` (`true` or `false`), `voice` (optional: a voice `id` from `GET /api/voices`, or `null` for automatic) | Whether the server should make voices for this listener, and in which voice. Send `false` when that person chose the browser's own voice or turned their voice off; the server then sends no `tts.audio` for them. Leaving `voice` out keeps the earlier choice. Every listener starts at `true` and automatic. A bad listener, a value that is not a boolean, or a voice that is not 1 to 64 letters, digits, `_` or `-` gets `invalid_message` |
| `language.set` | live | `participant_id` (`A` or `B`; ignored across two devices, where it is always this device's person), `language` | Change that person's language during the conversation. The next sentence is translated into it, and every device gets `participants.updated`. A bad code, a missing person, or the other person's language gets `invalid_message` |
| `ping` | live | none | Keep-alive; answered with `pong` |
| `session.stop` | live | none | End the conversation. A sentence in progress is ended and translated; sentences already received are finished first, for up to the speech timeout plus 5 s in total; any still unfinished then get a `provider_unavailable` error. Then the server closes with 1000 |

Listening is hands-free: there are no talk buttons. The browser streams the microphone and the
server finds each sentence by itself. A sentence starts when speech is heard (about 0.3 s of the
quiet before it is kept so the first word is not cut), ends after about 1 s of silence, and is
split at 30 s if nobody pauses. Silence and short noises are not sent anywhere. The server learns
the room's steady background sound (a fan, traffic) and only counts sound clearly louder than it as
speech; a sound that never stops is treated as background within a few seconds.

While a translation is being spoken aloud, the browser sends `audio.pause` and stops sending audio,
so the app never hears itself; it resumes sending frames when playback ends. So that this never
cuts anyone off, the browser does not start a voice while `speech.activity` says someone is
speaking: it waits until they stop (at most 15 s).

## 4. Audio format

| Property | Value |
| --- | --- |
| Encoding | PCM, signed 16-bit, little-endian |
| Channels | 1 (mono) |
| Sample rate | 16,000 Hz |
| Frame size | About 100 ms: 1,600 samples = 3,200 bytes per binary message. Must be a non-empty even number of bytes and at most 32,000 bytes (1 s), otherwise `invalid_message` and that frame is dropped. In call mode the one-byte source tag comes first and is not counted |

## 5. Server to browser messages

All include `type` and `seq`.

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `session.ready` | live | `session_id`, `participants`, `server_voice`, `mode` | Live channel is open. `server_voice: true` means the server sends `tts.audio` for translations; `false` means the browser speaks translations itself |
| `pong` | live | none | Answer to `ping` |
| `error` | live | `code`, `message`, `retryable`, `utterance_id` (or `null`); `voice_unavailable` also has `listener_id` | Show `message` to the user |
| `utterance.received` | live | `utterance_id`, `speaker_id` (`A`, `B`, or `null` until known), `duration_ms` | The server heard a sentence and is processing it. `utterance_id` is made by the server. In call mode `speaker_id` is already known from the audio source |
| `speech.activity` | live | `speaker_id` (`null` in together mode, the source in call mode), `active` | Someone started (`true`) or stopped (`false`) speaking. Sent only when it changes. `false` also follows `audio.pause` or `session.stop` when a sentence was in progress |
| `participants.updated` | live | `participants` | Someone changed their language. Use these people from now on |
| `utterance.ignored` | live | `utterance_id` | No words were recognised (noise, coughing). Remove the pending turn quietly and keep listening |
| `transcript.final` | live | `utterance_id`, `speaker_id` (`A`, `B` or `null`), `text`, `language`, `language_name` | What was said, in the words and script spoken, its detected language code and English language name |
| `translation.final` | live | `utterance_id`, `speaker_id`, `listener_id`, `target_language`, `text` | The sentence translated into this listener's chosen language |
| `tts.audio` | live | `utterance_id`, `listener_id`, `format` (`wav`), `audio_base64` | The translation spoken in the listener's language, as base64 WAV audio. Only when `server_voice` is `true` |
| `transcript.partial` | 2A | `utterance_id`, `speaker_id`, `text` | Text so far while speaking |

In together mode, who spoke is decided by the language heard (in call mode the speaker is the audio source, section 7). A person's language matches when its code is the same,
or when a two-letter and a three-letter code have the same English name (`te` and `tel`). When no
person matches that way, the model's own answer decides, which covers one language known by two
names (`tl` Tagalog and `fil` Filipino):

- The language matches exactly one person's chosen language: that person is the speaker
  (`speaker_id`), and the other person gets one `translation.final`.
- It matches neither person (a third language): `speaker_id` is `null` and both people get a
  `translation.final` in their own language.
- It matches both people (both chose that language): `speaker_id` is `null` and nobody needs a
  translation, so only `transcript.final` is sent.

When a sentence repeats a translation sent in the last 12 s (the app hearing its own voice through
the speakers), it gets `utterance.ignored` instead of being translated again, so the voice never
bounces back and forth. It counts as a repeat only when it is nearly all of that translation
(80% or more of its letters, or of its words when it has at least three), so a short real reply
such as "no" is still translated.

After `utterance.received`, each utterance gets exactly one of: `transcript.final` followed by its
`translation.final` messages (if any), `utterance.ignored`, or one `error` carrying its
`utterance_id`. Results arrive in the order the sentences end (in call mode, when one `audio.pause` or `session.stop` ends both sides at once, A's comes first). A translation that only repeats the words
spoken (apart from a single short word such as a name or "No.") is refused as a retryable
`provider_unavailable` error. At most 5 sentences can
wait for translation at once; more get a retryable `provider_unavailable` error straight away, so
that error can arrive before the results of earlier sentences.

Voice, when `server_voice` is `true`: each `translation.final` for a listener whose
`voice.settings` is `true` later gets either one `tts.audio` or one `voice_unavailable` error for
the same `utterance_id` and `listener_id`. The browser's own voice starts at once while the
server's takes a few seconds to make, so the browser speaks a language itself when it has a voice
for it and sends `voice.settings` with `false` for that listener, which also saves the free voice
limit. When both
people need the same words, the voice is made once and sent to each of them. On
`voice_unavailable`, speak that translation with the browser's own voice if it has one, otherwise
show captions only. Voices arrive in the order the sentences end (a `voice_unavailable` for a full voice queue is sent at once, so it can arrive before earlier voices), and making a voice never
delays the next translation. At most 5 voices can wait at once; more get `voice_unavailable`. On
`session.stop`, voices still being made are finished within the same grace period as translations;
any not ready by then get `voice_unavailable` before the close.

Show `text` fields as plain text, never as HTML: they contain whatever the speaker said.

### Example exchange

```text
-> (binary audio frames, about 100 ms each, continuously)
<- {"type":"utterance.received","seq":2,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":null,"duration_ms":2100}
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

## 7. Call mode (live)

Call mode translates a call that runs in a browser tab: Google Meet, or Zoom and Teams on the web.
Desktop call apps have no tab to capture and are not supported.
Person A is the user of this device; Person B is the other person on the call. Both must agree to
the call being translated by an online service before it starts.

- Create the session with `"mode": "call"`. `session.ready` then has `mode: "call"`. Call mode
  needs the server voice: without `GEMINI_TTS_MODEL` the request gets `503` with a readable
  `detail`.
- The browser sends two audio sources on the same live channel: this device's microphone (A) and
  the call's sound (B, captured from the call's browser tab). Every binary frame starts with one
  byte naming its source, `A` (0x41) or `B` (0x42), followed by audio in the format of section 4.
  A frame with any other first byte, or with no audio after it, gets `invalid_message`.
- Each source is listened to separately, so both people can be heard at the same time.
  `audio.pause` with `participant_id` ends that side's sentence; without it, both.
- The speaker is the source, never guessed from the language: `speaker_id` is set from the first
  `utterance.received`. The other person gets a `translation.final` and a voice for every
  sentence, even when they chose the language spoken (then the text is the words spoken), because
  they hear the user only through the voice. The speaker gets no translation of their own words.
- Voices: a `tts.audio` for listener A plays on this device (headphones); a `tts.audio` for
  listener B is played into a virtual microphone that the call app uses, so the other person
  hears only the translation, in their language. The browser chooses the output device; the
  server is not involved. The browser's own voice cannot be sent to a chosen device, so a
  `voice_unavailable` for listener B means the other person did not hear that sentence: show it
  on the turn. Free voice limits are low, so this can happen in long calls.
- Wear headphones: otherwise the call's sound reaches the microphone and is translated twice.
- Unlike together mode, do not send `audio.pause` while voices play: with headphones nothing
  echoes, and pausing would cut off the other side. Both sources stream for the whole call.
- The other person should also use headphones or echo cancellation, or the translated voice can
  come back through the call and be translated again.
- A sentence is ready after the pause that ends it (about 1 s) plus the translation (a median of
  about 2.5 s in the benchmark), and its voice follows, so the call works turn by turn.
