// Slim msgpack-over-fetch HTTP client for the auth surface. The
// server's `Content-Type: application/msgpack` matches the CLI's
// reqwest path; this is the same wire format with browser primitives.

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
  device_token: string;
}

export interface LoginResponse {
  account_id: string;
  wrapped_dek: Uint8Array;
  wrapped_dek_nonce: Uint8Array;
  recovery_present: boolean;
  device?: DeviceCredential;
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

export class AirdayApi {
  constructor(public readonly baseUrl: string) {}

  async prelogin(email: string): Promise<PreloginResponse> {
    return this.post("/api/account/prelogin", { email });
  }

  async login(args: {
    email: string;
    auth_secret: Uint8Array;
    device_name: string;
  }): Promise<LoginResponse> {
    return this.post("/api/account/login", {
      email: args.email,
      auth_secret: args.auth_secret,
      register_device: { name: args.device_name },
    });
  }

  async signup(args: {
    email: string;
    master_salt: Uint8Array;
    kdf_params: KdfParams;
    auth_secret: Uint8Array;
    wrapped_dek: Uint8Array;
    wrapped_dek_nonce: Uint8Array;
    device_name: string;
  }): Promise<{ account_id: string; device_id: string; device_token: string }> {
    return this.post("/api/account/signup", {
      email: args.email,
      master_salt: args.master_salt,
      kdf_params: args.kdf_params,
      auth_secret: args.auth_secret,
      wrapped_dek: args.wrapped_dek,
      wrapped_dek_nonce: args.wrapped_dek_nonce,
      recovery: null,
      device_name: args.device_name,
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": MSGPACK_CT,
        Accept: MSGPACK_CT,
      },
      body: encode(body),
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
    return decode(buf) as T;
  }
}
