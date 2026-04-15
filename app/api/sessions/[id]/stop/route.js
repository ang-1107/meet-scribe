import { requestStop } from "@/lib/server/pipeline";
import { requireAuth } from "@/lib/server/auth";
import { getSessionById } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const ownedSession = await getSessionById(params.id, auth.user.uid);
  if (!ownedSession) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  const session = await requestStop(params.id);
  if (!session) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  return Response.json({ session });
}