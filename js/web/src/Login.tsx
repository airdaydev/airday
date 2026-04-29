// Login + signup form for slice 4. Argon2id runs on the main thread
// per the parent doc; show a "deriving keys…" spinner during the
// ~hundreds-of-ms hit.

import { createSignal, Show } from "solid-js";
import {
  Dek,
  deriveLogin,
  unwrapDek,
  wrapDek,
} from "@airday/core/wasm";
import { AirdayApi, ApiError, type LoginResponse } from "./api.ts";

export interface Session {
  serverUrl: string;
  email: string;
  accountId: string;
  deviceId: string;
  deviceToken: string;
  dek: Dek;
  /** True iff this session was created via signup (we're device 1
   *  and need to seed the doc with built-in lists). False for a
   *  login session, where built-ins arrive via the initial pull. */
  freshSignup: boolean;
}

const DEFAULT_SERVER = "http://localhost:8080";

function defaultDeviceName(): string {
  return `web-${typeof navigator !== "undefined" ? navigator.platform : "unknown"}`;
}

export function Login(props: { onSession: (s: Session) => void }) {
  const [serverUrl, setServerUrl] = createSignal(DEFAULT_SERVER);
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [deviceName, setDeviceName] = createSignal(defaultDeviceName());
  const [mode, setMode] = createSignal<"login" | "signup">("login");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session =
        mode() === "login"
          ? await doLogin(serverUrl(), email(), password(), deviceName())
          : await doSignup(serverUrl(), email(), password(), deviceName());
      props.onSession(session);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-page">
      <form class="login-form" onSubmit={submit}>
        <h1>{mode() === "login" ? "Log in" : "Sign up"}</h1>
        <label>
          Server
          <input
            type="url"
            required
            value={serverUrl()}
            disabled={busy()}
            onInput={(e) => setServerUrl(e.currentTarget.value)}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            autocomplete="email"
            value={email()}
            disabled={busy()}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={10}
            autocomplete={mode() === "login" ? "current-password" : "new-password"}
            value={password()}
            disabled={busy()}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>
        <label>
          Device name
          <input
            type="text"
            required
            value={deviceName()}
            disabled={busy()}
            onInput={(e) => setDeviceName(e.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={busy()}>
          {busy() ? "Deriving keys…" : mode() === "login" ? "Log in" : "Create account"}
        </button>
        <button
          type="button"
          class="link"
          onClick={() => setMode(mode() === "login" ? "signup" : "login")}
          disabled={busy()}
        >
          {mode() === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>
        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>
      </form>
    </div>
  );
}

async function doLogin(
  serverUrl: string,
  email: string,
  password: string,
  deviceName: string,
): Promise<Session> {
  const api = new AirdayApi(serverUrl.replace(/\/+$/, ""));
  const pre = await api.prelogin(email);
  const derived = deriveLogin(
    password,
    pre.master_salt,
    pre.kdf_params.m_kib,
    pre.kdf_params.t,
    pre.kdf_params.p,
  );
  const resp: LoginResponse = await api.login({
    email,
    auth_secret: derived.authSecret,
    device_name: deviceName,
  });
  if (!resp.device) {
    throw new Error("server did not return a device credential");
  }
  const dek = unwrapDek(derived.kek, resp.wrapped_dek, resp.wrapped_dek_nonce);
  return {
    serverUrl: api.baseUrl,
    email,
    accountId: resp.account_id,
    deviceId: resp.device.device_id,
    deviceToken: resp.device.device_token,
    dek,
    freshSignup: false,
  };
}

async function doSignup(
  serverUrl: string,
  email: string,
  password: string,
  deviceName: string,
): Promise<Session> {
  const api = new AirdayApi(serverUrl.replace(/\/+$/, ""));
  // Default Argon2id params (mirror `KdfParams::DEFAULT` in the
  // protocol crate) plus a fresh random 16-byte salt.
  const kdfParams = { m_kib: 64 * 1024, t: 3, p: 1 };
  const masterSalt = randomBytes(16);
  const derived = deriveLogin(
    password,
    masterSalt,
    kdfParams.m_kib,
    kdfParams.t,
    kdfParams.p,
  );
  // Generate fresh DEK, wrap with KEK locally before shipping.
  const dek = Dek.generate();
  const wrapped = wrapDek(derived.kek, dek);
  const resp = await api.signup({
    email,
    master_salt: masterSalt,
    kdf_params: kdfParams,
    auth_secret: derived.authSecret,
    wrapped_dek: wrapped.ciphertext,
    wrapped_dek_nonce: wrapped.nonce,
    device_name: deviceName,
  });
  return {
    serverUrl: api.baseUrl,
    email,
    accountId: resp.account_id,
    deviceId: resp.device_id,
    deviceToken: resp.device_token,
    dek,
    freshSignup: true,
  };
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function humanError(e: unknown): string {
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
