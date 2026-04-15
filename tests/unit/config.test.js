import { getConfig, resetConfig } from "@/lib/server/config";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

describe("getConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    // Clear all MEETSCRIBE env vars for clean tests.
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith("MEETSCRIBE_") || key === "GEMINI_API_KEY" || key === "OPENAI_API_KEY") {
        delete process.env[key];
      }
    });
  });

  afterAll(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("returns default values when config.yaml is missing", () => {
    // The test runs from project root where config.yaml exists,
    // but defaults should be sane regardless.
    const config = getConfig();

    expect(config.bot).toBeDefined();
    expect(config.bot.name).toBeTruthy();
    expect(config.bot.durationSeconds).toBeGreaterThan(0);
    expect(typeof config.bot.headless).toBe("boolean");
    expect(config.bot.chromeProfileDir).toBeTruthy();

    expect(config.transcription).toBeDefined();
    expect(config.transcription.chunkIntervalSeconds).toBeGreaterThan(0);
    expect(config.transcription.whisperModel).toBeTruthy();

    expect(config.simulation).toBeDefined();
    expect(typeof config.simulation.force).toBe("boolean");
    expect(typeof config.simulation.allowFallback).toBe("boolean");
  });

  it("reads values from config.yaml when present", () => {
    const config = getConfig();
    const configPath = path.resolve(process.cwd(), "config.yaml");
    const raw = fs.readFileSync(configPath, "utf-8");
    const fileConfig = yaml.load(raw) || {};

    expect(config.bot.name).toBe(fileConfig.bot?.name);
    expect(config.bot.durationSeconds).toBe(fileConfig.bot?.durationSeconds);
    expect(config.transcription.chunkIntervalSeconds).toBe(fileConfig.transcription?.chunkIntervalSeconds);
    expect(config.transcription.whisperModel).toBe(fileConfig.transcription?.whisperModel);
  });

  it("env vars override config.yaml values", () => {
    process.env.MEETSCRIBE_DEFAULT_BOT_NAME = "Test Bot";
    process.env.MEETSCRIBE_DEFAULT_DURATION_SECONDS = "120";
    process.env.MEETSCRIBE_HEADLESS = "true";
    resetConfig();

    const config = getConfig();

    expect(config.bot.name).toBe("Test Bot");
    expect(config.bot.durationSeconds).toBe(120);
    expect(config.bot.headless).toBe(true);
  });

  it("reads API keys from environment only", () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    resetConfig();

    const config = getConfig();

    expect(config.geminiApiKey).toBe("test-gemini-key");
    expect(config.openaiApiKey).toBe("test-openai-key");
  });

  it("caches config after first load", () => {
    const config1 = getConfig();
    const config2 = getConfig();

    expect(config1).toBe(config2); // Same reference.
  });

  it("resetConfig clears the cache", () => {
    const config1 = getConfig();
    resetConfig();
    const config2 = getConfig();

    expect(config1).not.toBe(config2); // Different reference.
    expect(config1).toEqual(config2); // Same values though.
  });

  it("simulation env vars override yaml", () => {
    process.env.MEETSCRIBE_FORCE_SIMULATION = "true";
    process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK = "true";
    resetConfig();

    const config = getConfig();

    expect(config.simulation.force).toBe(true);
    expect(config.simulation.allowFallback).toBe(true);
  });
});
