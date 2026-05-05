// Auth form (login + signup). Argon2id currently runs on the main
// thread, so show a "deriving keys…" spinner during the
// ~hundreds-of-ms hit. The API origin is the page's origin (vite
// proxies /api/* in dev) — no runtime server picker; self-hosters
// serve their own bundle from their own domain.

import { createSignal, Show } from "solid-js";
import {
  Dek,
  deriveLogin,
  unwrapDek,
  wrapDek,
} from "@airday/core/wasm";
import { api, ApiError, type LoginResponse } from "./api.ts";
import { dekVault } from "./dekVault.ts";
import { useAppI18n } from "./i18n.tsx";

export interface Session {
  /** Local-only session with no server account behind it. The web client
   *  drops a freshly-generated DEK into the vault on first visit so the
   *  user can use the app without an auth wall; sync stays off until they
   *  sign up or log in. */
  anonymous: boolean;
  /** Account id — server-issued for authenticated sessions, locally
   *  generated (`anon-<uuid>`) for anonymous ones. Used to namespace OPFS. */
  accountId: string;
  /** Null on anonymous sessions. */
  email: string | null;
  /** Null on anonymous sessions. */
  deviceId: string | null;
  dek: Dek;
  /** True iff this session was created via signup (we're device 1
   *  and need to seed the doc with built-in lists), or for a freshly
   *  minted anonymous session. False for login sessions and for
   *  reload-restored sessions where OPFS is the source of truth. */
  freshSignup: boolean;
}

function defaultDeviceName(): string {
  return `web-${typeof navigator !== "undefined" ? navigator.platform : "unknown"}`;
}

export function AuthForm(props: {
  initialMode?: "login" | "signup";
  onSession: (s: Session) => void;
}) {
  const { m } = useAppI18n();
  const [mode, setMode] = createSignal<"login" | "signup">(
    props.initialMode ?? "login",
  );
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [deviceName] = createSignal(defaultDeviceName());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session =
        mode() === "login"
          ? await doLogin(email(), password(), deviceName())
          : await doSignup(email(), password(), deviceName());
      props.onSession(session);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="auth-form" onSubmit={submit}>
      <h3 class="auth-popover-title">
        {mode() === "login" ? m().auth.signIn : m().auth.signUp}
      </h3>
      <label>
        {m().auth.email}
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
        {m().auth.password}
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
      <input type="hidden" value={deviceName()} />
      <button type="submit" disabled={busy()}>
        {busy()
          ? m().auth.derivingKeys
          : mode() === "login"
            ? m().auth.signIn
            : m().auth.signUp}
      </button>
      <button
        type="button"
        class="auth-form-toggle"
        disabled={busy()}
        onClick={() => setMode(mode() === "login" ? "signup" : "login")}
      >
        {mode() === "login"
          ? m().auth.noAccount
          : m().auth.haveAccount}
      </button>
      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>
    </form>
  );
}

async function doLogin(
  email: string,
  password: string,
  deviceName: string,
): Promise<Session> {
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
    throw new Error(missingDeviceCredentialMessage());
  }
  const dek = unwrapDek(derived.kek, resp.wrapped_dek, resp.wrapped_dek_nonce);
  const session: Session = {
    anonymous: false,
    email,
    accountId: resp.account_id,
    deviceId: resp.device.device_id,
    dek,
    freshSignup: false,
  };
  await persistVault(session);
  return session;
}

function missingDeviceCredentialMessage(): string {
  return "server did not return a device credential";
}

async function doSignup(
  email: string,
  password: string,
  deviceName: string,
): Promise<Session> {
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
  const session: Session = {
    anonymous: false,
    email,
    accountId: resp.account_id,
    deviceId: resp.device_id,
    dek,
    freshSignup: true,
  };
  await persistVault(session);
  return session;
}

async function persistVault(session: Session): Promise<void> {
  // Wrap the DEK and stash it in IndexedDB so a reload skips the
  // password prompt. Failure is non-fatal — the in-memory session is
  // still usable; the user just gets bounced back to login on reload.
  try {
    await dekVault.save({
      anonymous: session.anonymous,
      accountId: session.accountId,
      email: session.email,
      deviceId: session.deviceId,
      dek: session.dek.clone(),
    });
  } catch (e) {
    console.warn("dekVault.save failed; session will not survive reload:", e);
  }
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
