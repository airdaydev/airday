import { APISchema, endpoint, parseJSONResponse, valJSONRes } from "./utils";
import { type TypeOf, v } from "suretype";

const createUserOpts = APISchema(
  v.object({
    email: v.string(),
    password: v.string(),
  }),
);

const createUserRes = APISchema(
  v.object({
    id: v.string().required(),
    primary_library: v
      .object({
        id: v.string().required(),
        name: v.string().required(),
      })
      .required(),
  }),
);

export async function createUser(
  apiUrl: URL,
  opts: TypeOf<typeof createUserOpts.schema>,
) {
  createUserOpts.ensureFunc(opts);
  const res = await fetch(endpoint(apiUrl, "/user"), {
    method: "POST",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, createUserRes.ensureFunc);
}

const updateUserOpts = APISchema(
  v.object({
    primary_library_id: v.string(),
  }),
);

export async function updateUser(
  apiUrl: URL,
  opts: TypeOf<typeof updateUserOpts.schema>,
) {
  createUserOpts.ensureFunc(opts);
  const res = await fetch(endpoint(apiUrl, "/user"), {
    method: "PUT",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  return parseJSONResponse(res);
}
