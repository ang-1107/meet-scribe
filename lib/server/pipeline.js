import { appendTranscriptChunk, getSessionById, updateSession } from "@/lib/server/store";
import { publishSessionUpdate } from "@/lib/server/events";
import { joinMeetAndCaptureTranscript } from "@/lib/server/meetBot";
import { summarizeTranscript } from "@/lib/server/summarizer";
import { getConfig } from "@/lib/server/config";

const activeRuns = new Map();
const stopRequests = new Set();

function markAndPublish(sessionId, patch) {
  return updateSession(sessionId, patch).then((session) => {
    if (session) {
      publishSessionUpdate(session);
    }
    return session;
  });
}

function isStopRequested(sessionId) {
  return stopRequests.has(sessionId);
}

export async function requestStop(sessionId) {
  stopRequests.add(sessionId);
  return markAndPublish(sessionId, {
    status: "stopping"
  });
}

export function runSessionPipeline(sessionId) {
  if (activeRuns.has(sessionId)) {
    return activeRuns.get(sessionId);
  }

  const work = (async () => {
    const initial = await getSessionById(sessionId);
    if (!initial) {
      throw new Error("Session not found.");
    }

    await markAndPublish(sessionId, {
      status: "joining",
      startedAt: new Date().toISOString(),
      error: null
    });

    try {
      const appConfig = getConfig();
      const transcript = await joinMeetAndCaptureTranscript({
        meetLink: initial.meetLink,
        botName: initial.config?.botName || appConfig.bot.name,
        durationSeconds: initial.config?.durationSeconds || appConfig.bot.durationSeconds,
        onStatus: async (status, note) => {
          await markAndPublish(sessionId, {
            status,
            note: note || null
          });
        },
        onTranscript: async (chunk) => {
          const updated = await appendTranscriptChunk(sessionId, chunk);
          if (updated) {
            publishSessionUpdate(updated);
          }
        },
        shouldStop: () => isStopRequested(sessionId)
      });

      if (isStopRequested(sessionId)) {
        await markAndPublish(sessionId, {
          status: "stopped",
          endedAt: new Date().toISOString()
        });
        return;
      }

      await markAndPublish(sessionId, { status: "transcribing" });

      const latest = await getSessionById(sessionId);
      if ((!latest?.transcript || latest.transcript.trim().length === 0) && transcript?.trim()) {
        const updated = await appendTranscriptChunk(sessionId, transcript);
        if (updated) {
          publishSessionUpdate(updated);
        }
      }

      await markAndPublish(sessionId, { status: "summarizing" });

      const summary = await summarizeTranscript(latest?.transcript || "");

      await markAndPublish(sessionId, {
        status: "completed",
        endedAt: new Date().toISOString(),
        summary
      });
    } catch (error) {
      await markAndPublish(sessionId, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown pipeline error"
      });
    } finally {
      activeRuns.delete(sessionId);
      stopRequests.delete(sessionId);
    }
  })();

  activeRuns.set(sessionId, work);
  return work;
}