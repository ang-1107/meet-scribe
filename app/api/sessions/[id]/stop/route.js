import { requestStop } from "@/lib/server/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const session = await requestStop(params.id);
  if (!session) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  return Response.json({ session });
}