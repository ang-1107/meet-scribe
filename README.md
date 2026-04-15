# Meet Scribe

Meet Scribe is a web application that joins a Google Meet from a shared link, captures the conversation audio, transcribes it locally using AI, and generates a structured summary with key outcomes.

## Core Capabilities

- Join a Google Meet session using an automated bot with stealth anti-detection.
- Capture meeting audio via WebRTC interception and transcribe locally using Whisper (Transformers.js) — no external transcription API required.
- Generate AI summaries with consistent structure:
	- overall summary
	- key discussion points
	- decisions made
	- action items
	- open questions
	- participants (when detectable)
- Stream real-time session status updates in the dashboard.
- Authenticate users and isolate sessions per user.
- Persist and review previous sessions.
- Simulation mode for safe demos without a live meeting.

## How It Works

```text
1. User submits a Meet link in the dashboard.
2. Bot launches a stealth Chromium browser with a saved Google account session.
3. Bot joins the meeting, intercepts WebRTC audio from other participants.
4. Audio chunks (configurable interval, default 30s) are transcribed locally by Whisper.
5. Transcript is summarized by Gemini/OpenAI LLM.
6. Dashboard displays live status, transcript chunks, and final summary.
```

## Architecture

```text
Frontend (Next.js)
	-> POST /api/sessions
	-> GET /api/sessions/:id/events (SSE)
	-> GET /api/sessions, /api/sessions/:id

Backend Pipeline
	Session Created -> Joining -> Listening -> Transcribing -> Summarizing -> Completed

Services
	- Meet Bot: Playwright + stealth plugin (Chromium)
	- Audio Capture: WebRTC interception -> raw 16kHz PCM
	- Transcription: Whisper via Transformers.js (local, free, no API key)
	- Summarizer: Gemini or OpenAI (fallback: local heuristic summary)
	- Auth: Firebase Auth (Google sign-in)
	- Storage: Firestore (preferred) with local JSON fallback
	- Configuration: config.yaml + .env.local (secrets only)
```

## Tech Stack

| Area | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18 |
| Backend | Next.js API routes (Node runtime) |
| Meet Automation | Playwright + playwright-extra stealth |
| Audio Capture | WebRTC interception (raw PCM) |
| Transcription | Whisper via @xenova/transformers (local, free) |
| AI Summarization | Gemini API or OpenAI API |
| Authentication | Firebase Auth |
| Realtime | Server-Sent Events (SSE) |
| Configuration | YAML (config.yaml) + .env (secrets) |
| Persistence | Firestore (preferred), JSON fallback |

## Repository Structure

```text
app/
	api/sessions/
	globals.css
	layout.js
	page.js
lib/server/
	audioCapture.js    # WebRTC audio interception
	auth.js            # API auth token verification
	config.js          # YAML + env config loader
	events.js          # SSE event publishing
	meetBot.js         # Stealth bot: join, capture, transcribe
	pipeline.js        # Session lifecycle orchestration
	store.js           # User-scoped session persistence (Firestore/JSON)
	summarizer.js      # LLM summarization (Gemini/OpenAI/fallback)
	transcriber.js     # Local Whisper transcription
lib/firebase/
	admin.js           # Firebase Admin init (server)
	client.js          # Firebase client init (browser)
scripts/
	setupProfile.mjs   # One-time Google account login
config.yaml            # All non-secret configuration
data/
tests/
	unit/
	integration/
	e2e/
```

## Configuration

Meet Scribe uses a two-layer configuration system:

- **`config.yaml`** — all non-secret settings (bot name, duration, chunk interval, Whisper model, etc.)
- **`.env.local`** — API keys and Firebase credentials (secrets that should never be committed)

### config.yaml

All tunable parameters with defaults and documentation. Key sections:

| Section | Key | Default | Description |
|---|---|---|---|
| `bot` | `name` | `"Meet Scribe Bot"` | Display name in Google Meet |
| `bot` | `durationSeconds` | `300` | Max listening duration |
| `bot` | `headless` | `false` | Headless browser mode |
| `bot` | `chromeProfileDir` | `"data/chrome-profile"` | Google login profile path |
| `transcription` | `chunkIntervalSeconds` | `30` | Audio chunk size for Whisper |
| `transcription` | `whisperModel` | `"Xenova/whisper-base.en"` | Whisper ONNX model |
| `simulation` | `force` | `false` | Skip real Meet, use demo transcript |
| `simulation` | `allowFallback` | `false` | Fall back to simulation on failure |

### .env.local

Copy from `.env.example`:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | Gemini key for AI summarization |
| `OPENAI_API_KEY` | No | OpenAI key as summarization fallback |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes (prod) | Firebase client SDK key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes (prod) | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes (prod) | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes (prod) | Firebase app ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes (prod) | Firebase Admin service account JSON string |
| `FIREBASE_ALLOW_DEV_AUTH` | No | Allow DEV tokens in local/test mode (`true` by default outside production) |

> **Note:** Environment variables can still override `config.yaml` values for backward compatibility and deployment flexibility (e.g., `MEETSCRIBE_HEADLESS=true`).

## Local Setup

Prerequisites:

