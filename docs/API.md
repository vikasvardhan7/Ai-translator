# Using the translator from other apps

Any website or app can use this translator: a website through a one-line widget, a server
through the same REST and WebSocket API the app itself uses. Both need an **API key** made by the
person running the translator.

The full list of calls, with every field, is the live API reference at `/docs` on the running
backend (for example `http://localhost:8000/docs`). The exact message format of the live channel
is in [PROTOCOL.md](PROTOCOL.md).

## 1. Make a key

1. Open the translator on the computer that runs it and double-click **Developers**.
2. Name the app the key is for and choose the most requests it may make in a day.
3. Press **Make key** and copy the key straight away. It starts with `vt_` and is shown only
   once: only a fingerprint of it is kept, so it cannot be shown again. If it is lost, revoke it
   and make another.

Each app should have its own key, so its use can be watched and it can be switched off on its
own. The Developers window shows how many requests each key has used today and when it was last
used. **Revoke** stops a key at once.

Keys are kept in `backend/data/keys.db` (name, the first characters, a SHA-256 fingerprint, the
daily limit and when it was made and last used), so they survive a restart. Set `KEYS_FILE` in
`backend/.env` to keep them elsewhere.

## 2. Limits

| Who | Per minute | Per day |
| --- | --- | --- |
| An API key | 60 (`KEY_REQUESTS_PER_MINUTE`) | The limit chosen for the key (10 to 100 000) |
| An invited guest (meeting or call link) | 20 (`GUEST_REQUESTS_PER_MINUTE`) | 400 (`GUEST_REQUESTS_PER_DAY`) |
| The person running the translator | none | none |

Every REST call that needs a key counts as one request, and so does every spoken sentence
translated in a conversation started with that key, including sentences from people who joined a
call the key started. Counts are kept in memory and start again at midnight UTC and on restart.

Past a limit the answer is `429 Too Many Requests` with a `Retry-After` header (seconds) and a
`detail` sentence that says which limit was reached. On the live channel a sentence past the limit
gets an `error` message with code `quota_exceeded`: `retryable: true` when only the per-minute
limit was reached, `false` when the day's limit is used up.

Google's own free-tier limits still apply on top of these. When Gemini is busy, a sentence waits
and is tried again up to three times (about 0.5, 1 and 2 seconds apart, or the wait Gemini asks
for, up to 8 seconds) before an error is shown.

## 3. On a website: the widget

Paste this just before `</body>`, with the address of the translator and your key:

```html
<script src="https://YOUR-TRANSLATOR-ADDRESS/widget.js" data-key="vt_..." async></script>
```

A **Translate** button appears in the bottom-right corner. It opens the translator in a panel;
**Close** ends the conversation and turns the microphone off. Optional attributes:

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-label` | `Translate` | Text on the button |
| `data-position` | `right` | `left` puts the button and panel on the left |
| `data-color` | `#14659f` | Colour of the button |

The panel is the translator's own page in an `iframe` with `allow="microphone; display-capture"`,
so it needs the translator to be reachable over HTTPS (the cloudflared link, or your own address
in `PUBLIC_URL`), and the website using it must be HTTPS too for the browser to allow the
microphone. Inside the panel people can talk next to each other, start a meeting others join by
link, or caption a Zoom, Teams or Meet call; everything counts against the key.

**Anyone who can see a web page can read a key written into it.** Use a separate key for the
widget, keep its daily limit modest and revoke it if it is misused.

## 4. From a server

Send the key in an `X-Api-Key` header. Calls from a browser on another website are blocked by the
browser (CORS); websites should use the widget, servers call the API directly.

### Start a conversation

```bash
curl -X POST https://YOUR-TRANSLATOR-ADDRESS/api/sessions \
  -H "X-Api-Key: vt_..." \
  -H "Content-Type: application/json" \
  -d '{"consent": true, "participants": [
        {"id": "A", "name": "Person 1", "preferred_language": "te"},
        {"id": "B", "name": "Person 2", "preferred_language": "en"}]}'
```

