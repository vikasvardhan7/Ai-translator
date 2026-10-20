# API and WebSocket protocol (v3)

This file is the contract between the frontend and the backend. Both sides build against it.
**Change it only in a pull request that both developers agree on.**

Status of each item: **live** = implemented on the backend; otherwise the step that adds it.

## 1. REST endpoints

Base address in development: `http://localhost:8000`. Bodies are JSON.
Every error response is `{"detail": "one readable sentence"}` with a 4xx or 5xx status, so the
frontend can show `detail` directly.

### Who may use the API (accounts, host key)

A person signed in to an account (section "Accounts" below) may make every request below except
managing API keys; their requests are counted against their account (30 a minute and 300 a day,
`USER_REQUESTS_PER_MINUTE` and `USER_REQUESTS_PER_DAY`), as is every sentence translated in a
conversation or call they started. The person on the backend's own computer, or with the host key,
is never limited.

The backend prints a host key when it starts (`Host key: ABCD-EF23-GH45`), new on every start and
kept only in memory. Requests from the same computer (a loopback client address with a `localhost`
host and no proxy headers) are the host automatically, unless `HOST_KEY_EVERYWHERE=true` is set in
`backend/.env`. Set that whenever something other than cloudflared forwards requests from the same
computer without adding `X-Forwarded-For` (a bare nginx `proxy_pass`, an SSH tunnel), because
such requests look local. Through a tunnel or any other address, the requests that spend the
Gemini quota need the key in an `X-Host-Key` header (case, spaces and dashes do not matter):
`POST /api/sessions`, `POST /api/rooms`, `POST /api/languages/detect`, `GET /api/voices` and
`POST /api/assistant`, as do joining a call or a scheduled meeting and looking at a meeting
(`POST /api/rooms/{id}/join`, `POST /api/meetings/{id}/join`, `GET /api/meetings/{id}`). Without
it, and without a signed-in account, they answer `401` with a `detail` that starts with
"Sign in first". An invite token alone never lets anyone in: invited people sign in or create an
account first, then join with the invite token. `GET /api/access` answers `{"host": true | false}` for the caller, so the
app can ask for the key only when it is needed.

Other apps use an API key instead (see [API.md](API.md)): an `X-Api-Key` header with a key made in
the Developers app works like the host key for those five requests, from anywhere, and a wrong or
revoked key answers `401` even from the backend's own computer. Each key may make 60 requests a
minute and its own number a day; the host has no limit.
Every sentence translated in a conversation or call started with a key also counts against it.
Past a limit the answer is `429` with a `Retry-After` header in seconds, and on the live channel a
`quota_exceeded` error for that sentence. Keys are managed only by the host, never with a key or an
account; scheduled meetings belong to the account that made them (the host without an account sees
the meetings made that way), never to a key.

| Method and path | Status | Purpose |
| --- | --- | --- |
| `GET /health` | live | Backend is running: `{"status":"ok","version":"0.9.0"}` |
| `GET /api/access` | live | Whether this caller is the host: `{"host": true}` from the backend's own computer or with the right `X-Host-Key`, otherwise `{"host": false}` |
| `GET /api/voices` | live | The natural (Gemini) voices a person can choose, listed live from Google: `{"voices": [{id, display_name, description, gender, language_code, pitch, accent}]}`. Empty when no voice model is set up; `503` when Google cannot be reached or the free limit is used up |
| `POST /api/assistant` | live | Answer a question about the conversation so far (signed in, or host key); see below |
| `POST /api/languages/detect` | live | Find the language spoken in a short recording, for setting up by voice (signed in, or host key) |
| `POST /api/sessions` | live | Start a conversation on one device, or a meeting; returns the session id (host key) |
| `POST /api/rooms` | live | Start a call that up to 6 people join from their own devices; returns the room id, the host's token and the invite token (host key) |
| `POST /api/meetings`, `GET /api/meetings` | live | Schedule a meeting, list your upcoming ones (signed in, or the host); see "Scheduled meetings" |
| `/api/account/...` | live | Sign up, sign in, sign out, reset or change the password, rename, delete; see "Accounts" |
| `/api/trainer/...` | live | Gym Trainer: profile, targets, plans, daily tracking, progress, coach (signed in); see "Gym Trainer" |
| `GET /api/keys` | live | The API keys (name, first characters, daily limit, used today, made, last used) and the public address other sites reach: `{"keys": [...], "public_url", "public_url_problem"}` (host only) |
| `POST /api/keys` | live | Make a key: `{"name": "1 to 60 characters", "daily_limit": 10 to 100000}` (default 1000); answers `201` `{"key": {...}, "secret": "vt_..."}`, the only time the key itself is shown; `409` past 100 keys (host only) |
| `DELETE /api/keys/{id}` | live | Revoke a key at once; `204`, `404` unknown (host only) |
| `GET`/`DELETE /api/meetings/{id}`, `POST .../start`, `POST .../join` | live | Look at, cancel, start or join a scheduled meeting (token in `X-Meeting-Token` or the body) |
| `GET /api/rooms/{room_id}` | live | See who is in a room (token in the `X-Room-Token` header) |
| `DELETE /api/rooms/{room_id}` | live | Leave a room from outside its live channel (own token in `X-Room-Token`): the host ends it for everyone, a guest leaves alone; the others get `peer.left`. `204`, `403` wrong token, `404` |
| `POST /api/rooms/{room_id}/join` | live | The invited person joins with the guest token |
| `WS /api/rooms/{room_id}/stream?token=` | live | One device's live channel in a two-device conversation |
| `WS /api/sessions/{session_id}/stream` | live | Live channel: audio in, captions and events out |

