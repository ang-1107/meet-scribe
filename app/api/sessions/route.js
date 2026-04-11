import { createSession, listSessions } from "@/lib/server/store";
import { runSessionPipeline } from "@/lib/server/pipeline";
import { publishSessionUpdate } from "@/lib/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidMeetLink(link) {
  try {
    const url = new URL(link);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

export async function GET() {
  const sessions = await listSessions();
  return Response.json({ sessions });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const meetLink = String(body?.meetLink || "").trim();
    const botName = String(body?.botName || process.env.MEETSCRIBE_DEFAULT_BOT_NAME || "Meet Scribe Bot").slice(
      0,
      60
    );
    const durationSeconds = Math.min(
      3600,
      Math.max(30, Number(body?.durationSeconds || process.env.MEETSCRIBE_DEFAULT_DURATION_SECONDS || 300))
    );

    if (!isValidMeetLink(meetLink)) {
      return Response.json({ error: "Please provide a valid Google Meet link." }, { status: 400 });
    }

    const session = await createSession({ meetLink, botName, durationSeconds });
    publishSessionUpdate(session);

    runSessionPipeline(session.id).catch(() => undefined);

    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create session." },
      { status: 500 }
    );
  }
}