# Sharing

**Status:** Planned — not implemented in v1. v1 ships per-doc storage, encryption, and sync (every account has exactly one primary doc), but no membership management UI or endpoints. This spec documents the target design so v1's data model can support it without further migrations.

## Membership model

A doc is a first-class entity (`docs` table). Access is granted by inserting a row into `doc_members`:

```
doc_members(
  doc_id, account_id,
  role,                              -- 'owner' | 'member'
  wrapped_dek, wrapped_dek_nonce,    -- the doc's DEK, wrapped with this member's KEK
  recovery_wrapped_dek, …,           -- iff member opted into recovery
  added_at, removed_at
)
```

Every account has exactly one membership where `role='owner'` and `doc_id = accounts.primary_doc_id`. Shared docs add additional memberships per inviter and invitee. The wrap is **per-membership**, so each member's KEK protects their own copy of the doc's DEK — no symmetric key derivation, no per-member secret leaves the inviter's machine.

Constraints:

- **At least one owner per doc, always.** Removing the last owner is rejected; transferring ownership is a separate operation (`POST .../transfer-ownership`).
- **A member can leave any doc except their primary.** The primary doc is non-leavable, non-deletable; it's the account's Home.
- **Member removal is forward-only** (see "Known limitations").

## Sharing flow (sketch — crypto choice deferred)

The leading candidate is an **invite-code** flow: the inviter generates a one-time unlock key locally, wraps the doc's DEK with it, posts the wrap to the server, and shares a URL whose fragment carries the unlock key. The fragment never reaches the server, so the wrap on its own is useless without the URL. Invitee opens the URL, fetches the wrap, decrypts with the fragment key, signs up or logs in, re-wraps with their own KEK, and accepts.

Alternative considered: **per-account X25519 public keys** for direct asymmetric sharing. More moving parts (new key material on every account, key rotation story, public-key directory) but the invite UX is fully one-shot — no intermediate token. Decision deferred until sharing is actually being built.

### Invite-code flow (illustrative, may change)

1. **Inviter (existing member):**
   - Generates a 32-byte unlock key locally.
   - Wraps the doc's DEK with the unlock key (XChaCha20-Poly1305, fresh nonce).
   - `POST /api/docs/:doc_id/invites` with `{ wrapped_dek, wrapped_dek_nonce, expires_in }` → server returns `{ invite_token }`.
   - Shares URL `https://airday.example/invite/{token}#unlock={base64_key}` out-of-band (Signal, email, paper).

2. **Invitee (account exists or will be created):**
   - Opens URL; client extracts `token` and `unlock_key` from the fragment.
   - `GET /api/invites/:token` → returns `{ doc_id, wrapped_dek, wrapped_dek_nonce, issued_by: { email_hint } }`. Unauthenticated; bearer is the token plus the fragment.
   - Decrypts the wrap with the unlock key → has the doc's DEK in memory.
   - If not logged in: sign up or log in. The client now has the invitee's `kek`.
   - Re-wraps the DEK with `kek`.
   - `POST /api/invites/:token/accept` (authed) with `{ wrapped_dek, wrapped_dek_nonce }` → server inserts a `doc_members` row, consumes the invite, returns `{ doc_id }`.
   - Client opens (or reuses) WS connection, begins subscribing to the new doc.

The server never sees the doc's DEK in plaintext, never sees the unlock key, never sees either party's KEK.

## Ownership transfer

`POST /api/docs/:doc_id/transfer-ownership { to_account_id }` (current owner only): atomic UPDATE setting the target's role to `'owner'`. Old owner stays a member (becomes role `'member'`) unless they also `DELETE .../members/:self` in the same client flow. The doc's `primary_doc_id` pointer on either account is **not** affected — primary doc ≠ owned doc. (You can't transfer ownership of your primary doc; it's not shared in the first place.)

## Member removal

Two paths:

- **Owner removes a member.** `DELETE /api/docs/:doc_id/members/:account_id`. Sets `removed_at` on the membership row (soft-delete for audit). Server immediately:
  - Stops accepting `PushOps`/`Ack`/etc. for `(doc_id, removed_account)` on any WS connection.
  - Excludes the removed account's devices from the doc's horizon calculation, unblocking compaction if they were holding it back.
  - Severs broadcast subscriptions for that account's connections to that doc.
