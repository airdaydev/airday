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

export function createUser(
  client: AirdayClient,
  opts: TypeOf<typeof createUserOptsSchema.schema>,
) {
  createUserOptsSchema.ensureFunc(opts);
  return fetch(client.endpoint("/user"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  }).then((res) => validateJSONResponse(res, createUserResSchema.ensureFunc));
}
