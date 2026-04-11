/**
 * Audio capture from a Google Meet browser page.
 *
 * Two-phase architecture:
 *   Phase 1 (BEFORE navigation): injectAudioHooks()
 *   Phase 2 (AFTER joining call): activateCapture()
 *
 * Captures at 16 kHz mono Float32 PCM for Whisper.
 */

/**
 * Phase 1: Inject hooks BEFORE page.goto().
 */
export async function injectAudioHooks(page, onAudioChunk) {
  // Forward browser console to Node.js for debugging.
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[meetscribe]")) {
      console.log(`[browser] ${text}`);
    }
  });

  // Bridge: browser → Node.js.
  await page.exposeFunction("__meetscribe_audio_chunk", (samplesArray) => {
    if (!samplesArray || samplesArray.length === 0) {
      return;
    }
    const float32 = new Float32Array(samplesArray);
    onAudioChunk(float32);
  });

  await page.addInitScript(() => {
    window.__meetscribe = {
      audioCtx: null,
      destination: null,
      recorder: null,
      audioBuffer: [],
      sources: [],
      flushTimer: null,
      pollTimer: null,
      debugTimer: null,
      active: false,
      trackCount: 0,
      elementCount: 0,
      hookedElements: new WeakSet(),
      processCount: 0
    };

    function ensureAudioContext() {
      const s = window.__meetscribe;
      if (s.audioCtx) return;

      try {
        s.audioCtx = new AudioContext({ sampleRate: 16000 });
      } catch {
        s.audioCtx = new AudioContext();
      }
      s.destination = s.audioCtx.createMediaStreamDestination();
      console.log("[meetscribe] AudioContext created. sampleRate:", s.audioCtx.sampleRate, "state:", s.audioCtx.state);
    }

    function addAudioTrack(track) {
      if (track.kind !== "audio") return;
      const s = window.__meetscribe;
      ensureAudioContext();

      try {
        const stream = new MediaStream([track]);
        const source = s.audioCtx.createMediaStreamSource(stream);
        source.connect(s.destination);
        s.sources.push(source);
        s.trackCount++;
        console.log("[meetscribe] Captured WebRTC audio track #" + s.trackCount,
          "readyState:", track.readyState, "muted:", track.muted);
      } catch (err) {
        console.warn("[meetscribe] Failed to capture track:", err.message);
      }
    }

    // ---- Monkey-patch RTCPeerConnection ----
    const OrigRTCPC = window.RTCPeerConnection;
    if (OrigRTCPC) {
      const origSetRD = OrigRTCPC.prototype.setRemoteDescription;
      OrigRTCPC.prototype.setRemoteDescription = function (...args) {
        if (!this.__msh) {
          this.__msh = true;
          this.addEventListener("track", (e) => {
            console.log("[meetscribe] ontrack event:", e.track.kind, "id:", e.track.id);
            addAudioTrack(e.track);
          });
          try {
            for (const r of this.getReceivers()) {
              if (r.track?.kind === "audio") addAudioTrack(r.track);
            }
          } catch {}
        }
        return origSetRD.apply(this, args);
      };

      const origAT = OrigRTCPC.prototype.addTransceiver;
      if (origAT) {
        OrigRTCPC.prototype.addTransceiver = function (...args) {
          const t = origAT.apply(this, args);
          if (!this.__msh) {
            this.__msh = true;
            this.addEventListener("track", (e) => {
              console.log("[meetscribe] ontrack (addTransceiver):", e.track.kind);
              addAudioTrack(e.track);
            });
          }
          return t;
        };
      }
      console.log("[meetscribe] RTCPeerConnection patched successfully.");
    }

    // ---- Media element capture function ----
    window.__meetscribe_hookMediaElements = function () {
      const s = window.__meetscribe;
      if (!s.audioCtx) return;

      document.querySelectorAll("audio, video").forEach((el) => {
        if (s.hookedElements.has(el)) return;
        s.hookedElements.add(el);
        try {
          const stream = el.captureStream ? el.captureStream() : el.mozCaptureStream?.();
          if (!stream) return;
          const tracks = stream.getAudioTracks();
          if (tracks.length === 0) return;
          const source = s.audioCtx.createMediaStreamSource(new MediaStream(tracks));
          source.connect(s.destination);
          s.sources.push(source);
          s.elementCount++;
          console.log("[meetscribe] Hooked <" + el.tagName.toLowerCase() + "> element #" + s.elementCount);
        } catch {}
      });
    };

    console.log("[meetscribe] Audio hooks injected.");
  });
}

/**
 * Phase 2: Activate capture AFTER bot joined the call.
 * Uses MediaRecorder (more reliable than ScriptProcessorNode).
 */
