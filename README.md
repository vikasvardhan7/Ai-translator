# Voice Translator

A two-way, real-time voice translator. Two people who speak different languages talk through one app: it recognizes speech, translates it into the other person's language, shows captions in each person's language and speaks the translation aloud.

**Status:** working end to end. Three ways to use it: two people at one device, two people on their own devices through an invite link, and captions for an online meeting (Google Meet, Teams or Zoom) in your language. Hands-free listening finds each sentence by itself; speech is recognized and translated from any language (Gemini API free tier) and spoken by a Gemini voice or the browser's own; the Meet-style screen has live captions, a transcript with text and subtitle downloads, and settings for language, voice and speed. Connections that drop come back by themselves. There is no fixed language list: any ISO 639 code is accepted.

People sign up and sign in with their email (a 6-digit code is emailed to them) and a password; that includes people who open a meeting or call invite link. Only the website widget on other sites works without an account (it uses an API key). The desktop also has a **Gym Trainer**: an AI-made weekly workout and meal plan you can edit, animated demos of 870+ exercises with the muscles they work, a guided workout that talks you through every set, calories worked out from a photo of your food, progress photos, a voice coach, and daily tracking of workouts, meals, water, weight, sleep and steps.

Nothing of a conversation is recorded. Audio is held in memory only until its sentence is translated, captions live only in the browser, and sessions and rooms leave memory when they end or after 10 to 30 minutes without a device.

It runs on your laptop for testing, or online for everyone: [`docs/DEPLOY.md`](docs/DEPLOY.md) gives it a fixed https address for free, either from your laptop with a free domain and Cloudflare (no card needed) or on a free Oracle Cloud server, and people install it from the website as an app on Android, iPhone, Windows or Mac.

