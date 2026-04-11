# Meet Scribe

Meet Scribe is a web application that joins a Google Meet from a shared link, captures meeting transcript text, and generates a structured AI summary with key outcomes.

This project was built for the Summer Internship task and prioritizes a working, demonstrable MVP with clear extension points for production hardening.

## Core Capabilities

- Join a Google Meet session using a bot workflow.
- Capture transcript content from live captions (or use simulation mode for safe demos).
- Generate AI summaries with consistent structure:
	- overall summary
	- key discussion points
	- decisions made
	- action items
	- open questions
	- participants (when detectable)
- Stream real-time session status updates in the dashboard.
- Persist and review previous sessions.

## MVP Scope

End-to-end flow:

1. User submits a Meet link.
2. Backend creates a bot session.
3. Bot joins and captures transcript chunks.
4. Transcript is summarized by an LLM.
5. Dashboard displays status, transcript, and final summary.

## Architecture

```text
Frontend (Next.js)
	-> POST /api/sessions
	-> GET /api/sessions/:id/events (SSE)
	-> GET /api/sessions, /api/sessions/:id

Backend Pipeline
	Session Created -> Joining -> Listening -> Transcribing -> Summarizing -> Completed

Services
	- Meet Bot: Playwright (Chromium)
	- Summarizer: Gemini or OpenAI (fallback: local heuristic summary)
	- Storage: local JSON session store
```

## Tech Stack

| Area | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18 |
| Backend | Next.js API routes (Node runtime) |
| Meet Automation | Playwright |
| AI Summarization | Gemini API or OpenAI API |
| Realtime | Server-Sent Events (SSE) |
| Persistence | JSON file store |

## Repository Structure

```text
app/
	api/sessions/
	globals.css
	layout.js
	page.js
lib/server/
	events.js
	meetBot.js
	pipeline.js
	store.js
	summarizer.js
data/
tests/
	unit/
	integration/
	e2e/
```

## Environment Variables

Create `.env.local` from `.env.example`.

| Variable | Required | Description |
|---|---|---|
| GEMINI_API_KEY | No | Gemini key for LLM summarization |
| OPENAI_API_KEY | No | OpenAI key for LLM summarization fallback |
| MEETSCRIBE_FORCE_SIMULATION | No | `true` to skip real Meet automation and run a simulation transcript |
| MEETSCRIBE_ALLOW_SIMULATION_FALLBACK | No | `true` to use simulation transcript only when real join/capture fails |
| MEETSCRIBE_HEADLESS | No | `false` runs visible browser (recommended for local Meet debugging), `true` runs headless |
| MEETSCRIBE_DEFAULT_BOT_NAME | No | Default bot display name |
| MEETSCRIBE_DEFAULT_DURATION_SECONDS | No | Default capture duration |
| MEETSCRIBE_CHROME_PROFILE_DIR | No | Custom path for persistent Chrome profile (Google login cookies). Defaults to `data/chrome-profile/`. For deployment, set to a writable directory on the host. |

## Local Setup

Prerequisites:

- Node.js LTS (tested with Node 24)
- npm

Install and run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Google Account Setup (One-Time)

For the bot to join Google Meet calls, it needs a signed-in Google account. Google blocks anonymous/automated browsers from joining meetings.

Run the setup command once:

```bash
npm run setup:profile
```

This opens a browser window where you sign into Google. After logging in, close the window. The session is saved to `data/chrome-profile/` and reused automatically on every bot run.

Tips:

- Use a dedicated Google account for the bot (recommended) or your personal account.
- The profile persists across restarts — you only need to do this once.
- For deployment, copy the profile directory to the server or re-run setup on the host.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run setup:profile  # One-time Google account login for the bot
npm run test
npm run test:e2e
npm run test:all
```

## Testing and Verification

Automated test layers:

- Unit tests (Vitest): summarizer fallback behavior and store operations.
- Integration tests (Vitest): API session route behavior and full pipeline completion in simulation mode.
- E2E tests (Playwright): user starts a session, sees transcript updates, and receives final summary.

Run commands:

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
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create a session and trigger pipeline |
| GET | `/api/sessions/:id` | Fetch one session |
| GET | `/api/sessions/:id/events` | Stream live session updates (SSE) |
| POST | `/api/sessions/:id/stop` | Request stop for active session |

## Deployment Guidance

Recommended submission deployment split:

1. Next.js app on Vercel.
2. Bot execution on Chromium-capable runtime (Render or Cloud Run).

For production readiness, migrate persistence to managed storage:

- metadata: Firestore/Postgres
- artifacts: S3 or GCS

## Requirement Coverage Matrix

- Meet Integration: implemented via Playwright bot join pipeline.
- Audio/Transcript Processing: transcript capture from Meet captions with chunk updates.
- AI Summarization: structured summary output from Gemini/OpenAI with fallback.
- Responsive UI: dashboard for session control, live status, transcript, summary, and history.
- Bonus Implemented: real-time status streaming.

## Known Constraints

- Google Meet UI selectors can change and may require periodic maintenance.
- Reliable bot joining can depend on meeting permissions, lobby approval, and host policies.
- Caption capture quality depends on meeting caption availability and audio clarity.

## GenAI Usage Statement (Submission-Ready)

I used GenAI in two ways: first, to accelerate engineering work such as structuring the pipeline, generating baseline UI/API code, and debugging asynchronous status handling; second, inside the product itself to transform transcript text into a consistent meeting summary format (summary, key points, decisions, action items, and open questions). This reduced development time while improving output consistency.