Every voice request to Gemini (speech, translation, voice) is tried again up to three times when
Gemini is busy (`429` with a suggested wait of at most 8 s, or none), has a server problem or
cannot be reached. It waits the suggested time, or 0.5, 1 and then 2 s, and gives up once the waits
would add up to more than 12 s; a longer suggested wait, a bad request or a slow answer is not
retried.

### POST /api/assistant

The Assistant app answers anything, searches the web when it needs to, knows what has been said
in the running call and carries out app commands. The browser sends the chat so far, the reader's
language, the transcript it shows and the commands possible right now; the server keeps none of it.

```json
{
  "messages": [
    { "role": "user", "text": "Mute me and summarise the meeting" }
  ],
  "language": "te",
  "transcript": [
    { "speaker": "Meeting", "text": "We close the budget next week." },
    { "speaker": "You", "text": "I will send the numbers on Monday." }
  ],
  "actions": ["open_app", "close_app", "mute", "show_transcript", "end_conversation"]
}
```

- `messages`: 1 to 30, oldest first, `role` `user` or `assistant`, `text` 1 to 4000 characters;
  the last one is the person's. `language`: an ISO 639 code, used when the person's own language
  is unclear. `transcript`: at most 400 lines (`speaker` 1 to 40 characters, `text` 1 to 2000),
  the latest 60 000 characters are used. `actions`: the command names the app can carry out now
  (unknown names are ignored). `now`: the person's local date and time with its offset, so
  "tomorrow at 5" is understood. Anything else, or an unknown field, gets `422`.
- `200` gives `{"answer": "...", "actions": [{"name": "mute", "arguments": {}}], "sources":
  [{"title": "...", "url": "https://..."}]}`. `answer` may be empty when only actions were taken.
  Every action is checked on the server: only names that were offered, with allowed arguments.
- Commands: `open_app` and `close_app` (`app`: `translator`, `meetings`, `assistant`, `personalize`,
  `help`, `privacy`, `terms`), `start_conversation` (`where`: `here`, `remote`, `meeting`; the person still presses
  the start button and says hello), `mute`, `unmute`, `voice_on`, `captions_only`,
  `connect_meeting_sound` (the person then presses Connect meeting, because the browser asks for
  the tab only after a click), `disconnect_meeting_sound`, `show_transcript`, `hide_transcript`,
  `open_settings`, `show_people` (in a room: who is there and the invite link), `set_theme`
  (`theme`: `ocean`, `sunset`, `mint`, `blossom`, `aurora`), `schedule_meeting` (`title`, `starts_at`
  with a time zone, `duration_minutes` 15 to 120, optional `agenda`), `download_transcript` (`format`: `text` or `subtitles`), `set_my_language`
  (`language`: an ISO 639 code) and `end_conversation`.
- One Gemini request decides between answering, taking actions and searching. A question that
  needs the web gets a second request with Google Search grounding, and its web sources come back
  in `sources` (https links only, at most 6). Instructions spoken in the meeting are never
  followed.
- `503` with a `detail` when no `GEMINI_API_KEY` and model are set, the free limit is reached, or
  Gemini cannot be reached. The model is `GEMINI_ASSISTANT_MODEL`, or `GEMINI_MODEL` when that is
  empty; each request is tried again like the other Gemini requests.

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
- `mode`: `together` (default; two people share one microphone) or `call` (a meeting, section 7).
- `together`: exactly two participants, ids `A` and `B`, one each. `call`: exactly one, id `A`.
- `name`: 1 to 40 characters after trimming spaces.
- `preferred_language`: a language code (see Language codes). Both people may choose the same language.
- No extra fields.

Sessions are held in memory only. A session leaves memory when its live channel ends with `session.stop`, or 10 minutes after it was created or its channel dropped without a device coming back. At most 100 sessions can wait for a device at once; beyond that `POST /api/sessions` returns `503` with a readable `detail`.

### Calls across devices (rooms, up to 6 people)

