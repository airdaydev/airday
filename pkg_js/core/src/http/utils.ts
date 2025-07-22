import {
  type TypeOf,
  compile,
  type ObjectValidator,
  type EnsureFunction,
} from "suretype";

interface AirdayJSONResponse<T> {
  response: Response;
  data: T;
}

type ExtractEnsureType<T extends EnsureFunction<any>> =
  T extends EnsureFunction<infer U> ? U : never;

interface ParseOpts {
  debug: boolean;
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

    // Capture stack trace if available (V8 specific)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }
  }
}

// TODO: Error handling, tracing
export async function parseJSONResponse(
  response: Response,
  opts?: ParseOpts,
): Promise<AirdayJSONResponse<any>> {
  let body = await response.json();
  const parseOpts = {
    debug: false,
    ...opts,
  };
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
  response: AirdayJSONResponse<any>,
  validator: T,
): Promise<AirdayJSONResponse<ExtractEnsureType<T>>> {
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
