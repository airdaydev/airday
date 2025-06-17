import {
  type TypeOf,
  compile,
  type ObjectValidator,
  type EnsureFunction,
} from "suretype";
import { passwordAuth, passwordAuthSchema } from "./user";

export enum AuthMode {
  ImplicitCookie,
  BearerToken,
}

interface AirdayClientOpts {
  rootUrl: string;
  authMode?: AuthMode;
}

interface Session {
  id: string;
  token?: string;
  tokenExpiry: Date;
  refreshToken?: string;
  refreshExpiry: Date;
}

// TODO: This queue should run instantly, unless the session token is about to expire
// In that case, it should place refresh at the top of the queue and continue
// If the refresh token fails, it should fire an event that the user is logged out
export class AirdayClient {
  root = new URL("http://localhost:3000");
  authMode: AuthMode;
  private session?: Session;
  // TODO: Refresh token
  constructor(opts: AirdayClientOpts) {
    this.root = new URL(opts.rootUrl);
    this.authMode = opts.authMode ?? AuthMode.ImplicitCookie;
  }
  endpoint(pathName: string) {
    const url = new URL(this.root);
    url.pathname = pathName;
    return url;
  }
  setSession(session: Session) {
    this.session = session;
  }
  getAuthenticatedHeaders(json: boolean = true) {
    if (!this.session) throw new Error("User is not authenticated");
    const headers: Record<string, string> = {};
    if (this.authMode === AuthMode.BearerToken) {
      headers["Authorization"] = `Bearer ${this.session.token}`;
    }
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  getInitOpts(init: RequestInit) {
    if (this.authMode === AuthMode.BearerToken) {
      if (!init.headers) {
        init.headers = {};
      }
    }
    if (this.authMode == AuthMode.ImplicitCookie) {
      init.credentials = "include";
    }
  }
  async refresh() {
    // TODO: Gracefully log out
    if (!this.session?.refreshToken) throw new Error("No refresh token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept-Content": "application/json",
    };
    if (this.authMode === AuthMode.BearerToken) {
      headers["Authorization"] = `Bearer ${this.session?.refreshToken}`;
    }
    const res = await fetch(this.endpoint("/auth/refresh"), {
      method: "POST",
      headers,
      credentials:
        this.authMode === AuthMode.ImplicitCookie ? "include" : "omit",
      body: JSON.stringify({ id: this.session.id }),
    });
    return res;
    // TODO: Confirm successsuccess
    // or logout, or retry/back-off
  }
  async loginWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuth(this, opts);
    if (opts.type === "bearer") {
    }
    // this.setSession({
    //   id: res.data.id,
    //   token: sessionToken,
    //   tokenExpiry: new Date(),
    //   refreshToken: refreshToken,
    //   refreshExpiry: new Date(),
    // });
  }
}

interface AirdayJSONResponse<T> {
  response: Response;
  data: T;
}

type ExtractEnsureType<T extends EnsureFunction<any>> =
  T extends EnsureFunction<infer U> ? U : never;

interface ParseOpts {
  debug: boolean;
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
    throw new Error(
      `Status: ${response.status}, body: ${JSON.stringify(body)}`,
    );
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