- **Member leaves voluntarily.** `DELETE /api/docs/:doc_id/members/:self`. Same effects; just initiated by the member rather than an owner. Rejected if the member is the sole owner — must transfer first.

In both cases the local client of the removed/leaving account should drop its local copy of the doc (delete the local snapshot, WAL, and DEK entry). The client cannot *enforce* this — if the user took a backup, they keep it.

## Planned endpoints

```
GET    /api/docs                                          -- list current account's memberships + wraps
POST   /api/docs                                          -- create a new doc; body: { wrapped_dek, wrapped_dek_nonce }
DELETE /api/docs/:doc_id                                  -- delete a doc; owner only; must be sole member or all members opt-in (TBD)

POST   /api/docs/:doc_id/invites                          -- issue a share invite
DELETE /api/docs/:doc_id/invites/:invite_id               -- revoke an outstanding invite
GET    /api/invites/:token                                -- fetch invite payload (unauth; token is bearer)
POST   /api/invites/:token/accept                         -- authed; body: { wrapped_dek, wrapped_dek_nonce }

POST   /api/docs/:doc_id/transfer-ownership               -- owner only; body: { to_account_id }
DELETE /api/docs/:doc_id/members/:account_id              -- owner removes member, or member leaves (when :account_id == self)
```

## Planned schema additions

```sql
CREATE TABLE doc_invites (
  token_hash                BLOB PRIMARY KEY,         -- SHA-256(invite_token); the token itself is never stored
  doc_id                    BLOB NOT NULL REFERENCES docs(id),
  issued_by_account_id      BLOB NOT NULL REFERENCES accounts(id),
  wrapped_dek               BLOB NOT NULL,            -- doc DEK wrapped with the inviter's unlock key
  wrapped_dek_nonce         BLOB NOT NULL,
  expires_at                INTEGER NOT NULL,
  consumed_at               INTEGER                   -- nullable; set on accept
);
CREATE INDEX doc_invites_doc_id_idx ON doc_invites (doc_id);
```

No changes to existing tables — `doc_members`, `docs`, etc. already in v1 carry all the membership shape sharing needs.

## Known limitations (accepted for first sharing release)

- **Forward-only revocation.** Removing a member or revoking ownership stops the server from giving them new ops, but they retain their local copy of the doc's DEK and any ops they previously synced. They cannot decrypt *future* ops they don't already have (the server won't deliver them), but they *can* decrypt anything they already pulled. True revocation requires DEK rotation:
  - Generate a fresh doc DEK.
  - Distribute new wraps (`wrapped_dek`) to every remaining member.
  - Encrypt all future ops with the new DEK.
  - Either re-encrypt history (expensive) or accept that history remains readable to anyone who held the old DEK.
  Distributed coordination problem; not solved here. Document loudly in product UI — "removing a member prevents new access; data they already saw is theirs."

- **No history fence on join.** A new member receives the full doc snapshot + op history from the moment they join. There is no "shared only going forward" mode.

- **No per-doc role granularity beyond owner/member.** Read-only roles, time-bound access, etc. are future work.

- **Invite tokens are bearer credentials.** Anyone with the URL (token + fragment) can accept the invite up to its expiry. Mitigation is out-of-band channel hygiene (send via Signal, not SMS); revocation via `DELETE /api/docs/:doc_id/invites/:invite_id`.

- **Shared docs do not affect the recovery model.** Recovery returns wraps for every membership (see `encryption.md` §"Recovery"); a recovered account regains access to every doc it was a member of, exactly as it left them.

## Open questions

- **Invite codes vs X25519 public keys** as the sharing primitive (decision deferred to when sharing is built).
- **Doc deletion semantics** when the doc has multiple members: unilateral owner delete, member-by-member opt-in, or just "leave for everyone else, doc keeps existing for the leaver"? TBD.
- **Discovery / UI** for shared docs: flat list with the primary doc privileged at the top, or a folder-like hierarchy? Out of scope; product question.
