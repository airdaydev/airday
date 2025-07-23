import { APISchema, parseJSONResponse, valJSONRes } from "./utils";
import { AirdayCore } from "../core";
import { v } from "suretype";

const getRootResSchema = APISchema(
  v.object({
    version: v.string(),
  }),
);

export async function getRoot(core: AirdayCore) {
  const res = await fetch(core.endpoint("/"), {
    method: "GET",
  });
  const untyped = await parseJSONResponse(res);
  return valJSONRes(untyped, getRootResSchema.ensureFunc);
}
