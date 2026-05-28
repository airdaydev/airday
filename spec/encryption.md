# Encryption

## Keys

- **DEK** (data encryption key) — 32-byte random, generated client-side **at doc creation** (one DEK per doc — for v1 that means one DEK per account, generated at signup alongside the primary doc). Encrypts every op + snapshot blob for that doc. AEAD: XChaCha20-Poly1305. Different docs have independent, unrelated DEKs.
- **Master** — `Argon2id(password, master_salt)`. One expensive call per session.
- **KEK** (key encryption key) — `HKDF(master, "airday/kek/v1")`. Wraps/unwraps the DEK. Client-only.
- **Auth secret** — `HKDF(master, "airday/auth/v1")`. Sent to server as login credential. Server stores `SHA-256(auth_secret)`. HKDF is one-way — possessing `auth_secret` reveals neither `master` nor `kek`. See `auth.md` for the full password-handling invariant.
- **Recovery code** — 12 words from the English BIP39 wordlist (2048 words). 128 bits of entropy + 4-bit checksum. Generated client-side at signup.
- **Recovery master** — `Argon2id(recovery_code, recovery_salt)`.
- **Recovery KEK** — `HKDF(recovery_master, "airday/recovery_kek/v1")`. Wraps/unwraps the DEK on the recovery path. Client-only.
- **Recovery auth secret** — `HKDF(recovery_master, "airday/recovery_auth/v1")`. Proves possession of the recovery code to the server. Server stores `SHA-256(recovery_auth_secret)`. The recovery wrap is **only** released after this proof — same threat model as the password path: don't hand attackers harvestable wrap material in exchange for an email address.

## Wrap-states stored on server

Wraps live **per-membership** on `doc_members` (see `storage.md`), not on the account row. Every membership row carries:

| Field | When present |
|---|---|
| `wrapped_dek` | always — that doc's DEK wrapped with this member's `kek` |
| `recovery_wrapped_dek` | iff account opted into recovery code — that doc's DEK wrapped with this member's `recovery_kek` |
| `escrowed_dek` | future optional field (Vault-held key wrap) |

An account with N memberships has N independent wraps of N independent DEKs. The account row itself holds no DEK material. For v1 each account has exactly one membership (their primary doc), so this collapses to one wrap per account in practice — but the storage shape is in place to support sharing.

## Recovery tiers

- **Password only** — only `wrapped_dek` on each membership. Lose password → lose data on every doc you're a member of. Power-user mode.
- **Password + recovery code** — both wraps on each membership. Lose password → redeem recovery code → unwrap **every** doc's DEK in one pass → set new password.
- **Password + server escrow** — adds Vault-held escrow per membership. Future work.

User picks tier at signup; can upgrade later (post-v1; see "Open" below). Default UX presents recovery code as recommended.

## Flows

### Signup

1. User picks password and (optionally) generates recovery code (client-side).
2. Client generates `master_salt` (16 bytes random) and (if recovery code) `recovery_salt`.
3. Client computes `master = Argon2id(password, master_salt)` → `kek`, `auth_secret` via HKDF.
4. (If recovery code) Client computes `recovery_master = Argon2id(recovery_code, recovery_salt)` → `recovery_kek`, `recovery_auth_secret` via HKDF.
5. Client generates a **primary-doc DEK** (32 bytes random).
6. Client wraps the primary-doc DEK with `kek` and (if present) `recovery_kek`.
7. Client posts `/api/account/signup` with `email`, `auth_secret`, `master_salt`, `wrapped_dek`, `wrapped_dek_nonce`, optional `{ recovery_salt, recovery_auth_secret, recovery_wrapped_dek, recovery_wrapped_dek_nonce }`. The wrap fields describe the primary doc's DEK.
8. Server creates a `docs` row (primary doc), an `accounts` row pointing at it via `primary_doc_id`, and a `doc_members` row carrying the wraps — all in one transaction (see `storage.md` §"Insertion order at signup"). Server stores `password_hash = SHA-256(auth_secret)` and `recovery_auth_hash = SHA-256(recovery_auth_secret)` (if present) on the account row.

### Login (two-step)

1. Client posts `/api/account/prelogin { email }` → server returns `master_salt` (and `recovery_salt` if present, mostly for symmetry).
2. Client computes `master` → `kek`, `auth_secret`.
3. Client posts `/api/account/login { email, auth_secret }` → server returns `{ primary_doc_id, memberships: [{ doc_id, wrapped_dek, wrapped_dek_nonce }] }`. For v1 `memberships` always contains exactly one entry — the primary doc; the array shape is in place to support sharing.
4. Client unwraps each membership's DEK with `kek` and holds them in memory keyed by `doc_id`.

### Recovery

