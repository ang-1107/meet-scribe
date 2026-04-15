import { getSessionById } from "@/lib/server/store";
import { subscribeToSession } from "@/lib/server/events";
import { requireAuth } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asSseMessage(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request, { allowQueryToken: true });
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const session = await getSessionById(params.id, auth.user.uid);

  if (!session) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (next) => {
        controller.enqueue(asSseMessage({ session: next }));
      };

      controller.enqueue(asSseMessage({ session }));

      const unsubscribe = subscribeToSession(params.id, send);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // no-op
        }
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}