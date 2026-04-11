# Meet Scribe

Meet Scribe is an MVP web app that can:

1. accept a Google Meet link,
2. launch a bot session,
3. capture transcript text (from live Meet captions or simulation fallback),
4. generate an AI summary,
5. display and persist session history in a clean dashboard.

## Tech Stack

- Frontend: Next.js App Router (React)
- Backend: Next.js API routes (Node runtime)
- Meet automation: Playwright (Chromium)
- AI summarization: Gemini API or OpenAI API (with local fallback)
- Persistence: local JSON store (`data/sessions.json`)
- Real-time updates: Server-Sent Events (SSE)

## Project Structure

- `app/page.js`: main dashboard UI
- `app/api/sessions/route.js`: create/list sessions
- `app/api/sessions/[id]/route.js`: fetch one session
- `app/api/sessions/[id]/events/route.js`: SSE stream for live updates
- `app/api/sessions/[id]/stop/route.js`: stop bot session
- `lib/server/meetBot.js`: Playwright meet join + transcript capture
- `lib/server/summarizer.js`: LLM summarization + fallback
- `lib/server/pipeline.js`: orchestration pipeline
- `lib/server/store.js`: persistent session storage
- `lib/server/events.js`: in-process event bus

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

- `GEMINI_API_KEY`: optional, preferred summarization provider
- `OPENAI_API_KEY`: optional, fallback summarization provider
- `MEETSCRIBE_FORCE_SIMULATION`: `true` to skip Playwright and run demo transcript mode
- `MEETSCRIBE_DEFAULT_BOT_NAME`: default bot display name
- `MEETSCRIBE_DEFAULT_DURATION_SECONDS`: default capture window in seconds

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

## MVP Workflow

1. Paste Meet link and click Start Bot.
2. Backend creates a session and starts pipeline asynchronously.
3. Bot attempts to join Meet and extract caption text.
4. Transcript is appended live and streamed to frontend via SSE.
5. Transcript is summarized using Gemini/OpenAI/local fallback.
6. Final summary and transcript stay available in history.

## Status Stages

- `created`
- `joining`
- `in_lobby`
- `joined`
- `listening`
- `transcribing`
- `summarizing`
- `completed`
- `stopping`
- `stopped`
- `failed`

## Important Notes About Meet Capture

- In real mode, the bot relies on Google Meet UI selectors and caption DOM nodes.
- Meet UI can change, so selectors may need periodic updates.
- If Playwright fails or no captions are detected, the app automatically falls back to simulation mode unless force simulation is explicitly disabled.
- For stable production capture, run the bot worker in a dedicated container (Cloud Run/Render) with controlled browser dependencies.

## Deployment Recommendation

For assignment submission, split deployment into two parts:

1. Frontend/API on Vercel (Next.js app)
2. Bot worker on Render or Cloud Run (Chromium-friendly runtime)

Then move persistence from local JSON to managed storage:

- Firestore/Postgres for metadata
- S3/GCS for transcript/audio artifacts

## Assignment Requirement Coverage

- Meet integration: implemented with Playwright join flow in `lib/server/meetBot.js`
- Transcript processing: live caption extraction and streamed transcript chunks
- AI summary: Gemini/OpenAI integration with structured output
- Responsive UI: single-page dashboard with start/stop, live status, transcript, summary, history
- Bonus: real-time status updates using SSE

## GenAI Usage Explanation (for submission)

Example concise statement you can use:

"I used GenAI during development to accelerate architecture decisions, generate baseline API and UI code, refine prompt templates for structured meeting summaries, and troubleshoot edge cases in asynchronous bot/session orchestration. I also used LLM prompting in-app to transform raw transcript text into consistent outputs: short summary, key points, decisions, action items, and open questions."