The answer has a `session_id`. `consent: true` confirms that both people agreed to their speech
being sent to Google's Gemini service. Languages are codes such as `en`, `te`, `hi`, `es`.

### Stream audio and receive captions (Python)

Needs `pip install httpx websockets` and a 16 kHz mono WAV recording called `hello.wav`.

```python
import asyncio, json, wave

import httpx
import websockets

ADDRESS = "https://YOUR-TRANSLATOR-ADDRESS"
KEY = "vt_..."


async def main() -> None:
    body = {
        "consent": True,
        "participants": [
            {"id": "A", "name": "Person 1", "preferred_language": "te"},
            {"id": "B", "name": "Person 2", "preferred_language": "en"},
        ],
    }
    session = httpx.post(f"{ADDRESS}/api/sessions", json=body, headers={"X-Api-Key": KEY}).json()
    stream = f"{ADDRESS.replace('http', 'ws', 1)}/api/sessions/{session['session_id']}/stream"
    async with websockets.connect(stream) as channel:
        print(json.loads(await channel.recv()))
        with wave.open("hello.wav") as recording:
            while frame := recording.readframes(1600):
                await channel.send(frame)
        await channel.send(json.dumps({"type": "audio.pause"}))
        while True:
            message = json.loads(await channel.recv())
            print(message["type"], message.get("text", ""))
            if message["type"] in ("translation.final", "error"):
                break
        await channel.send(json.dumps({"type": "session.stop"}))


asyncio.run(main())
```

Audio is 16-bit little-endian PCM, mono, 16 kHz, sent as binary messages of about 100 ms
(3,200 bytes; at most 1 s). The server ends a sentence after about 1 second of silence, or at once
when it receives `{"type": "audio.pause"}`. Send `{"type": "ping"}` every 5 seconds while the
channel is quiet. For each sentence it sends `utterance.received`, then
`transcript.final` (what was said, in the speaker's language, with `voice` naming the voice when two
people sharing a language were told apart by how they sound), then one `translation.final` per
listener, and `tts.audio` (a WAV voice, base64) when a voice model is set up.

### The same in JavaScript (Node 22)

```js
const address = 'https://YOUR-TRANSLATOR-ADDRESS';
const key = 'vt_...';

const response = await fetch(`${address}/api/sessions`, {
  method: 'POST',
  headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    consent: true,
    participants: [
      { id: 'A', name: 'Person 1', preferred_language: 'te' },
      { id: 'B', name: 'Person 2', preferred_language: 'en' },
    ],
  }),
});
const { session_id } = await response.json();
const channel = new WebSocket(`${address.replace('http', 'ws')}/api/sessions/${session_id}/stream`);
channel.onmessage = (event) => console.log(JSON.parse(event.data));
```

### Other calls a key can make

| Call | What it does |
| --- | --- |
| `POST /api/rooms` | Starts a call that up to 6 people join from their own devices through one link |
| `POST /api/languages/detect` | Finds the language spoken in a short WAV recording |
| `GET /api/voices` | Lists the natural voices people can choose |
| `POST /api/assistant` | Asks the assistant a question, optionally about a conversation |
| `GET /api/access` | `{"host": true}` when the key is valid |

Managing keys (`/api/keys`) and scheduled meetings is only for the person running the translator,
never for a key.

## 5. Errors

Every error is `{"detail": "one readable sentence"}`:

| Status | Meaning |
| --- | --- |
| `401` | No key, or the key is wrong or revoked |
| `422` | The request body is not valid; `detail` says which field |
| `429` | A limit was reached; wait for `Retry-After` seconds |
| `503` | Too many conversations are waiting to open, or Gemini cannot be reached |

## 6. What is kept

Nothing of a conversation: audio, captions and transcripts exist only while it runs. The only
things kept on disk are the keys (as above) and scheduled meetings.
