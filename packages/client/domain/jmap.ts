import { APISchema, validateJSONResponse, AirdayClient } from "..";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getSession(client: AirdayClient) {
  const res = await fetch(client.endpoint("/jmap/session"), {
    method: "GET",
    credentials: "include",
    headers: client.getHeaders(),
  });
  return validateJSONResponse(res, getRootResSchema.ensureFunc);
}
