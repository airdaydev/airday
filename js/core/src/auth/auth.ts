import { ensure, v } from "suretype";
import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import { AuthAdapter } from "./adapter";
import {
  AuthEventMap,
  SessionData,
  SessionLike,
  sessionLikeSchema,
  SessionType,
  storedLocalSessionSchema,
} from "./types";

export const SESSION_STORAGE_KEY = "airday_session";

export type LocalSession = {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
};

export function newLocalSession(): LocalSession {
  return {
    userId: new Uuidv4(),
    primaryLibraryId: new Uuidv4(),
  };
}

export interface SessionState {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
}

export class Session {
  auth: AuthAdapter;
  events = new EventEmitter<AuthEventMap>();
  type: SessionType = SessionType.None;
  state?: SessionState;
  constructor(auth: AuthAdapter) {
    this.auth = auth;
  }
  anon() {
    // TODO: Clear AuthAdapter
    // Emit clear event
    this.type = SessionType.Local;
    this.state = newLocalSession();
  }
  boot(sessionLike: SessionLike) {
    try {
      if (sessionLike.type === "local") {
        const local = ensure(storedLocalSessionSchema, sessionLike);
        this.type = SessionType.Local;
        this.state = {
          userId: Uuidv4.fromString(local.userId),
          primaryLibraryId: Uuidv4.fromString(local.primaryLibraryId),
        };
        return;
      } else {
        this.auth.attemptBoot(sessionLike);
      }
    } catch (err) {
      console.error("Failed to boot session", err);
      this.anon();
    }
  }
  // This should really only trigger once, TODO: enforce?
  loadFromStorage() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      return newLocalSession();
    }
    const sessionLike = ensure(sessionLikeSchema, stored);
    this.boot(sessionLike);
  }
  requestCredentials: RequestCredentials = "omit";
  sessionData?: SessionData;
}
