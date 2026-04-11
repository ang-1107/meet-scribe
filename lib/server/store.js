import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "sessions.json");

let writeQueue = Promise.resolve();

async function ensureStoreFile() {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(dataFile, "utf8");
  } catch {
    await writeFile(dataFile, "[]", "utf8");
  }
}

async function readSessions() {
  await ensureStoreFile();
  const raw = await readFile(dataFile, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSessions(sessions) {
  const payload = JSON.stringify(sessions, null, 2);
  await writeFile(dataFile, payload, "utf8");
}

async function withWriteLock(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function listSessions() {
  const sessions = await readSessions();
  return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getSessionById(sessionId) {
  const sessions = await readSessions();
  return sessions.find((session) => session.id === sessionId) || null;
}

export async function createSession({ meetLink, botName, durationSeconds }) {
  const now = new Date().toISOString();

  const session = {
    id: randomUUID(),
    meetLink,
    status: "created",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    error: null,
    transcript: "",
    summary: {
      short: "",
      keyPoints: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
      participants: []
    },
    config: {
      botName,
      durationSeconds
    }
  };

  await withWriteLock(async () => {
    const sessions = await readSessions();
    sessions.unshift(session);
    await writeSessions(sessions);
  });

  return session;
}

export async function updateSession(sessionId, patch) {
  return withWriteLock(async () => {
    const sessions = await readSessions();
    const index = sessions.findIndex((session) => session.id === sessionId);

    if (index === -1) {
      return null;
    }

    const existing = sessions[index];
    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    if (patch.summary) {
      next.summary = {
        ...existing.summary,
        ...patch.summary
      };
    }

    sessions[index] = next;
    await writeSessions(sessions);
    return next;
  });
}

export async function appendTranscriptChunk(sessionId, chunk) {
  if (!chunk) {
    return getSessionById(sessionId);
  }

  return withWriteLock(async () => {
    const sessions = await readSessions();
    const index = sessions.findIndex((session) => session.id === sessionId);

    if (index === -1) {
      return null;
    }

    const existing = sessions[index];
    const separator = existing.transcript ? "\n" : "";
    const next = {
      ...existing,
      transcript: `${existing.transcript}${separator}${chunk}`,
      updatedAt: new Date().toISOString()
    };

    sessions[index] = next;
    await writeSessions(sessions);
    return next;
  });
}