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
    email: v.string(),
    password: v.string(),
  }),
);

export function createUser(
  client: AirdayClient,
  opts: TypeOf<typeof createUserOptsSchema.schema>,
) {
  createUserOptsSchema.ensureFunc(opts);
  return fetch(client.endpoint("/user"), {
    method: "POST",
  }).then((res) => validateJSONResponse(res, createUserResSchema.ensureFunc));
}
