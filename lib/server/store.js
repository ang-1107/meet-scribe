import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getFirebaseAdminFirestore } from "@/lib/firebase/admin";

const configuredDataDir = process.env.MEETSCRIBE_DATA_DIR;
const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "sessions.json");

let writeQueue = Promise.resolve();

function getSessionCollection() {
  const db = getFirebaseAdminFirestore();
  return db ? db.collection("sessions") : null;
}

function normalizeSummary(summary = {}) {
  return {
    short: summary.short || "",
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
    decisions: Array.isArray(summary.decisions) ? summary.decisions : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems : [],
    openQuestions: Array.isArray(summary.openQuestions) ? summary.openQuestions : [],
    participants: Array.isArray(summary.participants) ? summary.participants : []
  };
}

function normalizeSession(session) {
  return {
    ...session,
    ownerUid: session.ownerUid || "",
    summary: normalizeSummary(session.summary)
  };
}

function sortSessions(sessions) {
  return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

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

export async function listSessions(ownerUid) {
  const collection = getSessionCollection();
  if (collection) {
    let query = collection;
    if (ownerUid) {
      query = query.where("ownerUid", "==", ownerUid);
    }

    const snapshot = await query.get();
    return sortSessions(snapshot.docs.map((doc) => normalizeSession(doc.data())));
  }

  const sessions = await readSessions();
  const filtered = ownerUid ? sessions.filter((session) => session.ownerUid === ownerUid) : sessions;
  return sortSessions(filtered.map(normalizeSession));
}

export async function getSessionById(sessionId, ownerUid) {
  const collection = getSessionCollection();
  if (collection) {
    const snapshot = await collection.doc(sessionId).get();
    if (!snapshot.exists) {
      return null;
    }

    const session = normalizeSession(snapshot.data());
    if (ownerUid && session.ownerUid !== ownerUid) {
      return null;
    }

    return session;
  }

  const sessions = await readSessions();
  const session = sessions.find((entry) => entry.id === sessionId) || null;
  if (!session) {
    return null;
  }

  if (ownerUid && session.ownerUid !== ownerUid) {
    return null;
  }

  return normalizeSession(session);
}

export async function createSession({ meetLink, botName, durationSeconds, ownerUid }) {
  const now = new Date().toISOString();

  const session = {
    id: randomUUID(),
    ownerUid,
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

  const collection = getSessionCollection();
  if (collection) {
    await collection.doc(session.id).set(session);
    return normalizeSession(session);
  }

  await withWriteLock(async () => {
    const sessions = await readSessions();
    sessions.unshift(session);
    await writeSessions(sessions);
  });

  return normalizeSession(session);
}

export async function updateSession(sessionId, patch) {
  const collection = getSessionCollection();
  if (collection) {
    const ref = collection.doc(sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }

    const existing = normalizeSession(snapshot.data());
    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
      summary: patch.summary ? { ...existing.summary, ...patch.summary } : existing.summary
    };

    await ref.set(next);
    return normalizeSession(next);
  }

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
    return normalizeSession(next);
  });
}

export async function appendTranscriptChunk(sessionId, chunk) {
  if (!chunk) {
    return getSessionById(sessionId);
  }

  const collection = getSessionCollection();
  if (collection) {
    const ref = collection.doc(sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }

    const existing = normalizeSession(snapshot.data());
    const separator = existing.transcript ? "\n" : "";
    const next = {
      ...existing,
      transcript: `${existing.transcript}${separator}${chunk}`,
      updatedAt: new Date().toISOString()
    };

    await ref.set(next);
    return normalizeSession(next);
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
    return normalizeSession(next);
  });
}