- Node.js LTS (tested with Node 24)
- npm

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Set up environment variables

```bash
cp .env.example .env.local
```

Add your `GEMINI_API_KEY` (or `OPENAI_API_KEY`) for AI summarization.

For production multi-user deployment, also set the Firebase variables listed above.

### Step 3: Sign in with a Google account (one-time)

Google Meet blocks anonymous and automation-detected browsers. The bot needs a real Google account session to join meetings.

```bash
npm run setup:profile
```

A browser window opens to Google Accounts. Sign in with the account you want the bot to use (dedicated account recommended). Close the window when done. The session is saved to `data/chrome-profile/` and reused on every run.

> **Note:** You only need to do this once. The profile persists across restarts. For deployment, copy `data/chrome-profile/` to the server or re-run setup on the host.

### Step 4: Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

### First run: Whisper model download

On the first transcription, the Whisper model (~150 MB for `base.en`) is downloaded automatically from Hugging Face and cached locally. Subsequent runs use the cached model.

## Scripts

```bash
npm run dev             # Start development server
npm run build           # Production build
npm run start           # Start production server
npm run setup:profile   # One-time Google account login for the bot
npm run test            # Run unit + integration tests
npm run test:e2e        # Run end-to-end browser tests
npm run test:all        # Run all tests
```

## Testing and Verification

Automated test layers:

- Unit tests (Vitest): config loader, transcriber, summarizer fallback, store operations.
- Integration tests (Vitest): API session route behavior, full pipeline in simulation mode.
- E2E tests (Playwright): user starts a session, sees transcript updates, receives final summary.

```bash
npm run test
npm run test:e2e
npm run test:all
```

Build verification:

```bash
npm run build
```

## API Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/sessions` | List authenticated user's sessions |
| POST | `/api/sessions` | Create a session for authenticated user and trigger pipeline |
| GET | `/api/sessions/:id` | Fetch one session (owner only) |
| GET | `/api/sessions/:id/events?token=...` | Stream live session updates (owner only) |
| POST | `/api/sessions/:id/stop` | Request stop for owned active session |

## Deployment Guidance

The app can be deployed in two modes:

- **Real bot mode (recommended):** Railway (Chromium-capable Node runtime + persistent storage).
- **Demo mode (free/easiest):** Vercel with simulation mode enabled.

### Option A: Railway (Real Meet bot)

This is the best fit if you want actual Meet joining and transcription.

1. Push your repository to GitHub.
2. Create a Railway project and choose **Deploy from GitHub**.
3. Select this repository.
4. Set build/start commands:
	- Build command: `npm install && npm run build`
	- Start command: `npm run start`
5. Add environment variables in Railway:
	- `NODE_ENV=production`
	- `GEMINI_API_KEY=...` (or `OPENAI_API_KEY=...`)
	- Firebase client vars: `NEXT_PUBLIC_FIREBASE_*`
	- Firebase Admin var: `FIREBASE_SERVICE_ACCOUNT_JSON=...`
6. Keep these non-secret settings in `config.yaml`:
	- `bot.headless: true`
	- `simulation.force: false`
	- `simulation.allowFallback: false`
7. Ensure persistent storage for runtime data:
	- `data/chrome-profile/` (Google login session)
	- `data/sessions.json` (session history)
8. Prime the Google profile used by the bot:
	- Locally run `npm run setup:profile` once.
	- Copy `data/chrome-profile/` to the deployed persistent volume.
9. Redeploy and open the Railway URL.
10. Validate with a real Meet link where host admission is possible.

Notes:

- Railway free usage is typically trial/credit-based (limits can change).
- If profile persistence is lost, bot join will fail until profile is re-seeded.

### Option B: Vercel (Demo-only / simulation)

Use this for a free public demo quickly when real browser automation is not required.

1. Import the GitHub repo into Vercel.
2. Framework preset: **Next.js**.
3. Add environment variable: `MEETSCRIBE_FORCE_SIMULATION=true`.
4. Optionally set `GEMINI_API_KEY` for real summarization on demo transcript.
5. Deploy and test the dashboard flow.

Important:

- Vercel serverless is not reliable for full Playwright + persistent Google profile bot execution.
- For real Meet joining, use Option A.

### Recommended Submission Strategy

1. Share a live URL from Railway (real bot mode) if available.
2. Keep a Vercel simulation deployment as backup demo link.
3. In your submission note, explicitly mention which link is real bot vs simulation.

## Requirement Coverage Matrix

- **Meet Integration**: Playwright stealth bot with persistent Google auth profile.
- **Audio/Transcript Processing**: WebRTC audio capture → local Whisper transcription (no external API needed).
- **AI Summarization**: structured summary output from Gemini/OpenAI with local heuristic fallback.
- **Responsive UI**: dashboard for session control, live status, transcript, summary, and history.
- **Bonus Implemented**: real-time status streaming via SSE.

## Known Constraints

- Google Meet UI selectors can change and may require periodic maintenance.
- Reliable bot joining depends on meeting permissions, lobby approval, and host policies.
- Whisper transcription runs on CPU by default; larger models are slower but more accurate.
- The stealth approach to joining Meet is inherently a cat-and-mouse game with Google's detection.
