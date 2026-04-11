import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetConfig } from "@/lib/server/config";

const mockLaunchPersistentContext = vi.fn();

vi.mock("playwright-extra", () => ({
  chromium: {
    use: vi.fn(),
    launchPersistentContext: (...args) => mockLaunchPersistentContext(...args)
  }
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: vi.fn(() => ({}))
}));

describe("meetBot strict/fallback behavior", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockLaunchPersistentContext.mockReset();
    // Clear all MEETSCRIBE env vars.
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith("MEETSCRIBE_")) {
        delete process.env[key];
      }
    });
    resetConfig();
  });

  afterEach(() => {
    // Restore original env.
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith("MEETSCRIBE_")) {
        delete process.env[key];
      }
    });
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (key.startsWith("MEETSCRIBE_") && value !== undefined) {
        process.env[key] = value;
      }
    });
    resetConfig();
  });

  it("throws when real browser launch fails and fallback is disabled", async () => {
    mockLaunchPersistentContext.mockRejectedValueOnce(new Error("browser launch failed"));
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
    resetConfig();
    mockLaunchPersistentContext.mockRejectedValueOnce(new Error("browser launch failed"));
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