import {
  APISchema,
  parseJSONResponse,
  valJSONRes,
  AirdayClient,
} from "./client";
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
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getRootResSchema.ensureFunc);
}