1. Client posts `/api/account/prelogin { email }` → server returns `{ master_salt, recovery_salt }` (recovery_salt only present if account opted in).
2. User enters recovery code; client computes `recovery_master = Argon2id(recovery_code, recovery_salt)` → `recovery_kek`, `recovery_auth_secret`.
3. Client posts `/api/account/recover { email, recovery_auth_secret }` → server verifies hash, returns `{ memberships: [{ doc_id, recovery_wrapped_dek, recovery_wrapped_dek_nonce }], recovery_session_token }`. **The wraps are only released after the auth proof — never just on email.** Endpoint is rate-limited. For v1 `memberships` has exactly one entry (the primary doc); recovery restores every membership in one pass.
4. Client unwraps each membership's DEK locally with `recovery_kek`.
5. User sets new password. Client generates new `master_salt`, derives new `master` → new `kek`, new `auth_secret`. Re-wraps **every** unwrapped DEK with the new `kek`, producing one `wrapped_dek` per membership.
6. Client posts `/api/account/password/reset { recovery_session_token, new_master_salt, new_auth_secret, memberships: [{ doc_id, wrapped_dek, wrapped_dek_nonce }], device_name }`. Server validates token, atomically updates password material + replaces every `doc_members.wrapped_dek` for this account + creates device row + invalidates token, returns `{ device_id, device_token }`.

### Password change (logged in, has DEKs in memory)

1. Client generates new `master_salt`, derives new `master` → new `kek`, new `auth_secret`. Re-wraps **every** in-memory DEK with the new `kek`, producing one `wrapped_dek` per membership.
2. Client posts `/api/account/password/change` (authenticated by current device token) with `{ current_auth_secret, new_master_salt, new_auth_secret, memberships: [{ doc_id, wrapped_dek, wrapped_dek_nonce }] }`. The `current_auth_secret` is required so the server can re-verify the user *now* (defense against a hijacked logged-in session changing the password). Server atomically updates password material + replaces every `doc_members.wrapped_dek` for this account in one transaction.

## Op encryption

Each op blob is independently encrypted with **the owning doc's DEK** + a fresh 24-byte random nonce. Nonce stored alongside ciphertext. No additional authenticated data currently. The server cannot tell which DEK encrypted any given blob and never needs to — `doc_id` on the wire is solely a routing key (see `sync-protocol.md`).

## Local key storage

Clients hold a `{ doc_id → DEK }` map for every doc the account is a member of. Lookup is by `doc_id` because that's the routing key on the wire.

- CLI: DEKs in memory only by default; OS keychain (macOS Keychain, libsecret on linux) for "stay logged in" — one keychain entry per doc, keyed by `doc_id`. Recovery code never persisted by client.
- Web: persisted via non-extractable WebCrypto AES-GCM wrap in IndexedDB, one entry per doc.

## KDF parameters

Default Argon2id: **`m = 64 MiB, t = 3, p = 1`**. Used for both `master` (password) and `recovery_master` (recovery code).

- **Why 64 MiB.** Below ~32 MiB, commodity GPUs make weak passwords cheap to crack offline against the server-stored wrap. 64 MiB is the convergence point for E2EE consumer apps (Bitwarden, 1Password, ProtonMail all sit in this neighbourhood). Argon2 is the *only* defence for users with weak passwords once the DB leaks — don't shave memory to save 50ms.
- **Why not 256 MiB.** WASM heap pressure. Mobile Safari is mean about big WASM allocations; cheap Android browsers will OOM-kill the worker. 64 MiB sails through everywhere we care about.
- **Performance budget.** ~600–1000ms in WASM on a mid-range phone, ~150–300ms native on laptop. The benchmark bar is the slowest realistic client (WASM in mobile Safari on a ~2019 phone) — anything that breaks 2s there is a UX wound and gets reverted.

**Per-user, server-stored, upgradable.** `kdf_params` lives alongside `master_salt` on the account row and is returned by `/prelogin`. New accounts use the server's current default; existing accounts keep their original params until next password change. This means raising the floor later doesn't break older accounts.

**Password change upgrades params** to the current server default. Re-derivation happens on a path the user already pays for; no extra prompt.

## Open (post-v1)

- **Enable recovery code after signup.** Requires looping over every membership, wrapping its DEK with the new `recovery_kek`, and uploading the batch. Mechanically straightforward; deferred for v1.
- **Member-removal DEK rotation.** Removing a shared-doc member today is forward-only — the removed member retains the DEK locally and can decrypt any ops they previously synced. True revocation requires generating a fresh doc DEK, re-encrypting (or re-wrapping for) future ops, and distributing new wraps to every remaining member. Distributed coordination; deferred. See `sharing.md` for the known-limitation framing.
