import { TypeOf, v } from "suretype";
import { Uuidv4 } from "../common/uuid";

export const sessionLikeSchema = v.object({
  type: v.string().required(),
});

export type SessionLike = TypeOf<typeof sessionLikeSchema>;

export interface LocalSession {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
}

export function newLocalSession(): LocalSession {
  return {
    userId: new Uuidv4(),
    primaryLibraryId: new Uuidv4(),
  };
}

export interface AuthEventMap {
  initialised: SessionData;
  refresh: SessionData;
  deauthenticated: {};
}

export enum AuthState {
  Uninitialised = "uninitialised",
  Initialising = "initialising",
  Remote = "remote",
  Local = "local",
  ExpiredSession = "expired_session",
}

export interface SessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  type: "remote" | "local";
}

export enum SessionType {
  None,
  Remote,
  Local,
}

export const storedSession = v.object({
  type: v.string().const("local").required(),
});

export const storedLocalSessionSchema = v.object({
  type: v.string().const("local").required(),
  userId: v.string().required(),
  primaryLibraryId: v.string().required(),
});
