import { APISchema, validateJSONResponse, AirdayClient } from "..";
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
  return validateJSONResponse(res, createUserResSchema.ensureFunc);
}

const passwordAuthSchema = APISchema(
  v.object({
    email: v.string(),
    password: v.string(),
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
  return validateJSONResponse(res, passwordAuthResponseSchema.ensureFunc);
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
  return validateJSONResponse(res, sessionsResponseSchema.ensureFunc);
}
