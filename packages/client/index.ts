import { compile, v, type EnsureFunction } from "suretype";

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

async function validateJSONResponse<T extends EnsureFunction<any>>(
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

interface CreateUserOpts {
  email: string;
  password: string;
}

const createUserResponseSchema = v.object({
  id: v.string(),
  email: v.string(),
});

const validator = compile(createUserResponseSchema, { ensure: true });

export function createUser(client: AirdayClient, opts: CreateUserOpts) {
  return fetch(client.endpoint("/user"), {
    method: "POST",
  }).then((res) => validateJSONResponse(res, validator));
}
