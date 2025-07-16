import { APISchema, parseJSONResponse, valJSONRes } from "./utils";
import { type TypeOf, v } from "suretype";
import { v_session_bearer, v_session_cookie } from "./types";
import type { AirdayCore } from "../core";

const createUserOpts = APISchema(
  v.object({
    email: v.string(),
    password: v.string(),
  }),
);

const createUserRes = APISchema(
  v.object({
    id: v.string().required(),
    default_workspace: v
      .object({
        id: v.string().required(),
        name: v.string().required(),
      })
      .required(),
  }),
);

export async function createUser(
  core: AirdayCore,
  opts: TypeOf<typeof createUserOpts.schema>,
) {
  createUserOpts.ensureFunc(opts);
  const res = await fetch(core.endpoint("/user"), {
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
  core: AirdayCore,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(core.endpoint("/auth/password"), {
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
  core: AirdayCore,
  opts: TypeOf<typeof passwordAuthSchema.schema>,
) {
  const res = await fetch(core.endpoint("/auth/password/bearer"), {
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

export async function getUserSessions(core: AirdayCore) {
  const res = await fetch(core.endpoint("/auth/sessions"), {
    method: "GET",
    credentials: core.credentials(),
    headers: core.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, sessionsRes.ensureFunc);
}

const refreshCookieRes = APISchema(v_session_cookie);
const refreshBearerRes = APISchema(v_session_bearer);

export async function refreshCookie(core: AirdayCore) {
  if (!core.session) throw new Error("No existing session");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
  };
  const res = await fetch(core.endpoint("/auth/refresh"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ id: core.session.id }),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshCookieRes.ensureFunc);
}

export async function refreshBearer(core: AirdayCore) {
  if (!core.session) throw new Error("No existing session");
  if (!core.session?.refreshToken) throw new Error("No refresh token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Content": "application/json",
    Authorization: `Bearer ${core.session.refreshToken}`,
  };
  const res = await fetch(core.endpoint("/auth/refresh/bearer"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ id: core.session.id }),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, refreshBearerRes.ensureFunc);
}
