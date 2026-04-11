import { getSessionById } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const session = await getSessionById(params.id);

  if (!session) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  return Response.json({ session });
}