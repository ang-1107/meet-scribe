export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "meet-scribe",
    timestamp: new Date().toISOString()
  });
}
