# Auth

## HTTP endpoints

```
POST   /api/account/signup
POST   /api/account/prelogin           (returns salt(s) for an email)
POST   /api/account/login              (password path)
POST   /api/account/recover            (recovery-code path; gated by recovery_auth_secret)
POST   /api/account/password/change    (change password, authed by device token + current_auth_secret)
POST   /api/account/password/reset     (set new password, authed by recovery_session_token)
GET    /api/devices                    (list current account's devices)
POST   /api/devices                    (register a new device)
DELETE /api/devices/:device_id
```

WebSocket upgrade: `GET /api/sync` with `Authorization: Bearer <device_token>`. Server validates on upgrade; the connection is bound to `(account_id, device_id)` for its lifetime. No per-message auth. (Frame encoding + version handshake: see `sync-protocol.md`.)

All HTTP request and response bodies are MessagePack-encoded (`Content-Type: application/msgpack`). Same encoding as the WS path; one wire format across the system.

## Token model

- Opaque random 32-byte token, hex-encoded. Stored server-side as `auth_token_hash` (SHA-256 is sufficient — the token is already high-entropy).
- Issued per-device on registration. Revocable via `DELETE /api/devices/:id`.

**Sprint 1 (CLI only):** forever tokens. Adds zero security in the CLI threat model — if your host is compromised, the attacker has the DEK from keychain/memory anyway, so token expiry doesn't help.

**When web ships (sprint 2+):** add `POST /api/account/refresh`. Short-lived access token + long-lived refresh token in HttpOnly cookie. XSS is the real threat in browsers and refresh tokens are the standard mitigation. CLI keeps forever tokens via the same auth endpoints.

## Account model

- One account per email.
- Password is the master key for E2EE. The server **never** sees it in any form from which the KEK could be derived.
- **Email verification is not part of sprint 1 / self-hosted.** Email is just an account identifier; self-hosters must be able to run without an SMTP dependency. SaaS (sprint 2+) layers verification on top — the core auth flow stays identical, the SaaS build gates signup/login on a `verified_at` column populated by a verification round-trip.

## Password handling — never sent in plaintext

**Invariant: the raw password never leaves the client, ever.** A server that sees the password (request body, log line, heap dump, malicious admin) has the salt too and can derive the KEK → unwrap DEK → decrypt everything. Any path that lets plaintext password reach the server breaks E2EE entirely. TLS does not protect against this — TLS terminates at the server, which then has plaintext in memory.

Client-side derivation (one Argon2id pass, two HKDF splits):

```
master       = Argon2id(password, master_salt)
kek          = HKDF(master, info = "airday/kek/v1")
auth_secret  = HKDF(master, info = "airday/auth/v1")
```

- `kek` is used to wrap/unwrap the DEK. **Never leaves the client.**
- `auth_secret` is sent to the server as the login credential. HKDF is one-way, so possession of `auth_secret` reveals neither `master` nor `kek`.

Server-side:

- Stores `password_hash = SHA-256(auth_secret)` and `password_salt = master_salt`.
- On login: client posts `auth_secret`; server SHA-256s and compares. SHA-256 is enough server-side because `auth_secret` already has Argon2id cost baked in; no rainbow-table risk.
- A DB leak yields `password_hash`, not `auth_secret` → not directly usable to log in.

## Login is two-step

Client cannot derive `auth_secret` without the salt. Standard pattern:

1. `POST /api/account/prelogin { email }` → server returns `{ password_salt, kdf_params }`, or **404 if email unknown**. We accept that this leaks account existence: signup (duplicate-email rejection) and recovery already leak the same bit, so faking a deterministic dummy salt here would be theatre while costing every typo'd-email attempt a full client-side Argon2id pass. Defence is rate-limiting (per-IP + per-email backoff), not response shaping. Revisit only if Airday ever holds data where "is X a user" is itself sensitive.
2. Client computes `master`, `kek`, `auth_secret` from the password and salt.
3. `POST /api/account/login { email, auth_secret }` → server verifies, returns `{ wrapped_dek, wrapped_dek_nonce, recovery_present, device_token? }` (device_token only if registering this client as a device in the same call; otherwise client follows up with `POST /api/devices`).
4. Client unwraps DEK with `kek`.

## Device pairing

### Device 1 (signup)
1. POST `/api/account/signup` with all the encryption material.
2. Server creates account + initial device row, returns `device_token`.

### Device 2 (existing account)
1. POST `/api/account/prelogin { email }` → returns `password_salt`.
2. Client derives `master` → `kek`, `auth_secret` from password + salt.
3. POST `/api/account/login { email, auth_secret }` → returns `wrapped_dek`.
4. Client unwraps DEK with `kek`.
5. POST `/api/devices` → returns new `device_token`.
6. WS connect, `PullSnapshot` if present, then `PullOps`.

### Recovery (lost password / fresh device)
1. POST `/api/account/prelogin { email }` → `{ master_salt, recovery_salt }`.
2. Client computes `recovery_master = Argon2id(recovery_code, recovery_salt)` → `recovery_kek`, `recovery_auth_secret`.
3. POST `/api/account/recover { email, recovery_auth_secret }` → server verifies `SHA-256(recovery_auth_secret) == recovery_auth_hash`, returns `{ recovery_wrapped_dek, recovery_wrapped_dek_nonce, recovery_session_token }`. **Wrap is never released without this proof.** `recovery_session_token` is single-use and TTL 15 min — long enough to type a strong new password without rushing, short enough that an abandoned tab doesn't leave the reset window open.
4. Client unwraps DEK locally with `recovery_kek`.
5. Client picks new password, derives new `master_salt`, `master`, `kek`, `auth_secret`; re-wraps DEK.
6. POST `/api/account/password/reset { recovery_session_token, new_master_salt, new_auth_secret, new_wrapped_dek, new_wrapped_dek_nonce, device_name }` → atomically updates password material + creates device row + invalidates session token, returns `{ device_id, device_token }`.
7. WS connect, `PullSnapshot` if present, then `PullOps`.

## Rate limiting

All three credential endpoints (`/prelogin`, `/login`, `/recover`) rate-limit per-IP and per-email with exponential backoff. `/recover` gets the strictest limits — it gates the recovery wrap, so a successful brute-force is account takeover, not just a login. `/prelogin` is the most lenient (legitimate clients hit it on every login).