export async function activateCapture(page, { chunkIntervalSeconds = 30 }) {
  const chunkMs = chunkIntervalSeconds * 1000;

  await page.evaluate((CHUNK_MS) => {
    const s = window.__meetscribe;
    if (!s) {
      console.error("[meetscribe] No capture state!");
      return;
    }

    s.active = true;

    // Resume AudioContext (needed for Chrome autoplay policy).
    if (s.audioCtx) {
      console.log("[meetscribe] AudioContext state before resume:", s.audioCtx.state);
      s.audioCtx.resume().then(() => {
        console.log("[meetscribe] AudioContext state after resume:", s.audioCtx.state);
      }).catch((e) => {
        console.warn("[meetscribe] Resume failed:", e.message);
      });

      // Also trigger via click (satisfies user gesture requirement).
      try {
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        s.audioCtx.resume().catch(() => {});
      } catch {}
    }

    // Hook media elements.
    if (window.__meetscribe_hookMediaElements) {
      window.__meetscribe_hookMediaElements();
      s.pollTimer = setInterval(() => window.__meetscribe_hookMediaElements(), 3000);
    }

    console.log("[meetscribe] Capture activated.");
    console.log("[meetscribe]   Tracks:", s.trackCount, "Elements:", s.elementCount);

    // ---- Use ScriptProcessorNode to capture raw PCM ----
    // Connect processor DIRECTLY to audioCtx.destination (no muted gain!)
    // Chrome may optimize away the processor if output is muted.
    try {
      const mixSource = s.audioCtx.createMediaStreamSource(s.destination.stream);
      const processor = s.audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        s.processCount++;
        const data = event.inputBuffer.getChannelData(0);

        // Check if audio has any non-zero samples.
        let hasSignal = false;
        for (let i = 0; i < data.length; i += 100) {
          if (Math.abs(data[i]) > 0.0001) {
            hasSignal = true;
            break;
          }
        }

        if (hasSignal) {
          s.audioBuffer.push(new Float32Array(data));
        }

        // Debug logging (every ~5 seconds at 16kHz with 4096 buffer = ~4 calls/sec).
        if (s.processCount % 20 === 1) {
          const bufSize = s.audioBuffer.reduce((a, b) => a + b.length, 0);
          console.log("[meetscribe] onaudioprocess #" + s.processCount +
            " hasSignal:" + hasSignal +
            " bufferSamples:" + bufSize +
            " ctxState:" + s.audioCtx.state);
        }
      };

      mixSource.connect(processor);
      // Connect DIRECTLY to destination — do NOT use muted gain.
      // This forces Chrome to keep the processor active.
      processor.connect(s.audioCtx.destination);

      console.log("[meetscribe] ScriptProcessor connected to destination.");
    } catch (err) {
      console.error("[meetscribe] Failed to create ScriptProcessor:", err.message);
    }

    // ---- Also start MediaRecorder as backup ----
    try {
      const destStream = s.destination.stream;
      const audioTracks = destStream.getAudioTracks();
      console.log("[meetscribe] Destination stream has", audioTracks.length, "audio tracks");
      for (const t of audioTracks) {
        console.log("[meetscribe]   Track:", t.id, "readyState:", t.readyState, "muted:", t.muted, "enabled:", t.enabled);
      }

      if (audioTracks.length > 0 && typeof MediaRecorder !== "undefined") {
        const recorder = new MediaRecorder(destStream, {
          mimeType: "audio/webm;codecs=opus"
        });

        recorder.ondataavailable = async (e) => {
          if (e.data.size > 0) {
            console.log("[meetscribe] MediaRecorder chunk: " + e.data.size + " bytes");
            // We'll let the ScriptProcessor handle the actual data.
            // This MediaRecorder log tells us audio IS flowing.
          }
        };

        recorder.start(CHUNK_MS);
        s.recorder = recorder;
        console.log("[meetscribe] MediaRecorder started as backup monitor.");
      }
    } catch (err) {
      console.warn("[meetscribe] MediaRecorder failed:", err.message);
    }

    // ---- Flush timer: send buffered PCM to Node.js ----
    s.flushTimer = setInterval(() => {
      if (s.audioBuffer.length === 0) {
        console.log("[meetscribe] Flush: buffer empty. processCount:" + s.processCount);
        return;
      }

      const totalSamples = s.audioBuffer.reduce((a, b) => a + b.length, 0);
      const sampleRate = s.audioCtx?.sampleRate || 16000;

      if (totalSamples < sampleRate * 0.5) {
        console.log("[meetscribe] Flush: too little audio (" + totalSamples + " samples). Skipping.");
        return;
      }

      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const buf of s.audioBuffer) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      s.audioBuffer = [];

      const arr = new Array(merged.length);
      for (let i = 0; i < merged.length; i++) {
        arr[i] = merged[i];
      }

      console.log("[meetscribe] Flushing: " + totalSamples + " samples (" +
        (totalSamples / sampleRate).toFixed(1) + "s)");

      try {
        window.__meetscribe_audio_chunk(arr);
      } catch (err) {
        console.error("[meetscribe] Send failed:", err.message);
      }
    }, CHUNK_MS);

    console.log("[meetscribe] Flush timer started (" + CHUNK_MS + "ms interval).");
  }, chunkMs);

  return {
    stop: async () => {
      await page.evaluate(() => {
        const s = window.__meetscribe;
        if (!s) return;
        s.active = false;
        if (s.flushTimer) clearInterval(s.flushTimer);
        if (s.pollTimer) clearInterval(s.pollTimer);
        if (s.debugTimer) clearInterval(s.debugTimer);
        if (s.recorder?.state === "recording") s.recorder.stop();
        s.sources.forEach((src) => { try { src.disconnect(); } catch {} });
        if (s.audioCtx?.state !== "closed") s.audioCtx?.close().catch(() => {});
      }).catch(() => {});
    }
  };
}
