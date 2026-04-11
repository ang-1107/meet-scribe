import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

async function importStoreForTempDir(tempDir) {
  process.env.MEETSCRIBE_DATA_DIR = tempDir;
  return import("@/lib/server/store");
}

describe("session store", () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "meet-scribe-store-"));
  });

  afterEach(async () => {
    delete process.env.MEETSCRIBE_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates, updates, appends transcript, and lists sessions", async () => {
    const { createSession, getSessionById, updateSession, appendTranscriptChunk, listSessions } =
      await importStoreForTempDir(tempDir);

    const created = await createSession({
      meetLink: "https://meet.google.com/abc-defg-hij",
      botName: "Bot",
      durationSeconds: 60
    });

    expect(created.id).toBeTruthy();

    await appendTranscriptChunk(created.id, "First line");
    await appendTranscriptChunk(created.id, "Second line");

    const updated = await updateSession(created.id, {
      status: "completed",
      summary: {
        short: "Done"
      }
    });

    expect(updated.status).toBe("completed");
    expect(updated.summary.short).toBe("Done");

    const found = await getSessionById(created.id);
    expect(found.transcript).toContain("First line");
    expect(found.transcript).toContain("Second line");

    const all = await listSessions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });
});