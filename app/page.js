"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { getFirebaseClientAuth, isFirebaseClientConfigured } from "@/lib/firebase/client";

const FINAL_STATES = new Set(["completed", "failed", "stopped"]);

function StatusPill({ status }) {
  const normalized = status || "idle";
  return <span className={`status status-${normalized}`}>{normalized.replaceAll("_", " ")}</span>;
}

function formatDate(iso) {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleString();
}

function getOrCreateDevToken() {
  const storageKey = "meet-scribe-dev-user-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return `DEV:${existing}`;
  }

  const next = window.crypto?.randomUUID ? window.crypto.randomUUID() : `dev-${Date.now()}`;
  window.localStorage.setItem(storageKey, next);
  return `DEV:${next}`;
}

function authHeaders(authToken) {
  return authToken
    ? {
        Authorization: `Bearer ${authToken}`
      }
    : {};
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function resolveApiError(response, data, fallback) {
  if (data && typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }

  if (!response.ok && response.status >= 500) {
    return `${fallback} (server error ${response.status})`;
  }

  return fallback;
}

export default function HomePage() {
  const [meetLink, setMeetLink] = useState("");
  const [botName, setBotName] = useState("Meet Scribe Bot");
  const [durationSeconds, setDurationSeconds] = useState(300);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [authLabel, setAuthLabel] = useState("");
  const [authMode, setAuthMode] = useState("none");
  const [authBusy, setAuthBusy] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFormMode, setAuthFormMode] = useState("signin");

  const activeSessionId = activeSession?.id || null;
  const firebaseEnabled = isFirebaseClientConfigured();

  useEffect(() => {
    if (firebaseEnabled) {
      const auth = getFirebaseClientAuth();
      if (!auth) {
        setAuthReady(true);
        return undefined;
      }

      const unsubscribe = onIdTokenChanged(auth, async (user) => {
        if (!user) {
          setAuthToken("");
          setAuthLabel("");
          setAuthMode("firebase");
          setSessions([]);
          setActiveSession(null);
          setAuthReady(true);
          return;
        }

        const token = await user.getIdToken();
        setAuthToken(token);
        setAuthLabel(user.email || user.displayName || user.uid);
        setAuthMode("firebase");
        setAuthReady(true);
      });

      return () => unsubscribe();
    }

    const devToken = getOrCreateDevToken();
    setAuthToken(devToken);
    setAuthLabel(devToken.slice(4, 12));
    setAuthMode("dev");
    setAuthReady(true);
    return undefined;
  }, [firebaseEnabled]);

  async function signInWithGoogle() {
    const auth = getFirebaseClientAuth();
    if (!auth) {
      setError("Firebase client is not configured.");
      return;
    }

    setError("");
    setAuthBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleEmailPasswordAuth(event) {
    event.preventDefault();

    const auth = getFirebaseClientAuth();
    if (!auth) {
      setError("Firebase client is not configured.");
      return;
    }

    if (!authEmail.trim() || !authPassword) {
      setError("Email and password are required.");
      return;
    }

    setError("");
    setAuthBusy(true);
    try {
      if (authFormMode === "signup") {
        await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
      setAuthPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email/password authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutUser() {
    const auth = getFirebaseClientAuth();
    if (!auth) {
      return;
    }

    await signOut(auth);
  }

  async function fetchSessions() {
    if (!authToken) {
      setSessions([]);
      setActiveSession(null);
      return;
    }

    const response = await fetch("/api/sessions", {
      cache: "no-store",
      headers: {
        ...authHeaders(authToken)
      }
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(resolveApiError(response, data, "Failed to load sessions"));
    }

    setSessions(data.sessions || []);

    if (!activeSessionId && data.sessions?.length > 0) {
      setActiveSession(data.sessions[0]);
    }
  }

  async function loadSession(sessionId) {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      cache: "no-store",
      headers: {
        ...authHeaders(authToken)
      }
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(resolveApiError(response, data, "Failed to load session"));
    }
    setActiveSession(data.session);
  }

  useEffect(() => {
    if (!authReady || !authToken) {
      return undefined;
    }

    fetchSessions().catch((err) => setError(err.message));

    const interval = setInterval(() => {
      fetchSessions().catch(() => undefined);
    }, 10000);

    return () => clearInterval(interval);
  }, [authReady, authToken]);

  useEffect(() => {
    if (!activeSessionId || !authToken) {
      return undefined;
    }

    const token = encodeURIComponent(authToken);
    const source = new EventSource(`/api/sessions/${activeSessionId}/events?token=${token}`);
    source.onmessage = (event) => {
      let payload = {};
      try {
        payload = JSON.parse(event.data || "{}");
      } catch {
        return;
      }

      if (!payload?.session) {
        return;
      }

      setActiveSession(payload.session);
      setSessions((current) => {
        const index = current.findIndex((session) => session.id === payload.session.id);
        if (index === -1) {
          return [payload.session, ...current];
        }

        const copy = [...current];
        copy[index] = payload.session;
        return copy;
      });
    };

    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [activeSessionId, authToken]);

  async function startBot(event) {
    event.preventDefault();
    if (!authToken) {
      setError("Please sign in first.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(authToken)
        },
        body: JSON.stringify({
          meetLink,
          botName,
          durationSeconds: Number(durationSeconds)
        })
      });

      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(resolveApiError(response, data, "Unable to start session"));
      }

      setActiveSession(data.session);
      setSessions((current) => [data.session, ...current.filter((item) => item.id !== data.session.id)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function stopBot() {
    if (!activeSessionId) {
      return;
    }

    setError("");
    try {
      const response = await fetch(`/api/sessions/${activeSessionId}/stop`, {
        method: "POST",
        headers: {
          ...authHeaders(authToken)
        }
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(resolveApiError(response, data, "Unable to stop bot"));
      }

      setActiveSession(data.session);
    } catch (err) {
      setError(err.message);
    }
  }

  const canStop = useMemo(() => {
    if (!activeSession?.status) {
      return false;
    }
    return !FINAL_STATES.has(activeSession.status);
  }, [activeSession?.status]);

  return (
    <main className="page-wrap">
      <div className="top-strip">
        <section className="hero">
          <p className="eyebrow">Google Meet AI Scribe</p>
          <h1>Join, Capture, Summarize</h1>
          <p className="subtext">
            Paste a Meet link, launch the bot, stream progress live, and review transcript plus AI summary in one
            dashboard.
          </p>
        </section>

        <section className="card account-card">
          <h2>Account</h2>
          {authMode === "dev" && (
            <p>
              Dev auth mode is active. User scope: <strong>{authLabel}</strong>
            </p>
          )}
          {authMode === "firebase" && !authToken && (
            <>
              <div className="button-row" style={{ marginBottom: "0.75rem" }}>
                <button type="button" onClick={signInWithGoogle} disabled={authBusy}>
                  {authBusy ? "Signing in..." : "Sign in with Google"}
                </button>
              </div>
              <form onSubmit={handleEmailPasswordAuth}>
                <div className="row">
                  <label>
                    Email
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      autoComplete={authFormMode === "signup" ? "new-password" : "current-password"}
                      minLength={6}
                      required
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button type="submit" disabled={authBusy}>
                    {authBusy
                      ? authFormMode === "signup"
                        ? "Creating account..."
                        : "Signing in..."
                      : authFormMode === "signup"
                        ? "Create account"
                        : "Sign in with Email"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={authBusy}
                    onClick={() => setAuthFormMode((current) => (current === "signup" ? "signin" : "signup"))}
                  >
                    {authFormMode === "signup" ? "Use existing account" : "Create new account"}
                  </button>
                </div>
              </form>
            </>
          )}
          {authMode === "firebase" && authToken && (
            <div className="button-row">
              <p style={{ margin: 0, alignSelf: "center" }}>
                Signed in as <strong>{authLabel}</strong>
              </p>
              <button type="button" className="secondary" onClick={signOutUser}>
                Sign out
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="layout-grid">
        <article className="card card-form">
          <h2>Start Session</h2>
          <form onSubmit={startBot}>
            <label>
              Google Meet Link
              <input
                type="url"
                value={meetLink}
                onChange={(event) => setMeetLink(event.target.value)}
                placeholder="https://meet.google.com/abc-defg-hij"
                required
              />
            </label>

            <div className="row">
              <label>
                Bot Name
                <input value={botName} onChange={(event) => setBotName(event.target.value)} maxLength={50} />
              </label>

              <label>
                Listen Seconds
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(event.target.value)}
                />
              </label>
            </div>

            <div className="button-row">
              <button type="submit" disabled={loading}>
                {loading ? "Starting..." : "Start Bot"}
              </button>
              <button type="button" onClick={stopBot} disabled={!canStop} className="secondary">
                Stop Bot
              </button>
            </div>
          </form>

          {error && <p className="error-box">{error}</p>}
        </article>

        <article className="card card-status">
          <h2>Live Status</h2>
          {!activeSession && <p>No active session selected.</p>}
          {activeSession && (
            <>
              <div className="meta-grid">
                <div>
                  <span className="label">Session</span>
                  <p>{activeSession.id}</p>
                </div>
                <div>
                  <span className="label">Status</span>
                  <p>
                    <StatusPill status={activeSession.status} />
                  </p>
                </div>
                <div>
                  <span className="label">Started</span>
                  <p>{formatDate(activeSession.startedAt || activeSession.createdAt)}</p>
                </div>
                <div>
                  <span className="label">Ended</span>
                  <p>{formatDate(activeSession.endedAt)}</p>
                </div>
              </div>
              {activeSession.note && <p className="note">{activeSession.note}</p>}
              {activeSession.error && <p className="error-box">{activeSession.error}</p>}
            </>
          )}
        </article>

        <article className="card card-transcript">
          <h2>Transcript</h2>
          <pre>{activeSession?.transcript || "Transcript will appear here while the bot listens."}</pre>
        </article>

        <article className="card card-summary">
          <h2>Summary</h2>
          <p>{activeSession?.summary?.short || "Summary appears after processing."}</p>

          <h3>Key Points</h3>
          <ul>
            {(activeSession?.summary?.keyPoints || []).map((point, index) => (
              <li key={`kp-${index}`}>{point}</li>
            ))}
          </ul>

          <h3>Decisions</h3>
          <ul>
            {(activeSession?.summary?.decisions || []).map((point, index) => (
              <li key={`dc-${index}`}>{point}</li>
            ))}
          </ul>

          <h3>Action Items</h3>
          <ul>
            {(activeSession?.summary?.actionItems || []).map((point, index) => (
              <li key={`ai-${index}`}>{point}</li>
            ))}
          </ul>

          <h3>Open Questions</h3>
          <ul>
            {(activeSession?.summary?.openQuestions || []).map((point, index) => (
              <li key={`oq-${index}`}>{point}</li>
            ))}
          </ul>
        </article>

        <article className="card card-history">
          <h2>Session History</h2>
          <div className="history-list">
            {sessions.length === 0 && <p>No sessions yet.</p>}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => loadSession(session.id).catch((err) => setError(err.message))}
                className={session.id === activeSessionId ? "history-item active" : "history-item"}
              >
                <span>{session.meetLink}</span>
                <StatusPill status={session.status} />
              </button>
            ))}
          </div>
        </article>
      </section>

      <footer className="page-footer">
        <span>Made with love</span>
        <a href="https://github.com/ang-1107/meet-scribe" target="_blank" rel="noreferrer" className="github-link">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.24.49-2.71-1.08-2.71-1.08-.36-.93-.9-1.18-.9-1.18-.73-.5.05-.49.05-.49.81.06 1.24.84 1.24.84.72 1.24 1.89.88 2.35.67.07-.53.28-.88.5-1.08-1.79-.2-3.68-.9-3.68-3.98 0-.88.31-1.6.82-2.17-.08-.2-.36-1.01.08-2.1 0 0 .67-.22 2.2.83a7.6 7.6 0 0 1 4 0c1.52-1.05 2.2-.83 2.2-.83.44 1.09.16 1.9.08 2.1.51.57.82 1.29.82 2.17 0 3.09-1.9 3.78-3.7 3.98.29.25.55.74.55 1.49v2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0"
            />
          </svg>
          <span>GitHub</span>
        </a>
      </footer>
    </main>
  );
}