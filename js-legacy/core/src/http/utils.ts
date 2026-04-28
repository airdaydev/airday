import {
  type TypeOf,
  compile,
  type ObjectValidator,
  type EnsureFunction,
} from "suretype";

export interface AirdayResponse<T> {
  response: Response;
  data: T;
}

type ExtractEnsureType<T extends EnsureFunction<any>> =
  T extends EnsureFunction<infer U> ? U : never;

interface ParseOpts {
  debug: boolean;
  json: boolean;
}

export class APIError extends Error {
  public readonly status: number;
  public readonly body: any;

  constructor(message: string, status: number, body?: any) {
    super(message);

    // Set the prototype explicitly to maintain instanceof checks
    Object.setPrototypeOf(this, APIError.prototype);

    this.name = "APIError";
    this.status = status;
    this.body = body;
  }
}

// TODO: Error handling, tracing
export async function parseJSONResponse(
  response: Response,
  opts?: ParseOpts,
): Promise<AirdayResponse<any>> {
  const parseOpts = {
    debug: false,
    json: true,
    ...opts,
  };
  let body = parseOpts.json ? await response.json() : null;
  if (parseOpts.debug) {
    console.log(response, body);
  }
  if (response.status !== 200) {
    // TODO: Robust status handling
    throw new APIError(JSON.stringify(body), response.status);
  }
  return {
    response,
    data: body,
  };
}

export async function valJSONRes<T extends EnsureFunction<any>>(
  response: AirdayResponse<any>,
  validator: T,
): Promise<AirdayResponse<ExtractEnsureType<T>>> {
  const data = await validator(response.data);
  return {
    response: response.response,
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

export function endpoint(apiUrl: URL, pathName: string) {
  const url = new URL(apiUrl);
  url.pathname = pathName;
  return url;
}
