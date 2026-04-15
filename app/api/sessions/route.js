import { createSession, listSessions } from "@/lib/server/store";
import { runSessionPipeline } from "@/lib/server/pipeline";
import { publishSessionUpdate } from "@/lib/server/events";
import { requireAuth } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";

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

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const sessions = await listSessions(auth.user.uid);
  return Response.json({ sessions });
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return Response.json({ error: auth.error }, { status: auth.status });
    }

    const appConfig = getConfig();
    const body = await request.json();
    const meetLink = String(body?.meetLink || "").trim();
    const botName = String(body?.botName || appConfig.bot.name || "Meet Scribe Bot").slice(
      0,
      60
    );
    const durationSeconds = Math.min(
      3600,
      Math.max(30, Number(body?.durationSeconds || appConfig.bot.durationSeconds || 300))
    );

    if (!isValidMeetLink(meetLink)) {
      return Response.json({ error: "Please provide a valid Google Meet link." }, { status: 400 });
    }

    const session = await createSession({
      meetLink,
      botName,
      durationSeconds,
      ownerUid: auth.user.uid
    });
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