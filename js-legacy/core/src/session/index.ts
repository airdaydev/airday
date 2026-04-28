import { ensure } from "suretype";
import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import { AuthAdapter } from "./adapter";
import {
  AuthEventMap,
  LocalSession,
  newLocalSession,
  SessionLike,
  sessionLikeSchema,
  SessionState,
  SessionType,
  storedLocalSessionSchema,
} from "./types";

export const SESSION_STORAGE_KEY = "airday_session";

export function persistLocalSession(session: LocalSession) {
  const serialised = JSON.stringify({
    type: "local",
    userId: session.userId.toString(),
    primaryLibraryId: session.primaryLibraryId.toString(),
  });
  localStorage.setItem(SESSION_STORAGE_KEY, serialised);
}

export function deserialiseLocalSession(
  sessionLike: SessionLike,
): LocalSession {
  const local = ensure(storedLocalSessionSchema, sessionLike);
  return {
    type: "local",
    userId: Uuidv4.fromString(local.userId),
    primaryLibraryId: Uuidv4.fromString(local.primaryLibraryId),
  };
}

export class AirdaySession {
  auth: AuthAdapter;
  events = new EventEmitter<AuthEventMap>();
  type: SessionType = SessionType.None;
  state?: SessionState;
  constructor(auth: AuthAdapter) {
    this.auth = auth;
    this.auth.events.on("session", (session) => {
      this.type = SessionType.Remote;
      this.state = session;
      this.events.emit("initialised", session);
    });
  }
  anon() {
    this.bootLocalSession(newLocalSession());
  }
  bootLocalSession(session: LocalSession) {
    this.type = SessionType.Local;
    this.state = {
      userId: session.userId,
      primaryLibraryId: session.primaryLibraryId,
    };
    persistLocalSession(session);
    this.events.emit("initialised", session);
  }
  // This should really only trigger once, TODO: enforce?
  async loadFromStorage() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      this.anon();
      return;
    }
    let sessionLike;
    try {
      const parsed = JSON.parse(stored);
      sessionLike = ensure(sessionLikeSchema, parsed);
    } catch (err) {
      console.error("Error passing session storage", err);
    }
    // is SessionLike
    if (sessionLike) {
      try {
        // If a local session, handle here
        if (sessionLike.type === "local") {
          const session = deserialiseLocalSession(sessionLike);
          this.bootLocalSession(session);
          return;
        } else {
          // else attempt to handle in auth adapter
          await this.auth.attemptBoot(sessionLike);
        }
      } catch (err) {
        console.error("Failed to boot session", err);
        this.anon();
      }
    } else {
      this.anon();
    }
  }
  requestCredentials: RequestCredentials = "omit";
}
