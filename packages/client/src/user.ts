import {
  APISchema,
  parseJSONResponse,
  AirdayClient,
  valJSONRes,
} from "./client";
import { type TypeOf, v } from "suretype";

const createUserOptsSchema = APISchema(
  v.object({
    email: v.string(),
    password: v.string(),
  }),
);

const createUserResSchema = APISchema(
  v.object({
    id: v.string().required(),
  }),
);

export async function createUser(
  client: AirdayClient,
  opts: TypeOf<typeof createUserOptsSchema.schema>,
) {
  createUserOptsSchema.ensureFunc(opts);
  const res = await fetch(client.endpoint("/user"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, createUserResSchema.ensureFunc);
}

export const passwordAuthSchema = APISchema(
  v.object({
    email: v.string().required(),
    password: v.string().required(),
    type: v.string().const("bearer"),
  }),
);

const passwordAuthResponseSchema = APISchema(
  v.object({
    id: v.string().required(),
  }),
);

export async function passwordAuth(
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
  return valJSONRes(untyped, passwordAuthResponseSchema.ensureFunc);
}

const sessionsResponseSchema = APISchema(
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
    headers: client.getAuthenticatedHeaders(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, sessionsResponseSchema.ensureFunc);
}
