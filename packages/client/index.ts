import {
  type TypeOf,
  compile,
  type ObjectValidator,
  type EnsureFunction,
} from "suretype";

export class AirdayClient {
  root = new URL("http://localhost:3000");
  constructor(rootURL: string) {
    this.root = new URL(rootURL);
  }
  endpoint(pathName: string) {
    const url = new URL(this.root);
    url.pathname = pathName;
    return url;
  }
  createUser() {}
}

interface AirdayJSONResponse<T> {
  response: Response;
  data: T;
}

type ExtractEnsureType<T extends EnsureFunction<any>> =
  T extends EnsureFunction<infer U> ? U : never;

export async function validateJSONResponse<T extends EnsureFunction<any>>(
  response: Response,
  validator: T,
): Promise<AirdayJSONResponse<ExtractEnsureType<T>>> {
  let body = await response.json();
  const data = validator(body);
  return {
    response,
    data,
  };
}

export function APISchema<T extends ObjectValidator<any>>(
  schema: T,
): {
  schema: T;
  ensureFunc: EnsureFunction<TypeOf<T, false>>;
} {
  return {
    schema,
    ensureFunc: compile(schema, { ensure: true }),
  };
}