The frontend/backend contract is [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Decisions are in [`docs/DECISIONS.md`](docs/DECISIONS.md). [`docs/DEVELOPER-HANDBOOK.docx`](docs/DEVELOPER-HANDBOOK.docx) is the original plan from the first day and is out of date; the protocol and decisions are current.

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Vitest |
| Backend | Python 3.12, FastAPI, Uvicorn, pytest, Ruff |
| Speech, translation and voice | Gemini API free tier through `google-genai`; models set by `GEMINI_MODEL` and `GEMINI_TTS_MODEL` |
| Live words | The browser's own speech recognition (Edge and Chrome) |
| Telling voices apart | NumPy (voice prints computed on the server, kept only in memory) |
| Accounts | Email codes sent through Gmail (Python's own `smtplib`), scrypt passwords, an HttpOnly sign-in cookie |
| Exercise library | Free Exercise DB (public domain), read live from GitHub |
| Storage | No conversations: nothing said is recorded or saved. Accounts, Gym Trainer data and photos, scheduled meetings and API keys are kept in SQLite files in `backend/data` |

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

With the backend running, open <http://localhost:5173> in Edge or Chrome. First sign in (see "Accounts" below). The app looks like a desktop: icons on the left (Meet now, Schedule, Gym Trainer, Live captions, Talk here, Assistant, Developers, Personalize, Help, Privacy, Terms), windows you can drag, maximize or minimize, and a taskbar with Start, an ask box and the clock. After you sign in, the desktop opens with no window open; double-click an icon (tap on a phone) to open one. In the Translator window press "I agree, let's start", choose who you are talking to and say hello; the app finds your language. Allow the microphone when asked, then just talk: each sentence appears as a caption in your language and is spoken aloud. The buttons at the bottom of the call mute your microphone, switch between voice and captions only, open Settings (your language, a natural or fast voice, and its speed), show the transcript (download as text or subtitles) and open the assistant. A minimized call keeps running. Use headphones or keep the volume low so the app does not hear its own voice.

### Looks

Open **Personalize** to pick one of five looks, each with its own live wallpaper: Ocean (follows light or dark mode), Sunset, Mint, Blossom and Aurora night. **Calm motion** keeps the wallpaper still. The choice is remembered in that browser only. You can also say "change the theme to aurora" to the assistant.

### The assistant

Type into the taskbar's ask box, or open **Assistant**. It works like a chat: ask anything and it searches the web when the answer needs current information (sources are shown under the answer). During a call it also knows what has been said ("Summarise so far", "What are the action items?"). It can do things for you: "start meeting captions", "mute me", "show the transcript", "download the subtitles", "change my language to Hindi", "open help", "end the call". Nothing is saved; the chat is gone when the page closes. It uses `GEMINI_MODEL`, or `GEMINI_ASSISTANT_MODEL` in `backend/.env` when set. Web search uses Google Search through Gemini, which has its own daily free limit.

If the connection drops, the screen says "Reconnecting" and comes back by itself with the transcript kept, for up to five minutes.

## Accounts

Everyone signs in before using the app, including people who open a meeting or call invite link: they see the sign-in screen first, with a note that a call is waiting, and join it straight after signing in or creating their account. Only the website widget on other sites works without an account, because it uses an API key.

- **Create account**: name and email, then the 6-digit code that arrives by email (it works for 10 minutes), then a password of at least 8 characters.
- **Sign in**: email and password. You stay signed in until you close the browser or press **Sign out**, and at most 12 hours without using the app. (A browser set to reopen your last tabs at start-up may keep you signed in; **Sign out** always ends it.)
- **Forgot password**: a code by email, then a new password; every other sign-in ends.
- **Account**: your initial sits at the right end of the taskbar; press it to see who is signed in, open **Account settings** or **Sign out** from anywhere, even with apps open. The **Account** icon on the desktop and the Start menu open the same settings: change your name or password, sign out, or delete the account with everything in it.

Every person uses their own email and chooses their own password; nothing is shared or built in. `SMTP_USERNAME` and `SMTP_PASSWORD` are only the Gmail account that sends the codes, never a sign-in. If sign-in says "The email or the password is wrong", that person either has not pressed **Create account** yet or typed a different password; the screen offers to create the account, and the backend window says which of the two it was (with the email shortened, for example `t***@gmail.com`). When the backend starts it also says whether codes can be emailed.

Passwords are kept only as scrypt fingerprints, codes only as fingerprints, and sign-ins as a random number in an HttpOnly cookie, all in `backend/data/accounts.db` (Git ignores it). Each person may make 30 AI requests a minute and 300 a day (`USER_REQUESTS_PER_MINUTE`, `USER_REQUESTS_PER_DAY`); requests made on the computer that runs the backend are never limited. Scheduled meetings belong to the account that made them. API keys are still made only on the computer that runs the backend (or with the host key).

### Sending the codes (Gmail, free)

The codes are emailed from a Gmail account through an app password, which is free and allows about 500 emails a day. Until this is set up, nobody can create an account.

1. Sign in to the Google account that should send the codes and turn on **2-Step Verification** (<https://myaccount.google.com/security>).
2. Open <https://myaccount.google.com/apppasswords>, type a name such as `Voice Translator` and press **Create**. Copy the 16 letters it shows.
3. In `backend/.env` set `SMTP_USERNAME=` to that Gmail address and `SMTP_PASSWORD=` to the 16 letters (spaces do not matter). Never commit `.env`.
4. Start the backend again.

If a code does not arrive, the sign-up screen says why and the backend window adds the technical reason (`Code not sent to ...`). "Refused the login" means the app password or `SMTP_USERNAME` is wrong. "Could not be reached on port 465" means the network blocks it: set `SMTP_PORT=587` and start the backend again. The backend checks Gmail's certificate against the certifi list, so it works even where Python's own certificate store is missing (common with Python from python.org on a Mac).

Phone numbers with SMS codes are not offered yet, because SMS costs money per message.

## Gym Trainer

Double-click **Gym Trainer**. Fill in **Profile** once (age, height, weight, goal, experience, days a week, where you train, the food you eat and anything to avoid); it works out your daily calories, protein, carbohydrate, fat and water. Under **Food budget and your prices** you can list the foods you buy with what you really pay (like Rice, 60, 1 kg) and a daily budget: the meal plan then uses only those foods and those prices. Then:

- **Workouts** and **Diet**: press **Make my workout plan** or **Make my meal plan** and Gemini makes a seven-day plan that fits your profile and targets. Workouts follow a set method: a split chosen from your days a week, compound lifts first, 10 to 20 hard sets per muscle group a week, and sets, reps and rest that match your goal, using only exercises from the library that suit your equipment and experience (no strongman, and no expert or Olympic lifts before Advanced). Meals use household measures with their grams, spread protein over the day, and, with your prices, show what every food, meal and day costs against your budget; each day also says how it sits against your calorie and protein targets. **Edit** changes any day by hand; **Make again…** remakes one day, and **Make a new week…** the whole week, with your wishes ("no running", "more paneer"). **How to** under an exercise opens, right there, its start and finish pictures, the muscles it works, the steps, **Watch videos of it** (a YouTube search) and three other ways to train the same muscles with your equipment, each with **Swap**. Once you have logged an exercise, it also shows what you did last time and a suggested next weight: 2.5 kg more (1 kg under 10 kg) if every set felt easy, otherwise the same weight and one more rep.
- **Exercises**: the whole exercise library (876 exercises for gym machines, free weights, home and no equipment). Search by name, or filter by where you train, the muscle and the type. Each one shows a looping animation of the start and end position, a body map with the main muscles in dark orange and the helping muscles in light orange, the steps, and **Read the steps aloud**.
- **Today** opens with your day at a glance, and it keeps itself up to date (every 30 seconds while it is on screen, and whenever you come back to it): the calories left for today in big type, then protein, water (in glasses, with **+1 glass**) and workout sets still to go. Under that, a line runs through the day from 06:00 to 23:00 with each planned meal on it (green when eaten, dashed when its time passed without it, highlighted when it is due) and a mark for the time now. One box says what to do next, in this order: the meal that is due (**I ate this**), the rest of the workout (**Start guided workout**), a glass of water if you are behind for the time of day, or the next meal. A strip of the last seven days shows which ones have food and a workout logged; press a day to open it. Below that is today's planned workout (press **Done** for each exercise, with the weight you lifted), or **Start guided workout**: it shows each exercise's demo, counts your sets, times your rests and says out loud what to do next; every finished exercise is logged with its weight. Today's meals (**Ate this**); food typed in your own words, or **Take a photo** (the camera opens in the app, on a phone or a laptop) or **Choose a photo**. The AI names each food, estimates its grams and gives its calories and macros per 100 g; you pick the portion for each one (usual portions like 1 medium katori, what the photo shows, or the exact grams), the calories follow your choice, foods it could not see clearly are marked to check, and nothing is logged until you press **Add**. The photo stays with that meal in the day's log. **Progress photos** can be taken with the camera too. Quick water buttons, weight, sleep, steps and a note. The arrows go to other days.
- **Progress**: a tracking streak, workout days, averages and charts of weight, calories, protein, water, sets, sleep and steps for 7, 30 or 90 days, against your targets. **Progress photos** keeps body photos by date and shows the first and the latest side by side.
- **Coach**: type, or press the microphone and talk (Edge or Chrome; pick your language next to **Voice on**). It answers out loud and listens again until you stop talking. Tell it what you did ("I ran 3 km and had 2 chapatis") and it logs it; ask "how do I do a lat pulldown?" and it opens the demo; say "start my workout" and the guided workout begins.

Everything is kept for your account only in `backend/data/trainer.db`, photos included (shrunk to at most 1280 pixels, with location and camera details removed, before they leave the browser). **Profile** can download all of it as a file or delete it. It uses `GEMINI_ASSISTANT_MODEL` (or `GEMINI_MODEL`). Plans and calorie numbers are AI estimates, not medical advice.

The exercise library is the [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), which its makers have placed in the public domain. The backend reads its list from GitHub once a day (`EXERCISE_LIBRARY_URL`) and the browser loads the pictures from GitHub (`EXERCISE_IMAGES_URL`), so the library needs the internet; plans and tracking work without it. Each exercise has two photos, the start and the end position, which the app loops as a short animation; they are not full videos.

## Captions for an online meeting

Join your meeting as usual (Google Meet, Teams or Zoom, in a tab or in the app). In the translator choose "In an online meeting", say hello in the language you want the captions in, then press **Connect meeting** and pick the meeting's browser tab with **Share tab audio** turned on (for the Teams or Zoom app, pick **Entire screen** with **Share system audio**). From then on every sentence said in the meeting appears as a caption in your language, and your own words appear as you said them; the transcript panel keeps both and can be downloaded. Nothing is sent into the meeting, so tell the others that captions are on. Wear headphones so your microphone does not hear the meeting too (the app drops such doubles, but headphones are cleaner).

Each voice in the meeting is numbered (Speaker 1, Speaker 2, up to 6) by comparing how it sounds with the voices heard before; if a name is wrong, tap it in the transcript and pick the right one, and the app learns from it. It works best with clearly different voices and sentences longer than a second.

Press **Ask** during the call (or use the taskbar's ask box) to ask about what has been said so far ("Summarise so far", "What are the action items?", "What did they say about the budget?"). A meeting has no invite link: the captions are only for you. To talk with someone on another device, choose the two-device option instead (below).

Each sentence is sent to Gemini with the last few sentences as context, so names and topic words are heard more reliably. If words are still wrong in your language, compare models with the benchmark above and set the best one as `GEMINI_MODEL`.

The backend log prints one line per sentence with how long each step took, so you can see where time goes.

## Live words and transcripts

While someone speaks, their words appear in the caption box straight away, using the browser's own speech recognition (Edge and Chrome; in a call they also appear on the other devices). When the sentence ends, Gemini's caption and translation replace them. The browser's recognition sends what the microphone hears to the browser's maker (Microsoft for Edge, Google for Chrome); turn **Show words while they are spoken** off in Settings to stop it.

Two people on one device may choose the same language. Nothing is translated then; the transcript names who said what by their voices, and a wrong name is fixed with one tap.

**Transcript → Download** saves the conversation as a Word document (.docx, made in the browser), a PDF (the print window opens; choose **Save as PDF**, which keeps every script correct), plain text, or subtitles in each person's language as .srt or .vtt. Nothing is saved anywhere else.

## Meetings with people on other devices (up to 6)

The others can be on any phone or computer with Edge or Chrome, each speaking their own language. Your laptop runs everything, and a free Cloudflare tunnel gives it a public https link while it runs (no account needed). The backend starts the tunnel for you.

1. Install the tunnel program once: `winget install --id Cloudflare.cloudflared`
2. Build the frontend so the backend can serve it: in `frontend`, run `npm run build`.
3. Start the backend as above (`uvicorn ... --port 8000`).
4. Open <http://localhost:8000>, double-click **Meet now**, type your name, press "I agree, let's start" and say hello. The backend opens the tunnel (a few seconds the first time) and your call opens straight away, showing the invite link (the public `https://...trycloudflare.com` link).
5. Send that one link to up to 5 people. Each opens it, signs in (or creates an account the first time), types their name and says hello, and joins the running call. Everyone talks into their own device, sees the whole conversation and hears everyone else in their own language. **People** in the call shows who is there, who is connected, and the link again; you can also ask the assistant "who is in the call?".

A guest who presses End leaves alone and the call goes on; when the host presses End, the call ends for everyone.

### Scheduling a meeting

Double-click **Schedule** (or tell the assistant "schedule a meeting tomorrow at 5 pm for 30 minutes about the budget"). Give it a name, a date and time, how long it lasts and what it is about, then press **Schedule and get the link**. Each meeting card has **Copy link**, **Copy invitation** (the text with time, length, agenda and link), **Email** (opens your mail app with it ready), **Share** and **Add to calendar** (a calendar file Outlook or Google Calendar opens). People who open the link sign in first; if they are early they see the meeting details and wait in a lobby; when you press **Start meeting** and say hello, they are brought in automatically. Only the title, time, length, agenda and your name are kept, in `backend/data/meetings.db` on your laptop (Git ignores it).

The link works while your laptop runs the app. A quick tunnel gets a new address every time the backend starts, so after a restart send the link again from the meeting card (it always shows the current one), or set `PUBLIC_URL` to a fixed address.

If the app says there is no public link, it also says why: cloudflared is not installed, the frontend is not built, or the tunnel did not start (the backend window has the details). The backend looks for cloudflared on the PATH and where winget puts it; `CLOUDFLARED_PATH` in `backend/.env` names it directly, and `PUBLIC_URL` replaces the tunnel with an address of your own when the app is hosted somewhere. You can also open the app yourself through the public link (for example to be the host from your phone); then the app asks for the host key printed in the backend window, once per browser.

The host key keeps strangers who find the address from using your Gemini quota: only starting a conversation without an account needs it; everyone else signs in. The tunnel address stays the same while the backend runs and changes when it starts again; the conversation stops when your laptop sleeps or the backend is closed. On a phone, keep the page open with the screen on: phones pause the microphone for pages in the background. If someone's connection drops for a moment, the others see them as not connected and the call continues when they are back.

## Using it from other websites and apps

Double-click **Developers** to make an API key for each website or app that should use the translator, with the most requests it may make in a day. Copy the key when it is shown; it is shown only once.

- **A website**: paste the one-line widget from the Developers window before `</body>`. A Translate button appears in the corner and opens the translator in a panel.
- **A server**: send the key in an `X-Api-Key` header to start a conversation, then stream audio over the WebSocket and receive captions and voices.

The Developers window shows each key's use today and can revoke a key at once. Other sites reach the translator through the public link, so the tunnel (or `PUBLIC_URL`) must be working. Signed-in people and keys have limits per minute and per day so nobody can use up the free Gemini quota; you are never limited. The full guide, with examples in curl, Python and JavaScript, is [docs/API.md](docs/API.md); the live reference of every call is at <http://localhost:8000/docs>.

## Putting it online for everyone

[`docs/DEPLOY.md`](docs/DEPLOY.md) is the step-by-step guide, in two ways.

**From your laptop, no card needed.** A free `.dpdns.org` domain from DigitalPlat is handed to a free Cloudflare account, and Cloudflare's connector, installed as a Windows service, carries visitors to `localhost:8000`. `start-server.cmd` (double-click) stops any backend still running and starts it in a window; `start-server.ps1 -AtSignIn` makes it start by itself in the background whenever you sign in to Windows, with its messages in `backend\data\server.log`. The site is up whenever the laptop is on, awake and online.

**On a free Oracle Cloud server, which needs a Visa or Mastercard card for verification.** A free Oracle Cloud server, a free DuckDNS address, then `bash setup.sh` on the server, which opens the firewall, installs Docker and starts three containers: the app (backend and built website together, with every database in a Docker volume), Caddy (free https certificates, renewed by itself) and a small DuckDNS updater. `bash update.sh` brings the server up to date with `main`, and `bash backup.sh` saves a consistent copy of every database.

The website is also an installable app (a web app manifest, icons and a small service worker). On the desktop, **Install app** installs it in Chrome and Edge, and on iPhone and iPad it explains Safari's **Share**, then **Add to Home Screen**; the icon disappears once the app is installed. The installed app always runs the version on the server and shows a short offline page when there is no internet. On Android, long-press the app icon (on Windows, right-click it) for **Gym Trainer** and **Schedule a meeting**.

## Project structure

```
Ai-translator/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app, CORS, /health, host key, log redaction
│   │   ├── api/             access, accounts, sessions, rooms, meetings, API keys, Gym Trainer, languages, voices, assistant, WebSocket streams
│   │   ├── core/            settings, access (host key), language codes, text matching, error format
│   │   ├── models/          request and response models
│   │   └── services/        account, session, room, meeting, key and trainer stores, email, limits, speech detection, voice prints, Gemini speech, translation, voice, assistant and trainer, retry
│   ├── scripts/             live model comparison on FLEURS speech
│   ├── tests/
│   ├── requirements.txt     runtime dependencies
│   └── requirements-dev.txt test and lint tools
├── frontend/
│   ├── src/                 React app: sign-in, desktop (windows, taskbar, themes, installing the app), meetings, Gym Trainer, developers, embedded widget view, assistant, setup, call screens
│   ├── public/              the one-line website widget, app manifest, icons, service worker and offline page
│   ├── package.json
│   └── vite.config.ts
├── deploy/                  server setup: compose file, Caddy, DuckDNS updater, setup, update and backup scripts, settings example
├── docs/                    protocol, API guide for other apps, decisions, putting it online, developer handbook
├── Dockerfile               builds the website and the backend into one image
├── start-server.cmd         double-click: stop any old backend and start it (start-server.ps1 does the work)
└── README.md
```

## Automatic checks

Every pull request and every push to `main` runs the backend tests and lint (on Linux and Windows) and the frontend type check, tests and build on GitHub Actions. See `.github/workflows/checks.yml`. Merge only when all checks are green.

## Security

- API keys go only in `backend/.env`, which Git ignores. Never put keys in the frontend: anything starting with `VITE_` is visible in the browser.
- `.env.example` files contain placeholders only. The Gmail app password goes only in `backend/.env`; if it leaks, delete it at <https://myaccount.google.com/apppasswords> and make a new one.
- Passwords are stored only as scrypt fingerprints, email codes and sign-in tokens only as SHA-256 fingerprints, in `backend/data/accounts.db`. Codes work once for 10 minutes, allow 5 tries and one new code a minute; sign-in and code requests are limited per email address and per device. Signing in with a wrong email or a wrong password gives the same answer, and asking for a password reset never says whether an account exists.
- The sign-in cookie is HttpOnly (scripts cannot read it), SameSite=Lax, and Secure when the app is opened over https.
- API keys for other apps are kept only as SHA-256 fingerprints in `backend/data/keys.db` (Git ignores it). A key written into a web page can be read by anyone who sees that page, so give the widget its own key with a modest daily limit and revoke it if it is misused.
- Through a public link, starting conversations needs the host key printed by the backend; the backend's request log hides tokens and session ids. If you put your own proxy in front of the backend instead of cloudflared, set `HOST_KEY_EVERYWHERE=true` in `backend/.env` so requests through it are never mistaken for local ones.
- On the server, every secret lives only in `deploy/.env` (Git ignores it; `setup.sh` makes it readable by its owner only), the build never sees `.env` files or databases, the app runs as an unprivileged user, and `HOST_KEY_EVERYWHERE` is on. Caddy serves https only (port 80 redirects), adds HSTS, `nosniff` and a strict referrer policy, removes any client-sent `Cf-Connecting-Ip`, and sets `X-Forwarded-For` to the real visitor, so per-device sign-in limits cannot be dodged by faking it.
- `.git/info/exclude` is the place for your own editor and agent folders; `.gitignore` covers build output, caches, Word lock files and coverage reports.
