import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publishSessionUpdate(session) {
  bus.emit(`session:${session.id}`, session);
  bus.emit("session:list", session);
}

export function subscribeToSession(sessionId, listener) {
  const eventName = `session:${sessionId}`;
  bus.on(eventName, listener);

  return () => {
    bus.off(eventName, listener);
  };
}

export function subscribeToSessionList(listener) {
  const eventName = "session:list";
  bus.on(eventName, listener);

  return () => {
    bus.off(eventName, listener);
  };
}