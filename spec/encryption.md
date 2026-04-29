# Encryption

## Keys

- **DEK** (data encryption key) — 32-byte random, generated client-side at signup. Encrypts every op + snapshot blob. AEAD: XChaCha20-Poly1305.
- **Master** — `Argon2id(password, master_salt)`. One expensive call per session.
- **KEK** (key encryption key) — `HKDF(master, "airday/kek/v1")`. Wraps/unwraps the DEK. Client-only.
- **Auth secret** — `HKDF(master, "airday/auth/v1")`. Sent to server as login credential. Server stores `SHA-256(auth_secret)`. HKDF is one-way — possessing `auth_secret` reveals neither `master` nor `kek`. See `auth.md` for the full password-handling invariant.
- **Recovery code** — 12 words from the English BIP39 wordlist (2048 words). 128 bits of entropy + 4-bit checksum. Generated client-side at signup.
- **Recovery master** — `Argon2id(recovery_code, recovery_salt)`.
- **Recovery KEK** — `HKDF(recovery_master, "airday/recovery_kek/v1")`. Wraps/unwraps the DEK on the recovery path. Client-only.
- **Recovery auth secret** — `HKDF(recovery_master, "airday/recovery_auth/v1")`. Proves possession of the recovery code to the server. Server stores `SHA-256(recovery_auth_secret)`. The recovery wrap is **only** released after this proof — same threat model as the password path: don't hand attackers harvestable wrap material in exchange for an email address.

## Wrap-states stored on server

| Field | When present |
|---|---|
| `wrapped_dek` | always (password-KEK wrap) |
| `recovery_wrapped_dek` | iff user opted into recovery code |
| `escrowed_dek` | sprint 2+ only (Vault-held key wrap) |

## Recovery tiers

- **Password only** — only `wrapped_dek`. Lose password → lose data. Power-user mode.
- **Password + recovery code** — both wraps. Lose password → redeem recovery code → unwrap DEK → set new password.
- **Password + server escrow** — adds Vault-held escrow. Sprint 2+. Out of sprint 1.

User picks tier at signup; can upgrade later. Default UX presents recovery code as recommended.

## Flows

### Signup

1. User picks password and (optionally) generates recovery code (client-side).
2. Client generates `master_salt` (16 bytes random) and (if recovery code) `recovery_salt`.
3. Client computes `master = Argon2id(password, master_salt)` → `kek`, `auth_secret` via HKDF.
4. (If recovery code) Client computes `recovery_master = Argon2id(recovery_code, recovery_salt)` → `recovery_kek`, `recovery_auth_secret` via HKDF.
5. Client generates DEK (32 bytes random).
6. Client wraps DEK with `kek` and (if present) `recovery_kek`.
7. Client posts `/api/account/signup` with `email`, `auth_secret`, `master_salt`, `wrapped_dek`, `wrapped_dek_nonce`, optional `{ recovery_salt, recovery_auth_secret, recovery_wrapped_dek, recovery_wrapped_dek_nonce }`.
8. Server stores `password_hash = SHA-256(auth_secret)`, `recovery_auth_hash = SHA-256(recovery_auth_secret)` (if present), and the salts/wraps as-is.

### Login (two-step)

1. Client posts `/api/account/prelogin { email }` → server returns `master_salt` (and `recovery_salt` if present, mostly for symmetry).
2. Client computes `master` → `kek`, `auth_secret`.
3. Client posts `/api/account/login { email, auth_secret }` → server returns `wrapped_dek`, `wrapped_dek_nonce`.
4. Client unwraps DEK with `kek`.

### Recovery

1. Client posts `/api/account/prelogin { email }` → server returns `{ master_salt, recovery_salt }` (recovery_salt only present if account opted in).
2. User enters recovery code; client computes `recovery_master = Argon2id(recovery_code, recovery_salt)` → `recovery_kek`, `recovery_auth_secret`.
3. Client posts `/api/account/recover { email, recovery_auth_secret }` → server verifies hash, returns `{ recovery_wrapped_dek, recovery_wrapped_dek_nonce, recovery_session_token }`. **The wrap is only released after the auth proof — never just on email.** Endpoint is rate-limited.
4. Client unwraps DEK locally with `recovery_kek`.
5. User sets new password. Client generates new `master_salt`, derives new `master` → new `kek`, new `auth_secret`. Wraps DEK with new `kek`.
6. Client posts `/api/account/password/reset { recovery_session_token, new_master_salt, new_auth_secret, new_wrapped_dek, new_wrapped_dek_nonce, device_name }`. Server validates token, atomically updates password material + creates device row + invalidates token, returns `{ device_id, device_token }`.

### Password change (logged in, has DEK in memory)

1. Client generates new `master_salt`, derives new `master` → new `kek`, new `auth_secret`. Wraps DEK with new `kek`.
2. Client posts `/api/account/password/change` (authenticated by current device token) with `{ current_auth_secret, new_master_salt, new_auth_secret, new_wrapped_dek, new_wrapped_dek_nonce }`. The `current_auth_secret` is required so the server can re-verify the user *now* (defense against a hijacked logged-in session changing the password).

## Op encryption

Each op blob is independently encrypted with the DEK + a fresh 24-byte random nonce. Nonce stored alongside ciphertext. No additional authenticated data in sprint 1.

## Local key storage

- CLI: DEK in memory only by default; OS keychain (macOS Keychain, libsecret on linux) for "stay logged in." Recovery code never persisted by client.
- Web: TBD — sprint 2+.

## KDF parameters

Default Argon2id: **`m = 64 MiB, t = 3, p = 1`**. Used for both `master` (password) and `recovery_master` (recovery code).

- **Why 64 MiB.** Below ~32 MiB, commodity GPUs make weak passwords cheap to crack offline against the server-stored wrap. 64 MiB is the convergence point for E2EE consumer apps (Bitwarden, 1Password, ProtonMail all sit in this neighbourhood). Argon2 is the *only* defence for users with weak passwords once the DB leaks — don't shave memory to save 50ms.
- **Why not 256 MiB.** WASM heap pressure. Mobile Safari is mean about big WASM allocations; cheap Android browsers will OOM-kill the worker. 64 MiB sails through everywhere we care about.
- **Performance budget.** ~600–1000ms in WASM on a mid-range phone, ~150–300ms native on laptop. The benchmark bar is the slowest realistic client (WASM in mobile Safari on a ~2019 phone) — anything that breaks 2s there is a UX wound and gets reverted.

**Per-user, server-stored, upgradable.** `kdf_params` lives alongside `master_salt` on the account row and is returned by `/prelogin`. New accounts use the server's current default; existing accounts keep their original params until next password change. This means raising the floor later doesn't break older accounts.

**Password change upgrades params** to the current server default. Re-derivation happens on a path the user already pays for; no extra prompt.

