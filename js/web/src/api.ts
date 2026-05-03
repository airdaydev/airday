// Slim msgpack-over-fetch HTTP client for the auth surface. Same wire
// format as the CLI; relative paths because the bundle is always served
// from the same origin as the API (vite proxy in dev, single host in
// prod). The device token rides as an HttpOnly cookie set by the server
// — never touched from JS — so this module deliberately knows nothing
// about it on the read side.

import { encode, decode } from "@msgpack/msgpack";

export const MSGPACK_CT = "application/msgpack";

export interface KdfParams {
  m_kib: number;
  t: number;
  p: number;
}

export interface PreloginResponse {
  master_salt: Uint8Array;
  kdf_params: KdfParams;
  recovery_salt?: Uint8Array | null;
}

export interface DeviceCredential {
  device_id: string;
  /** Present on the wire for CLI parity; the web client ignores this
   *  field and relies on the `airday_device` cookie instead. */
  device_token: string;
}

export interface LoginResponse {
  account_id: string;
  wrapped_dek: Uint8Array;
  wrapped_dek_nonce: Uint8Array;
  recovery_present: boolean;
  device?: DeviceCredential;
}

export interface Device {
  id: string;
  name: string;
  last_seen_at: number;
  created_at: number;
}

export interface DevicesListResponse {
  devices: Device[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  async prelogin(email: string): Promise<PreloginResponse> {
    return post("/api/account/prelogin", { email });
  },

  async login(args: {
    email: string;
    auth_secret: Uint8Array;
    device_name: string;
  }): Promise<LoginResponse> {
    return post("/api/account/login", {
      email: args.email,
      auth_secret: args.auth_secret,
      register_device: { name: args.device_name },
    });
  },

  async signup(args: {
    email: string;
    master_salt: Uint8Array;
    kdf_params: KdfParams;
    auth_secret: Uint8Array;
    wrapped_dek: Uint8Array;
    wrapped_dek_nonce: Uint8Array;
    device_name: string;
  }): Promise<{ account_id: string; device_id: string; device_token: string }> {
    return post("/api/account/signup", {
      email: args.email,
      master_salt: args.master_salt,
      kdf_params: args.kdf_params,
      auth_secret: args.auth_secret,
      wrapped_dek: args.wrapped_dek,
      wrapped_dek_nonce: args.wrapped_dek_nonce,
      recovery: null,
      device_name: args.device_name,
    });
  },

  /** Server revokes the calling device's token + emits a clear-cookie. */
  async logout(): Promise<void> {
    await post<unknown>("/api/account/logout", {});
  },

  async listDevices(): Promise<DevicesListResponse> {
    return get("/api/devices");
  },
};

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: encode(body) });
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

async function request<T>(
  path: string,
  init: { method: string; body?: BodyInit },
): Promise<T> {
  const res = await fetch(path, {
    method: init.method,
    // Default for same-origin is already 'same-origin', but be explicit:
    // the cookie carrying the device token is the auth here, and an
    // accidental `'omit'` would silently break logged-in calls.
    credentials: "same-origin",
    headers: {
      "Content-Type": MSGPACK_CT,
      Accept: MSGPACK_CT,
    },
    body: init.body,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    let err: ApiErrorBody | null = null;
    try {
      err = decode(buf) as ApiErrorBody;
    } catch {
      // body wasn't msgpack — surface a generic error
    }
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `${res.status} ${res.statusText}`,
    );
  }
  if (buf.length === 0) return undefined as T;
  return decode(buf) as T;
}
