import { APISchema, parseJSONResponse, valJSONRes } from "./utils";
import { AirdayCore } from "../core";
import { v } from "suretype";

const getSessionRes = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getJMAPSession(core: AirdayCore) {
  const res = await fetch(core.endpoint("/jmap/session"), {
    method: "GET",
    credentials: core.credentials(),
    headers: core.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getSessionRes.ensureFunc);
}
