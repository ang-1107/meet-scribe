import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const runSessionPipeline = vi.fn(() => Promise.resolve());
const publishSessionUpdate = vi.fn();

vi.mock("@/lib/server/pipeline", () => ({
  runSessionPipeline
}));

vi.mock("@/lib/server/events", () => ({
  publishSessionUpdate
}));

describe("/api/sessions route", () => {
  let tempDir;
  const authHeader = { Authorization: "Bearer DEV:test-user" };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "meet-scribe-route-"));
    process.env.MEETSCRIBE_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.MEETSCRIBE_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns 400 for invalid meet link", async () => {
    const { POST } = await import("@/app/api/sessions/route");

    const response = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ meetLink: "https://example.com/not-meet" })
      })
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("valid Google Meet link");
    expect(runSessionPipeline).not.toHaveBeenCalled();
  });

  it("creates a session and triggers pipeline", async () => {
    const { GET, POST } = await import("@/app/api/sessions/route");

    const createResponse = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          meetLink: "https://meet.google.com/abc-defg-hij",
          botName: "Test Bot",
          durationSeconds: 90
        })
      })
    );

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();

    expect(created.session.id).toBeTruthy();
    expect(created.session.ownerUid).toBe("test-user");
    expect(created.session.config.botName).toBe("Test Bot");
    expect(runSessionPipeline).toHaveBeenCalledWith(created.session.id);
    expect(publishSessionUpdate).toHaveBeenCalledTimes(1);

    const listResponse = await GET(
      new Request("http://localhost/api/sessions", {
        headers: authHeader
      })
    );
    const listed = await listResponse.json();
    expect(listed.sessions).toHaveLength(1);
  });
});