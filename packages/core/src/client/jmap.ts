import { APISchema, parseJSONResponse, AirdayClient, valJSONRes } from "./main";
import { v } from "suretype";

const getSessionRes = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getJMAPSession(client: AirdayClient) {
  const res = await fetch(client.endpoint("/jmap/session"), {
    method: "GET",
    credentials: client.credentials(),
    headers: client.headers(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getSessionRes.ensureFunc);
}
