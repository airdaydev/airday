import {
  APISchema,
  parseJSONResponse,
  AirdayClient,
  valJSONRes,
} from "./client";
import { v } from "suretype";

const getSessionSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getSession(client: AirdayClient) {
  const res = await fetch(client.endpoint("/jmap/session"), {
    method: "GET",
    credentials: "include",
    headers: client.getAuthenticatedHeaders(),
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getSessionSchema.ensureFunc);
}
