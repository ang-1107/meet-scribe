import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("session pipeline", () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "meet-scribe-pipeline-"));
    process.env.MEETSCRIBE_DATA_DIR = tempDir;
    process.env.MEETSCRIBE_FORCE_SIMULATION = "true";
  });

  afterEach(async () => {
    delete process.env.MEETSCRIBE_DATA_DIR;
    delete process.env.MEETSCRIBE_FORCE_SIMULATION;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runs end-to-end in simulation mode and completes with summary", async () => {
    const { createSession, getSessionById } = await import("@/lib/server/store");
    const { runSessionPipeline } = await import("@/lib/server/pipeline");

    const session = await createSession({
      meetLink: "https://meet.google.com/abc-defg-hij",
      botName: "Pipeline Bot",
      durationSeconds: 1,
      ownerUid: "pipeline-user"
    });

    await runSessionPipeline(session.id);

    const completed = await getSessionById(session.id);
    expect(completed.status).toBe("completed");
    expect(completed.transcript.length).toBeGreaterThan(0);
    expect(completed.summary.short.length).toBeGreaterThan(0);
  }, 15000);
});