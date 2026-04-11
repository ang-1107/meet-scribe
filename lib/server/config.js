import fs from "fs";
import path from "path";
import yaml from "js-yaml";

let _config = null;

/**
 * Load and merge configuration from config.yaml + environment variables.
 *
 * Priority: environment variables override config.yaml values.
 * API keys (secrets) come exclusively from .env.local.
 *
 * The config is loaded once and cached for the process lifetime.
 * Call resetConfig() in tests to clear the cache.
 */
export function getConfig() {
  if (_config) {
    return _config;
  }

  const configPath = path.resolve(process.cwd(), "config.yaml");

  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = yaml.load(raw) || {};
  }

  _config = {
    bot: {
      name:
        process.env.MEETSCRIBE_DEFAULT_BOT_NAME ||
        fileConfig.bot?.name ||
        "Meet Scribe Bot",
      durationSeconds: parseInt(
        process.env.MEETSCRIBE_DEFAULT_DURATION_SECONDS ||
          fileConfig.bot?.durationSeconds ||
          300,
        10
      ),
      headless:
        process.env.MEETSCRIBE_HEADLESS !== undefined
          ? process.env.MEETSCRIBE_HEADLESS === "true"
          : fileConfig.bot?.headless ?? false,
      chromeProfileDir:
        process.env.MEETSCRIBE_CHROME_PROFILE_DIR ||
        fileConfig.bot?.chromeProfileDir ||
        "data/chrome-profile"
    },

    transcription: {
      chunkIntervalSeconds: parseInt(
        fileConfig.transcription?.chunkIntervalSeconds || 30,
        10
      ),
      whisperModel:
        fileConfig.transcription?.whisperModel || "Xenova/whisper-base.en"
    },

    simulation: {
      force:
        process.env.MEETSCRIBE_FORCE_SIMULATION !== undefined
          ? process.env.MEETSCRIBE_FORCE_SIMULATION === "true"
          : fileConfig.simulation?.force ?? false,
      allowFallback:
        process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK !== undefined
          ? process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK === "true"
          : fileConfig.simulation?.allowFallback ?? false
    },

    // Secrets — always from environment only.
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || ""
  };

  return _config;
}

/** Clear cached config. Use in tests only. */
export function resetConfig() {
  _config = null;
}
