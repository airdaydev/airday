import { APISchema, validateJSONResponse, AirdayClient } from "..";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getRoot(client: AirdayClient) {
  const res = await fetch(client.endpoint("/"), {
    method: "GET",
  });
  return validateJSONResponse(res, getRootResSchema.ensureFunc);
}
