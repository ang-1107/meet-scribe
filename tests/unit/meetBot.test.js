import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const launch = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch
  }
}));

describe("meetBot strict/fallback behavior", () => {
  const originalForceSimulation = process.env.MEETSCRIBE_FORCE_SIMULATION;
  const originalAllowFallback = process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK;

  beforeEach(() => {
    vi.resetModules();
    launch.mockReset();
    delete process.env.MEETSCRIBE_FORCE_SIMULATION;
    delete process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK;
  });

  afterEach(() => {
    if (originalForceSimulation === undefined) {
      delete process.env.MEETSCRIBE_FORCE_SIMULATION;
    } else {
      process.env.MEETSCRIBE_FORCE_SIMULATION = originalForceSimulation;
    }

    if (originalAllowFallback === undefined) {
      delete process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK;
    } else {
      process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK = originalAllowFallback;
    }
  });

  it("throws when real browser launch fails and fallback is disabled", async () => {
    launch.mockRejectedValueOnce(new Error("browser launch failed"));
    const { joinMeetAndCaptureTranscript } = await import("@/lib/server/meetBot");

    await expect(
      joinMeetAndCaptureTranscript({
        meetLink: "https://meet.google.com/abc-defg-hij",
        botName: "Bot",
        durationSeconds: 30,
        onStatus: async () => undefined,
        onTranscript: async () => undefined,
        shouldStop: () => false
      })
    ).rejects.toThrow("Real Meet join/capture failed");
  });

  it("falls back to simulation when explicitly enabled", async () => {
    process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK = "true";
    launch.mockRejectedValueOnce(new Error("browser launch failed"));
    const { joinMeetAndCaptureTranscript } = await import("@/lib/server/meetBot");

    const chunks = [];
    const transcript = await joinMeetAndCaptureTranscript({
      meetLink: "https://meet.google.com/abc-defg-hij",
      botName: "Bot",
      durationSeconds: 30,
      onStatus: async () => undefined,
      onTranscript: async (chunk) => chunks.push(chunk),
      shouldStop: () => false
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(transcript).toContain("Kickoff started");
  });
});