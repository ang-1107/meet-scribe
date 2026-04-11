"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function HomePage() {
  const [meetLink, setMeetLink] = useState("");
  const [botName, setBotName] = useState("Meet Scribe Bot");
  const [durationSeconds, setDurationSeconds] = useState(300);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const activeSessionId = activeSession?.id || null;

  async function fetchSessions() {
    const response = await fetch("/api/sessions", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to load sessions");
    }

    setSessions(data.sessions || []);

    if (!activeSessionId && data.sessions?.length > 0) {
      setActiveSession(data.sessions[0]);
    }
  }

  async function loadSession(sessionId) {
    const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to load session");
    }
    setActiveSession(data.session);
  }

  useEffect(() => {
    fetchSessions().catch((err) => setError(err.message));

    const interval = setInterval(() => {
      fetchSessions().catch(() => undefined);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      return undefined;
    }

    const source = new EventSource(`/api/sessions/${activeSessionId}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data || "{}");
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
  }, [activeSessionId]);

  async function startBot(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          meetLink,
          botName,
          durationSeconds: Number(durationSeconds)
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to start session");
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
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to stop bot");
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
      <section className="hero">
        <p className="eyebrow">Google Meet AI Scribe</p>
        <h1>Join, Capture, Summarize</h1>
        <p className="subtext">
          Paste a Meet link, launch the bot, stream progress live, and review transcript plus AI summary in one
          dashboard.
        </p>
      </section>

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
    </main>
  );
}