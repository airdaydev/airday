import { APISchema, endpoint, parseJSONResponse, valJSONRes } from "./utils";
import { type TypeOf, v } from "suretype";
import {
  passwordAuthCookieRes,
  passwordAuthSchema,
  v_session_bearer,
  v_session_cookie,
} from "./types";
import { AuthAdapter } from "../auth/adapter";

const jsonHeaders = {
  "Content-Type": "application/json",
};

export async function passwordAuthCookie(
  apiUrl: URL,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(endpoint(apiUrl, "/auth/password/cookie"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: jsonHeaders,
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, passwordAuthCookieRes.ensureFunc);
}

const passwordAuthBearerRes = APISchema(v_session_bearer);

export async function passwordAuthBearer(
  apiUrl: URL,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(endpoint(apiUrl, "/auth/password/bearer"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: jsonHeaders,
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, passwordAuthBearerRes.ensureFunc);
}

const sessionsRes = APISchema(
  v.object({
    items: v.array(
      v.object({
        id: v.string(),
      }),
    ),
  }),
);

export async function getUserSessions(apiUrl: URL, auth: AuthAdapter) {
  const res = await fetch(endpoint(apiUrl, "/auth/sessions"), {
    method: "GET",
    credentials: auth.requestCredentials,
    headers: auth.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, sessionsRes.ensureFunc);
}

const refreshCookieRes = APISchema(v_session_cookie);
const refreshBearerRes = APISchema(v_session_bearer);

export async function refreshCookie(apiUrl: URL) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
  };
  const res = await fetch(endpoint(apiUrl, "/auth/refresh/cookie"), {
    method: "POST",
    headers,
    credentials: "include",
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshCookieRes.ensureFunc);
}

export async function refreshBearer(apiUrl: URL, refreshToken: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
    Authorization: `Bearer ${refreshToken}`,
  };
  const res = await fetch(endpoint(apiUrl, "/auth/refresh/bearer"), {
    method: "POST",
    headers,
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshBearerRes.ensureFunc);
}
