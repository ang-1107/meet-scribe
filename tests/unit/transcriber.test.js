import { transcribeAudioChunk, resetTranscriber } from "@/lib/server/transcriber";

describe("transcribeAudioChunk", () => {
  afterEach(() => {
    resetTranscriber();
  });

  it("returns empty string for null input", async () => {
    const result = await transcribeAudioChunk(null);
    expect(result).toBe("");
  });

  it("returns empty string for empty Float32Array", async () => {
    const result = await transcribeAudioChunk(new Float32Array(0));
    expect(result).toBe("");
  });

  it("returns empty string for undefined input", async () => {
    const result = await transcribeAudioChunk(undefined);
    expect(result).toBe("");
  });

  // NOTE: The following test requires the Whisper model to be downloaded.
  // It is skipped by default to avoid slow CI runs. Run manually with:
  //   npx vitest run tests/unit/transcriber.test.js --timeout 120000
  it.skip("transcribes a sine wave as silence/noise (model integration test)", async () => {
    // Generate 2 seconds of 440Hz sine wave at 16kHz.
    const sampleRate = 16000;
    const duration = 2;
    const samples = new Float32Array(sampleRate * duration);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.3;
    }

    const result = await transcribeAudioChunk(samples, {
      model: "Xenova/whisper-tiny.en"
    });

    // A sine wave should produce minimal text (silence or noise).
    expect(typeof result).toBe("string");
  }, 120000);
});
