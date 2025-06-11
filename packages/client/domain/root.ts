import { APISchema, validateJSONResponse, AirdayClient } from "..";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export function getRoot(client: AirdayClient) {
  return fetch(client.endpoint("/"), {
    method: "GET",
  }).then((res) => validateJSONResponse(res, getRootResSchema.ensureFunc));
}
