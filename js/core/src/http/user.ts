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
    primary_library: v
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

const updateUserOpts = APISchema(
  v.object({
    primary_library_id: v.string(),
  }),
);

export async function updateUser(
  core: AirdayCore,
  opts: TypeOf<typeof updateUserOpts.schema>,
) {
  createUserOpts.ensureFunc(opts);
  const res = await fetch(core.endpoint("/user"), {
    method: "PUT",
    body: JSON.stringify(opts),
    headers: {
      "Content-Type": "application/json",
    },
  });
  return parseJSONResponse(res);
}
