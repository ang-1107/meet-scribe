import { summarizeTranscript } from "@/lib/server/summarizer";
import { resetConfig } from "@/lib/server/config";

describe("summarizeTranscript", () => {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    resetConfig();
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = originalGemini;
    process.env.OPENAI_API_KEY = originalOpenAI;
  });

  it("returns a safe fallback summary for empty transcript", async () => {
    const result = await summarizeTranscript("");

    expect(result.short).toContain("No transcript content available");
    expect(Array.isArray(result.keyPoints)).toBe(true);
    expect(Array.isArray(result.actionItems)).toBe(true);
  });

  it("extracts action items, decisions, and questions from transcript", async () => {
    const transcript = [
      "Alex: We agreed to release on Friday.",
      "Priya: Action item - finalize checklist by EOD.",
      "Chen: Do we support legacy payloads?"
    ].join("\n");

    const result = await summarizeTranscript(transcript);

    expect(result.short.length).toBeGreaterThan(10);
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.actionItems.length).toBeGreaterThan(0);
    expect(result.openQuestions.length).toBeGreaterThan(0);
  });
});