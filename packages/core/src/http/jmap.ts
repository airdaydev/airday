import { APISchema, parseJSONResponse, valJSONRes } from "./utils";
import { AirdayCore } from "../core";
import { v } from "suretype";

const getSessionRes = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getJMAPSession(client: AirdayCore) {
  const res = await fetch(client.endpoint("/jmap/session"), {
    method: "GET",
    credentials: client.credentials(),
    headers: client.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getSessionRes.ensureFunc);
}