The host (participant `A`) starts a room and shares one invite link
(`<public address>/#join/<room_id>/<invite_token>`). Up to five more people open it on their own
phone or computer; each gets the next free id, `B` to `F`, in the order they join. `public_url` is
the address the link must use: `PUBLIC_URL` from `backend/.env` when set; otherwise, when the
request came through a tunnel or proxy, the address the page was opened from; otherwise, from a
page on this computer, the backend starts `cloudflared tunnel --url http://localhost:<port>`
itself (once, kept for as long as the backend runs; `CLOUDFLARED_PATH` names the program when it
is not on the PATH or where winget puts it) and answers with the `https://...trycloudflare.com`
address it printed, waiting up to 25 s for it. When there is no public address, `public_url` is
`null` and `public_url_problem` says why in one sentence (cloudflared not installed, the frontend
not built so the backend cannot serve the app, or the tunnel did not start); the link then only
works on this computer.

The host goes into the call at once and waits there; people join while it runs. Each device opens
its own live channel with its own token, sends only its own microphone, and hears only the
translations meant for it. The invite token is for joining only: it never opens a live channel,
and joining returns the device's own token. A guest who leaves (`session.stop` or `DELETE`) is
gone for good: their place is not given to anyone else, so names in the transcript stay right.
The call ends for everyone when the host leaves. Rooms live in memory only: a room nobody joined
expires after 10 minutes, a joined room with no device connected after 30, and an ended room is
removed as soon as no device is connected to it. A device whose connection drops may come back
with the same token for as long as the room lasts. At most 100 rooms can wait at once.

| Request | Body | Answers |
| --- | --- | --- |
| `POST /api/rooms` | `{"consent": true, "host": {"name", "preferred_language"}}` | `201` `{room_id, host_token, invite_token, host, guests: [], max_people: 6, public_url, public_url_problem}`; `422` bad body; `503` too many waiting rooms |
| `GET /api/rooms/{room_id}` with header `X-Room-Token` | none | `200` `{room_id, host, guests, max_people}` for the host, a guest or the invite token; `403` wrong token; `404` unknown or expired |
| `DELETE /api/rooms/{room_id}` with header `X-Room-Token` | none | `204`. With the host token the room ends and every connected device gets `peer.left` for `A`. With a guest's token that guest leaves; the others get `peer.left` and `participants.updated`. `403` wrong token; `404` |
| `POST /api/rooms/{room_id}/join` | `{"consent": true, "token": invite_token, "guest": {"name", "preferred_language"}}` | `200` as GET plus `token` (this device's own) and `you` (its id, `B` to `F`); every connected device gets `participants.updated`. `403` not the invite token; `404` unknown or ended; `409` full (6 people) or no places left; `422` bad body |

`WS /api/rooms/{room_id}/stream?token=` works like the session stream, with these differences:

- A wrong, used or empty token closes with `4401`; an ended room gets `unknown_session` and
  `4404`. When a token's device connects while an older connection with the same token is still
  open, the new one takes over and the old one is closed with `4410`, so a page that lost its
  network can come straight back. The token is part of the address, so share the app only over
  https (the tunnel does); the backend hides tokens and session ids in its own request log.
- `session.ready` has `mode: "remote"`, `you` (the person on this device) and `connected`, the ids
  of the devices connected right now.
- Audio frames are plain PCM (no source tag). Whatever this device hears is this person speaking.
  Each sentence is translated once into every language in the call and sent with the speaker's
  own chosen language as a hint, so it is recognised well; each other person gets the
  translation, and its voice, in their own language.
- Every device gets `utterance.received`, `transcript.final`, `translation.final` (one per
  listener), `utterance.ignored`, `speech.activity` and sentence errors. `tts.audio` and
  `voice_unavailable` go only to the listener's device. Everything else (`session.ready`, `pong`,
  other errors) goes only to the device it concerns.
- `voice.settings` sets whether, and in which voice, the server makes voices for this device's own person.
- `language.set` changes this device's person's language; every device gets `participants.updated`.
- When someone leaves with `session.stop`, the others get `{"type": "peer.left", "participant_id": "B"}`; for a guest they also get `participants.updated`, and for the host (`A`) the call has ended. When a device's connection drops or goes quiet, the others get `peer.disconnected`, and `peer.connected` when it is back (or when it connects for the first time), with the same field.

### Scheduled meetings

A host plans a meeting ahead: a title, a start time, how long it lasts (5 to 480 minutes) and an
optional agenda. The backend keeps only these, the host's name and two tokens in a small SQLite
file on its own computer (`backend/data/meetings.db`, or `MEETINGS_FILE`), never audio, captions
or transcripts. A meeting is dropped 7 days after it ended; at most 500 are kept. The join link is
`<public address>/#meet/<id>/<invite_token>`; send it any way (copy, share, email, calendar).
When the host starts the meeting it becomes a room (section above) for up to 6 people; anyone who
opened the link early waits in a lobby and joins as soon as it is live.

