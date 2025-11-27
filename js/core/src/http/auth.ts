import { APISchema, endpoint, parseJSONResponse, valJSONRes } from "./utils";
import { type TypeOf, v } from "suretype";
import {
  passwordAuthCookieRes,
  passwordAuthSchema,
  v_session_bearer,
  v_session_cookie,
} from "./types";
import { AuthAdapter } from "../auth/adapters";

const jsonHeaders = {
  "Content-Type": "application/json",
};

export async function passwordAuthCookie(
  rootUrl: URL,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(endpoint(rootUrl, "/auth/password/cookie"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: jsonHeaders,
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, passwordAuthCookieRes.ensureFunc);
}

const passwordAuthBearerRes = APISchema(v_session_bearer);

export async function passwordAuthBearer(
  rootUrl: URL,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(endpoint(rootUrl, "/auth/password/bearer"), {
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

export async function getUserSessions(rootUrl: URL, auth: AuthAdapter) {
  const res = await fetch(endpoint(rootUrl, "/auth/sessions"), {
    method: "GET",
    credentials: auth.credentials,
    headers: auth.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, sessionsRes.ensureFunc);
}

const refreshCookieRes = APISchema(v_session_cookie);
const refreshBearerRes = APISchema(v_session_bearer);

export async function refreshCookie(rootUrl: URL) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
  };
  const res = await fetch(endpoint(rootUrl, "/auth/refresh/cookie"), {
    method: "POST",
    headers,
    credentials: "include",
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshCookieRes.ensureFunc);
}

export async function refreshBearer(rootUrl: URL, refreshToken: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
    Authorization: `Bearer ${refreshToken}`,
  };
  const res = await fetch(endpoint(rootUrl, "/auth/refresh/bearer"), {
    method: "POST",
    headers,
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshBearerRes.ensureFunc);
}
