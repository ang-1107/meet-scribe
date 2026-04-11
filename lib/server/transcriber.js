/**
 * Local speech-to-text transcription using Whisper via Transformers.js.
 *
 * Runs entirely locally — no API keys, no network, no cost.
 * Uses ONNX Runtime under the hood. The model is downloaded once
 * on first use and cached in the system's Hugging Face cache directory.
 *
 * Accepts raw 16 kHz Float32 PCM audio (the format produced by audioCapture.js).
 */

let _pipeline = null;
let _loadingPromise = null;

/**
 * Lazily load and cache the Whisper pipeline.
 * The model is downloaded on first call (~75–500 MB depending on model size).
 *
 * @param {string} modelName — Hugging Face model ID (default: Xenova/whisper-base.en)
 * @param {(progress: object) => void} [onProgress] — optional download progress callback
 * @returns {Promise<Function>} the transcription pipeline
 */
export async function getWhisperPipeline(modelName = "Xenova/whisper-base.en", onProgress) {
  if (_pipeline) {
    return _pipeline;
  }

  if (_loadingPromise) {
    return _loadingPromise;
  }

  _loadingPromise = (async () => {
    // Dynamic import because @xenova/transformers is heavy and should
    // only be loaded when transcription is actually needed.
    const { pipeline } = await import("@xenova/transformers");

    console.log(`[transcriber] Loading Whisper model: ${modelName} (first run downloads the model)...`);

    const transcriber = await pipeline("automatic-speech-recognition", modelName, {
      // Progress callback for model download.
      progress_callback: onProgress || ((data) => {
        if (data.status === "progress" && data.progress) {
          process.stdout.write(`\r[transcriber] Downloading model: ${Math.round(data.progress)}%`);
        }
        if (data.status === "done") {
          console.log("\n[transcriber] Model loaded successfully.");
        }
      })
    });

    _pipeline = transcriber;
    _loadingPromise = null;
    return transcriber;
  })();

  return _loadingPromise;
}

/**
 * Transcribe a chunk of audio.
 *
 * @param {Float32Array} audioSamples — raw 16 kHz mono Float32 PCM audio
 * @param {object} [options]
 * @param {string} [options.model] — Whisper model ID
 * @returns {Promise<string>} the transcribed text
 */
export async function transcribeAudioChunk(audioSamples, options = {}) {
  if (!audioSamples || audioSamples.length === 0) {
    return "";
  }

  const modelName = options.model || "Xenova/whisper-base.en";
  const transcriber = await getWhisperPipeline(modelName);

  const result = await transcriber(audioSamples, {
    // Return timestamps for better formatting.
    return_timestamps: false,
    // Chunk long audio into 30-second segments internally.
    chunk_length_s: 30,
    stride_length_s: 5
  });

  const text = (result?.text || "").trim();
  return text;
}

/**
 * Reset the cached pipeline. Use in tests or when switching models.
 */
export function resetTranscriber() {
  _pipeline = null;
  _loadingPromise = null;
}
