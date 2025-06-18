import {
  APISchema,
  parseJSONResponse,
  AirdayClient,
  valJSONRes,
} from "./client";
import { type TypeOf, v } from "suretype";
import { v_session_bearer, v_session_cookie } from "./types";

const createUserOpts = APISchema(
  v.object({
    email: v.string(),
    password: v.string(),
  }),
);

const createUserRes = APISchema(
  v.object({
    id: v.string().required(),
  }),
);

export async function createUser(
  client: AirdayClient,
  opts: TypeOf<typeof createUserOpts.schema>,
) {
  createUserOpts.ensureFunc(opts);
  const res = await fetch(client.endpoint("/user"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, createUserRes.ensureFunc);
}

export const passwordAuthSchema = APISchema(
  v.object({
    email: v.string().required(),
    password: v.string().required(),
    type: v.string().const("bearer"),
  }),
);

const passwordAuthCookieRes = APISchema(v_session_cookie);

export async function passwordAuthCookie(
  client: AirdayClient,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(client.endpoint("/auth/password"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, passwordAuthCookieRes.ensureFunc);
}

const passwordAuthBearerRes = APISchema(v_session_bearer);

export async function passwordAuthBearer(
  client: AirdayClient,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(client.endpoint("/auth/password/bearer"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
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

export async function getUserSessions(client: AirdayClient) {
  const res = await fetch(client.endpoint("/auth/sessions"), {
    method: "GET",
    credentials: client.credentials(),
    headers: client.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, sessionsRes.ensureFunc);
}

export async function refreshCookie(client: AirdayClient) {
  if (!client.session) throw new Error("No existing session");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
  };
  const res = await fetch(client.endpoint("/auth/refresh"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ id: client.session.id }),
  });
  return res;
}

export async function refreshBearer(client: AirdayClient) {
  if (!client.session) throw new Error("No existing session");
  if (!client.session?.refreshToken) throw new Error("No refresh token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
    Authorization: `Bearer ${client.session.refreshToken}`,
  };
  const res = await fetch(client.endpoint("/auth/refresh/bearer"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ id: client.session.id }),
  });
  return res;
}