| Request | Body | Answers |
| --- | --- | --- |
| `POST /api/meetings` (signed in or host) | `{"title", "starts_at" (with a time zone), "duration_minutes", "agenda", "host_name"}` | `201` the meeting with `host_token`, `invite_token`, `public_url`, `public_url_problem`; `422` bad body (no time zone, more than 12 hours in the past or a year ahead, too long); `503` too many |
| `GET /api/meetings` (signed in or host) | none | `200` `{meetings: [...], public_url, public_url_problem}`: those not yet over, soonest first, with their tokens |
| `GET /api/meetings/{id}` with `X-Meeting-Token` (invite or host) | none | `200` `{id, title, starts_at, duration_minutes, agenda, host_name, status, people}` (`status` is `upcoming`, `live` or `ended`; no tokens); `403`; `404` |
| `DELETE /api/meetings/{id}` with the host token | none | `204`; a live meeting ends for everyone (`peer.left` for `A`); `403`; `404` |
| `POST /api/meetings/{id}/start` with the host token | `{"consent": true, "host": {"name", "preferred_language"}}` | `200` as `POST /api/rooms` (the host's room token and the room); starting again while it is live gives the same room. `410` more than 2 hours after it ended |
| `POST /api/meetings/{id}/join` | `{"consent": true, "token": invite_token, "guest": {"name", "preferred_language"}}` | `200` as `POST /api/rooms/{room_id}/join`; `409` not started yet (wait and try again) or full; `410` over; `403`; `404` |

Before joining, an invited guest signs in and finds their language with
`POST /api/languages/detect` like anyone else. With a quick tunnel the public address changes each
time the backend starts, so a link sent earlier stops working after a restart; the Meetings app
always shows the current link to send again, and `PUBLIC_URL` gives a fixed address.

### Accounts

People sign up with their email, a 6-digit code sent to it and a password, then sign in with the
email and password. Everything is kept in `backend/data/accounts.db` (or `ACCOUNTS_FILE`):
email, name, the password as an scrypt fingerprint (`n=2^14, r=8, p=1`, 16-byte salt), codes and
sign-in tokens as SHA-256 fingerprints. Codes are emailed through SMTP (`SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`); without them `POST /api/account/code`
answers `503`. A code works once, for 10 minutes, with 5 tries; a new one can be asked for after
60 s. At most 10 000 accounts.

Signing up, signing in and resetting set an HttpOnly cookie `vt_session` (SameSite=Lax, Secure over
https, path `/`) with no expiry date, so it ends when the browser closes; the backend also ends a
sign-in after 12 hours without use. The browser sends it with
`credentials: 'include'`; the backend allows credentials from `FRONTEND_ORIGIN`. A request
without a valid cookie on a route that needs an account answers `401` "Sign in first."

Limits: per device address 20 a minute and 300 a day across these routes; per email address 10
code requests a minute and 40 a day, and 5 sign-in attempts a minute and 30 a day. Past a limit:
`429` with `Retry-After`.

| Request | Body | Answers |
| --- | --- | --- |
| `GET /api/account` | none | `200` `{id, email, name, created_at, owner}` (`owner` is true on the backend's own computer or with the host key); `401` |
| `POST /api/account/code` | `{"email", "purpose": "sign_up" \| "reset"}` | `202` `{sent, resend_after, expires_in}`. For `sign_up` with an email that already has an account, an email says so instead of a code; for `reset` with an unknown email nothing is sent; both answer the same `202`, so nobody learns which emails have accounts. `429` asked again within 60 s; `503` email not set up or not sent |
| `POST /api/account/sign-up` | `{"email", "name" (1 to 40), "code", "password" (8 to 128, not the email)}` | `201` the account and the cookie; `400` wrong or expired code; `409` the email already has an account; `503` account limit |
| `POST /api/account/sign-in` | `{"email", "password"}` | `200` the account and the cookie; `401` "The email or the password is wrong." for either mistake |
| `POST /api/account/reset` | `{"email", "code", "password"}` | `200` the account and a new cookie; every other sign-in ends; `400` wrong code |
| `POST /api/account/sign-out` | none | `204`; the cookie is removed and its token stops working |
| `PUT /api/account/password` (signed in) | `{"current", "password"}` | `200` and a new cookie; every other sign-in ends; `401` wrong current password |
| `PUT /api/account/name` (signed in) | `{"name"}` | `200` the account |
| `POST /api/account/delete` (signed in) | `{"password"}` | `204`; the account, its sign-ins, its scheduled meetings and its Gym Trainer data are deleted; `401` wrong password |

Invite links (`#join/...`, `#meet/...`) show the sign-in screen first and join the call once the
person is signed in. Only the website widget works without an account, because it uses an API key.

### Gym Trainer

Every request needs a signed-in account and sees only that account's data, kept in
`backend/data/trainer.db` (or `TRAINER_FILE`). Requests that use the AI (making plans, foods,
coach) count against the account's limit and answer `503` when no Gemini model is set up, `502`
when Gemini gave no usable answer. They use `GEMINI_ASSISTANT_MODEL`, or `GEMINI_MODEL`, with
JSON-schema output (plans, foods) and function calling (coach); everything the model returns is
checked against the same models as a person's own edits.

Workout plans choose exercises from the exercise library: the AI is given the exercises the
person's equipment allows (id, name, equipment, main muscles) and returns each one's `library_id`.
Any exercise without a known id, including ones typed in by hand, is matched to the library by its
name (shared words, preferring the person's equipment and common equipment); `library_id` is empty
when nothing matches. The library is the Free Exercise DB, read from `EXERCISE_LIBRARY_URL` once a
day and kept in memory (the last good copy is kept when a refresh fails); image addresses start with
`EXERCISE_IMAGES_URL`.

Meal photos that no logged meal uses are deleted a day after they were added.

Daily targets come from the profile, not from the AI: Mifflin-St Jeor resting calories times an
activity factor (1.2, 1.375, 1.55 or 1.725), then -20 % to lose fat (never below resting calories,
and never below what a person under 18 burns), +10 % to build muscle, +5 % to get stronger or for
endurance; protein 1.4 to 2.0 g per kg by goal, fat 25 % of calories, carbohydrate the rest, water
35 ml per kg rounded to 250 ml.

| Request | Body | Answers |
| --- | --- | --- |
| `GET /api/trainer` | none | `{profile, targets, workout, diet, coach_ready}` (each `null` until made) |
| `PUT /api/trainer/profile` | `{name, age (14 to 90), sex, height_cm, weight_kg, target_weight_kg, goal, level, activity, days_per_week, minutes_per_session, equipment, diet, cuisine, meals_per_day, allergies, health_notes}` | the same as `GET` |
| `POST /api/trainer/plans/workout` or `/diet` | `{"wishes" (0 to 300), "day": null \| "monday"...}` | the same as `GET`, with the new week, or only that day remade; `409` no profile yet |
| `PUT /api/trainer/plans/workout` | `{summary, days: [7 x {day, focus, rest, warmup, exercises: [{name, sets, reps, rest_seconds, how}], cooldown}]}` | the same as `GET`; `422` not exactly one entry per weekday |
| `PUT /api/trainer/plans/diet` | `{summary, days: [7 x {day, meals: [{name, time, items: [{food, amount, calories, protein_g, carbs_g, fat_g}]}]}]}` | as above |
| `GET /api/trainer/days/{YYYY-MM-DD}` | none | `{day, entries: [{id, day, data, created_at}], summary}`; days from five years ago to tomorrow |
| `POST /api/trainer/days/{YYYY-MM-DD}/entries` | `{"data": one of the entries below}` | `201` the entry; `409` more than 300 entries that day |
| `DELETE /api/trainer/entries/{id}` | none | `204`; `404` not yours or gone |
| `GET /api/trainer/progress?until=YYYY-MM-DD&days=30` | none | `{days: [summary, ...]}`, one per day (1 to 366 days), oldest first |
| `POST /api/trainer/foods` | `{"text": "2 dosa and coconut chutney"}`, or `{"photo_id", "text"}` with a meal photo (the text is optional then) | `{items: [{food, amount, calories, protein_g, carbs_g, fat_g}]}` (nothing is logged until the browser adds it, with the meal's `photo_id`) |
| `POST /api/trainer/coach` | `{messages: [{role: "user" \| "assistant", text}] (1 to 30), day, now}` | `{answer, logged: [entry, ...], actions: [...]}`; what the coach logged is stored for `day`; the chat itself is not kept. `actions` (at most 3) ask the app to show an exercise (`{"kind": "show_exercise", "exercise_id", "query"}`, `exercise_id` null when the library has no match, then the app searches for `query`), start today's guided workout (`{"kind": "start_workout"}`) or open a page (`{"kind": "open", "page": "today" \| "workouts" \| "diet" \| "progress" \| "exercises" \| "profile"}`) |
| `GET /api/trainer/exercises` | none | `{exercises: [{id, name, equipment, category, level, primary, secondary, images}], source}`: the whole exercise library; `503` when it cannot be read |
| `GET /api/trainer/exercises/{id}` | none | the same plus `force`, `mechanic` and `instructions` (steps); `404` unknown |
| `POST /api/trainer/photos?day=YYYY-MM-DD&kind=meal\|body` | the picture's bytes (`image/jpeg`, `image/png` or `image/webp`, at most 3 MB) | `201` `{id, day, kind, created_at, size}`; `413` too big; `415` not a picture; `409` more than 30 that day or 600 in all |
| `GET /api/trainer/photos?kind=body` | none | `{photos: [...]}`, newest first |
| `GET /api/trainer/photos/{id}` | none | the picture (`Cache-Control: private`); `404` not yours |
| `DELETE /api/trainer/photos/{id}` | none | `204`; `409` while a logged meal uses it (removing the meal removes the photo) |
| `GET /api/trainer/export` | none | `{exported_at, profile, workout, diet, entries, photos}` (photos as their details; each picture is at its address) |
| `DELETE /api/trainer` | none | `204`; profile, plans and every entry are deleted |

Entries (`data`): `{"kind": "exercise", name, sets, reps, weight_kg, minutes}`,
`{"kind": "meal", meal, food, calories, protein_g, carbs_g, fat_g, photo_id}` (`photo_id` is
optional and must be one of your own meal photos), `{"kind": "water", ml}`,
`{"kind": "weight", kg}`, `{"kind": "sleep", hours}`, `{"kind": "steps", count}`,
`{"kind": "note", text}`. A day's `summary` adds them up: `{day, calories, protein_g, carbs_g,
fat_g, water_ml, exercises, sets, weight_kg (the last), sleep_hours, steps (the highest)}`.

When the backend serves the built frontend (`frontend/dist`, at `/`), the app and the API share one
address, so a free tunnel such as `cloudflared tunnel --url http://localhost:8000` gives both
devices a single https link. Live channels accept `FRONTEND_ORIGIN` and pages from the same
address as the backend.

## 2. WebSocket connection

- URL: `ws://localhost:8000/api/sessions/{session_id}/stream`.
- Text frames are JSON objects with a string `type`. Maximum 64 KB per text message.
- The server is started with `--ws-max-size 65536`, so any single message over 64 KB closes the
  connection.
- Binary frames are microphone audio (section 4); in a meeting each starts with a one-byte source tag (section 7).
- The browser pings every 5 s and treats 30 s without any message as a dropped connection. A
  connection that sends nothing for 45 s is closed with `4408`, so a device that silently lost its
  network is noticed; the browser then reconnects by itself. Messages for the other device in a
  room are queued (at most 200) and delivered by that device's own channel, so a slow or stalled
  phone never holds up the person speaking.
- Session channels can be reopened: a session stays for 10 minutes after its device drops, and a
  new connection to the same session takes over from any older one (closed with `4410`). A session
  ends with `session.stop`.
- Every server message has `type` and `seq`. `seq` starts at 1 for each connection and goes
  up by one per message. Use it to keep order and ignore duplicates.
- The first server message is always `session.ready`.

Close codes:

| Code | Meaning |
| --- | --- |
| `1000` | Normal close after `session.stop` |
| `4401` | Wrong or used room token |
| `4403` | The browser page's origin is neither the configured frontend address (`FRONTEND_ORIGIN`) nor the backend's own address (`localhost`, or the address a tunnel or proxy forwards to). To open the app from another address, such as a LAN address, set `FRONTEND_ORIGIN` to it. Connections that send no `Origin` header (not from a browser) are allowed |
| `4404` | Unknown or ended session or room (an `unknown_session` error is sent first) |
| `4408` | Nothing was received for 45 s; reconnect |
| `4410` | A newer connection with the same session or token took over |
| `1011` | Unexpected failure of the live channel itself (an `internal_error` with `utterance_id: null` is sent first) |

## 3. Browser to server messages

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| binary audio frame | live | raw audio (section 4) | Microphone audio, sent continuously while listening |
| `audio.pause` | live | `participant_id` (optional, meetings only) | The browser stopped sending audio (for example while a translation is being spoken). Any sentence in progress ends now; in a meeting, only that source's sentence when `participant_id` is given (`A` or `B`; anything else gets `invalid_message`; absent or `null` ends both) |
| `voice.settings` | live | `listener_id` (a participant id), `server_voice` (`true` or `false`), `voice` (optional: a voice `id` from `GET /api/voices`, or `null` for automatic) | Whether the server should make voices for this listener, and in which voice. Send `false` when that person chose the browser's own voice or turned their voice off; the server then sends no `tts.audio` for them. Leaving `voice` out keeps the earlier choice. Every listener starts at `true` and automatic, except in a meeting, where voices are off until asked for. A bad listener, a value that is not a boolean, or a voice that is not 1 to 64 letters, digits, `_` or `-` gets `invalid_message` |
| `language.set` | live | `participant_id` (a participant id; ignored in a room, where it is always this device's person), `language` | Change that person's language during the conversation. The next sentence is translated into it, and every device gets `participants.updated`. A bad code or a missing person gets `invalid_message`. Both people may choose the same language; then nothing is translated between them |
| `voice.played` | live | `utterance_id`, `listener_id` (ignored in a room, where it is always this device's person), `seconds` (0 to 120) | A voice for that translation (the server's or the browser's own) just finished playing on this device after `seconds` of playback. The server uses it to recognise its own voice coming back through the microphone (section 5). Missing fields or bad `seconds` get `invalid_message`; a translation the server no longer remembers (it keeps the last 40) is ignored quietly |
| `voice.fix` | live | `utterance_id`, `voice` (one of the conversation's voice names: `A` or `B` on one device, `1` to `6` in a meeting) | The sentence was matched to the wrong voice (section 5). The server moves that sentence's voice print to the right voice, so later sentences from that person are matched better, and sends nothing back; the browser relabels the sentence itself. Only the last 40 sentences can be moved; older ones are ignored quietly. A missing `utterance_id`, or a voice name this conversation does not have (any name in a room, which has no voice matching), gets `invalid_message` |
| `words.live` | live | `text` (at most 500 characters) | The words the browser's own speech recognition hears while this person is still speaking (section 5). In a room the server passes them straight to the other devices as `words.live`; elsewhere it ignores them. Nothing is kept. Text that is not a string or is too long gets `invalid_message` |
| `ping` | live | none | Keep-alive; answered with `pong`. Send one every 5 s |
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
| Frame size | About 100 ms: 1,600 samples = 3,200 bytes per binary message. Must be a non-empty even number of bytes and at most 32,000 bytes (1 s), otherwise `invalid_message` and that frame is dropped. In a meeting the one-byte source tag comes first and is not counted |

## 5. Server to browser messages

All include `type` and `seq`.

| Type | Status | Fields | Meaning |
| --- | --- | --- | --- |
| `session.ready` | live | `session_id`, `participants`, `server_voice`, `mode`; in a room also `you`, `connected` | Live channel is open. `server_voice: true` means the server sends `tts.audio` for translations; `false` means the browser speaks translations itself |
| `peer.connected`, `peer.disconnected`, `peer.left` | live | `participant_id` | In a room: that person's device connected, dropped, or left (the host leaving ends the call) |
| `pong` | live | none | Answer to `ping` |
| `error` | live | `code`, `message`, `retryable`, `utterance_id` (or `null`); `voice_unavailable` also has `listener_id` | Show `message` to the user |
| `utterance.received` | live | `utterance_id`, `speaker_id` (`A`, `B`, or `null` until known), `duration_ms` | The server heard a sentence and is processing it. `utterance_id` is made by the server. In a meeting `speaker_id` is already known from the audio source |
| `speech.activity` | live | `speaker_id` (`null` in together mode, the source in a meeting), `active` | Someone started (`true`) or stopped (`false`) speaking. Sent only when it changes. `false` also follows `audio.pause` or `session.stop` when a sentence was in progress |
| `participants.updated` | live | `participants` | Someone changed their language. Use these people from now on |
| `utterance.ignored` | live | `utterance_id` | No words were recognised (noise, coughing). Remove the pending turn quietly and keep listening |
| `transcript.final` | live | `utterance_id`, `speaker_id` (`A`, `B` or `null`), `voice` (a voice name or `null`), `text`, `language`, `language_name` | What was said, in the words and script spoken, its detected language code and English language name. `voice` is set when the speaker was told apart by voice (below) |
| `words.live` | live | `speaker_id`, `text` | In a room: the words another person's browser hears while they are still speaking, before their sentence ends. Show them until that person's `transcript.final` arrives; an empty `text` clears them |
| `translation.final` | live | `utterance_id`, `speaker_id`, `listener_id`, `target_language`, `text` | The sentence translated into this listener's chosen language |
| `tts.audio` | live | `utterance_id`, `listener_id`, `format` (`wav`), `audio_base64` | The translation spoken in the listener's language, as base64 WAV audio. Only when `server_voice` is `true` |
| `transcript.partial` | 2A | `utterance_id`, `speaker_id`, `text` | Text so far while speaking |

In together mode, who spoke is decided by the language heard (in a meeting the speaker is the audio source, section 7). A person's language matches when its code is the same,
or when a two-letter and a three-letter code have the same English name (`te` and `tel`). When no
person matches that way, the model's own answer decides, which covers one language known by two
names (`tl` Tagalog and `fil` Filipino):

- The language matches exactly one person's chosen language: that person is the speaker
  (`speaker_id`), and the other person gets one `translation.final`.
- It matches neither person (a third language): `speaker_id` is `null` and both people get a
  `translation.final` in their own language.
- It matches both people (both chose that language): nobody needs a translation, so only
  `transcript.final` is sent, and the speaker is told apart by voice (below).

**Voices.** When the language cannot say who spoke, the server compares the sentence's voice with
the voices already heard in the same conversation: on one device when both people chose the
language spoken (voice names `A` and `B`, which are also the `speaker_id`), and for the meeting's
sound in live captions (voice names `1` to `6`, while `speaker_id` stays `B`). A voice print is 19
averages of the sound's spectrum shape over the sentence's louder half (mel-frequency cepstral
coefficients), never the audio, kept only in memory for the conversation. A sentence joins the
nearest voice when it is close enough (distance 5 or less), otherwise it starts a new voice while
names are left, otherwise it joins the nearest. A sentence with under about 0.6 s of speech gets
`voice: null`. On recordings of two people this named about 9 sentences in 10 correctly; similar
voices and many short sentences do worse, which is why `voice.fix` exists.

When a sentence was heard while a voice was playing to this person (the app hearing its own voice
through the speakers), and it repeats that voice's words, it gets `utterance.ignored` instead of
being translated again, so the voice never bounces back and forth. The browser reports each voice
it finished playing with `voice.played` (the server's voice or its own, however long it was held
or queued first), and the server keeps the last 10 with their play window (plus a quarter second
each side), so nothing is ignored when no voice was played or once it has finished; a reply that
happens to repeat a caption is still translated. It counts as a repeat only when it is nearly all
of that voice's words (80% or more of its letters, or of its words when it has at least three).

The backend logs one line per sentence with how long it waited, how long Gemini took, and how long
after the sentence ended its caption was sent, plus one per voice; the words are never logged.

After `utterance.received`, each utterance gets exactly one of: `transcript.final` followed by its
`translation.final` messages (if any), `utterance.ignored`, or one `error` carrying its
`utterance_id`. Results arrive in the order the sentences end (in a meeting, when one `audio.pause` or `session.stop` ends both sources at once, A's comes first). A translation that only repeats the words
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
<- {"type":"transcript.final","seq":3,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","voice":null,"text":"మీరు ఎలా ఉన్నారు?","language":"te","language_name":"Telugu"}
<- {"type":"translation.final","seq":4,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","speaker_id":"B","listener_id":"A","target_language":"en","text":"How are you?"}
<- {"type":"tts.audio","seq":5,"utterance_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","listener_id":"A","format":"wav","audio_base64":"UklGR..."}
-> {"type":"audio.pause"}
```

## 6. Error codes

| Code | Status | Retryable | When |
| --- | --- | --- | --- |
| `invalid_message` | live | no | Not valid JSON, not an object, missing or unknown `type`, too large, malformed audio frame |
| `unknown_session` | live | no | The session or room does not exist, has expired or has ended (then close 4404) |
| `provider_unavailable` | live | depends | Retryable: speech service unreachable, slow, erroring, returned an unreadable answer or did not translate the sentence, or 5 sentences are already waiting behind the one being translated. Not retryable: no key or model set up, key or model rejected, audio could not be processed, or the service refused the sentence |
| `quota_exceeded` | live | depends | Retryable: Gemini's free-tier limit, or the API key's per-minute limit, was reached; try again after a minute. Not retryable: the API key's daily limit is used up until midnight UTC |
| `voice_unavailable` | live | no | The server could not make the voice for this translation (free voice limit, service unreachable, too many waiting); use the browser voice or captions only |
| `internal_error` | live | yes | Unexpected server error; details only in the backend log. With an `utterance_id`: only that sentence failed and the connection stays open. With `utterance_id: null`: the live channel failed and closes with 1011 |

## 7. Meetings (live)

A meeting is an online call that runs on this computer: Google Meet, Teams or Zoom in a browser
tab, or the Teams or Zoom app. The app listens to the meeting's sound and to this person's
microphone, shows each sentence as a caption in this person's language and keeps the transcript.
Nothing is sent into the meeting: the other people hear this person's own voice as usual, so it
works without anything installed, and this person should tell the meeting that captions are on.

- Create the session with `"mode": "call"` and one participant, `A`, the person using the app
  (`422` with two). `session.ready` then has `mode: "call"`. No voice model is needed.
- The browser sends two audio sources on the same live channel: this computer's microphone (`A`)
  and the meeting's sound (`B`, captured from the meeting's tab or the whole screen with
  `getDisplayMedia`). Every binary frame starts with one byte naming its source, `A` (0x41) or `B`
  (0x42), followed by audio in the format of section 4. A frame with any other first byte, or with
  no audio after it, gets `invalid_message`.
- Each source is listened to separately, so both can be heard at the same time. `audio.pause` with
  `participant_id` ends that source's sentence; without it, both.
- The speaker is the source, never guessed from the language. A sentence from `B` gets a
  `transcript.final` (the words spoken, in any language) and a `translation.final` for `A` in A's
  language (the same words when it already is A's language). A sentence from `A` gets only a
  `transcript.final`: this person's own words are shown, never translated.
- Without headphones the microphone also hears the meeting. When the microphone's sentence
  overlaps in time with a meeting sentence and repeats its words (at least three words, 80% of
  them said in the meeting too; a sentence of one or two words only when it is nearly the whole
  meeting sentence), the microphone's copy gets `utterance.ignored`, whichever of the two is
  understood first, so the transcript shows it once, as the meeting's. Different words at the same
  time are both kept, and a short reply such as "No" is never dropped for being part of a longer
  word. A meeting sentence that failed to be understood cannot be matched, so its copy from the
  microphone is then shown as this person's words.
- Voices are off: `server_voice_for` starts empty and `tts.audio` is sent only after
  `voice.settings` with `server_voice: true` for `A`. The app does not offer this yet; it is for
  a person who wants to hear the meeting in their language through headphones. `voice.settings`
  and `language.set` accept only `A`.
- A sentence is ready after the pause that ends it (about 1 s) plus the translation, so captions
  follow the meeting one sentence behind.
