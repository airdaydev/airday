import { APISchema, endpoint, parseJSONResponse, valJSONRes } from "./utils";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getRoot(apiUrl: URL) {
  const res = await fetch(endpoint(apiUrl, "/"), {
    method: "GET",
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getRootResSchema.ensureFunc);
}
