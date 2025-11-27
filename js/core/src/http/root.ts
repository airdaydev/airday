import { APISchema, endpoint, parseJSONResponse, valJSONRes } from "./utils";
import { AirdayCore } from "../core";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getRoot(rootUrl: URL) {
  const res = await fetch(endpoint(rootUrl, "/"), {
    method: "GET",
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getRootResSchema.ensureFunc);
}
