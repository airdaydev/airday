# Airday pheonix

Airday is a local-first, person list app intend for single users to write down & sort intent, options, ideas, reminders. Specifically the unique value proposition of Airday is to be the lowest friction, FOSS* (except the Apple apps), simplest workflow, E2EE, multi-device, single human user, digital capture/intent/log tool.

There is a primary list called "Current", a bin and multiple custom lists. The default custom list is "Holding". Binned items can be individually deleted, restored (either to its parent list if available or back to current) or the entire bin deleted.

## Broad architecture
- ZK server <-> many device, single user (at least semantically)
- Web: Vanilla JS
- Rust: Core app powers both saas & self-hosted
- Feature flagged postgres module for saas
- Feature flagged sqlite module for self-hosted
- Server stores loro shallow snapshots + ops
- E2EE via password derived KEK wrapping DEK
- Server held KEK by default with opt-out (recovery code only)
- Items (LoroMovableList<Item>)
- List of lists (LoroMovableList)
- Users
- Device state (frontier, auth)
- Stripe

## Tables

users (
  id              uuid_v7 primary key,
  email           text unique not null,
  password_hash   text not null,            -- argon2id of password (server auth)
  password_salt   bytea not null,           -- salt for KEK derivation (sent to client)
  wrapped_dek     bytea not null,           -- DEK encrypted by KEK
  wrapped_dek_nonce bytea not null,
  created_at      timestamptz not null,
  has_recovery_escrow boolean not null default true,
  has_recovery_code   boolean not null default false,
)

-- TODO: Move to vault?
recovery_escrow (
  user_id         uuid primary key references users(id),
  escrowed_dek    bytea not null,           -- DEK encrypted by server-held key
  escrowed_dek_nonce bytea not null,
  updated_at      timestamptz not null
)

-- Devices: per-device sync state
devices (
  id              uuid primary key,
  user_id         uuid not null references users(id),
  name            text not null,            -- "Dan's iPhone"
  auth_token_hash text not null,            -- for device authentication to server
  frontier        bytea not null,           -- encoded Loro version vector
  state_hash      bytea,                    -- optional, for drift detection
  last_seen_at    timestamptz not null,
  created_at      timestamptz not null
)

-- Ops: encrypted CRDT operations, append-only
ops (
  id              bigserial primary key,    -- server-assigned sequence (for range queries)
  user_id         uuid not null references users(id),
  origin_device   uuid references devices(id),
  payload         bytea not null,           -- encrypted Loro op blob
  payload_nonce   bytea not null,
  created_at      timestamptz not null
)
create index on ops (user_id, id);

-- Snapshots: encrypted shallow snapshots, replaceable per user
snapshots (
  id              bigserial primary key,
  user_id         uuid not null references users(id),
  up_to_op_id     bigint not null,          -- snapshot covers ops with id <= this
  payload         bytea,                    -- encrypted snapshot blob (null if offloaded)
  payload_nonce   bytea,
  storage_location text not null default 'inline',  -- 'inline' | 's3://bucket/key'
  created_at      timestamptz not null
)
create index on snapshots (user_id, id desc);

## Saas database
-- SaaS / billing (separate concern, could be separate service)
subscriptions (
  user_id         uuid primary key references users(id),
  stripe_customer_id text not null,
  status          text not null,            -- 'active' | 'lapsed' | 'lifetime'
  purchased_at    timestamptz,
  expires_at      timestamptz                -- null for lifetime
)

## Front-end types

enum RecoveryTier {
    ServerEscrow,                        // default; server can assist recovery
    RecoveryCodeOnly,                    // user-held code, no server escrow
    NonCustodial,                        // password + devices only
}

struct UserAccount {
  user_id: Uuid,
  email: String,
  recoverMode: RecoveryMode,
  dek: SecretBytes, // unwrapped, in-memory only
}

struct Keys {
    kek: SecretBytes,                    // derived from password + salt
    dek: SecretBytes,                    // unwrapped from server's wrapped_dek
}

struct Device {
    device_id: Uuid,
    name: String,
    auth_token: SecretString,
    frontier: VersionVector,             // local Loro frontier
}

List {
  id: uuid_v7,
  label: String,
}

enum ItemType {
  0 = Text
}

enum ItemStatus {
    Live,
    Parked,                              // (if you keep park as a state vs. just using a list)
    Done,
    Binned,
    Deleted,
}

// Items: a MovableList of Maps. Each Map is one item.
// Loro path: doc.get_movable_list("items")
struct Item {
  type: Text,
  text: String,
  list_id: String,                     // refers to ListMeta.id
  status: ItemStatus,
  created_at: i64,                     // millis since epoch
  done_at: Option<i64>,
}

// Loro path: doc.get_movable_list("lists")
struct ListMeta {
  id: String,                          // stable string id (used in Item.list_id)
  name: String,
  created_at: i64,
}

(user_id, device_id) -> {
  last_seen_at,
  frontier,    // version vector for the user's whole document
  state_hash,  // optional
  active,
}

## Actions

- create_item
- edit_item
- delete_item
- move_item_position

- create_list
- move_list_position
- rename_list
- delete_list (except hot_list)

## Protocol
// === Sync messages (over the wire, JSON for v1) ===

#[derive(Serialize, Deserialize)]
struct SyncEnvelope {
    v: u32,                              // protocol version (always present)
    device_id: Uuid,
    auth_token: String,
    payload: SyncPayload,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum SyncPayload {
    PushOps {
        ops: Vec<EncryptedBlob>,
        new_frontier: VersionVector,
    },
    PullOps {
        since_op_id: i64,
    },
    PullSnapshot,
    PushSnapshot {
        up_to_op_id: i64,
        snapshot: EncryptedBlob,
    },
    UpdateFrontier {
        frontier: VersionVector,
        state_hash: Option<Vec<u8>>,
    },
}

#[derive(Serialize, Deserialize)]
struct EncryptedBlob {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

// === Auth / recovery messages ===

#[derive(Serialize, Deserialize)]
struct SignupRequest {
    email: String,
    password_hash: String,               // client-side hash for server auth
    password_salt: Vec<u8>,              // salt for KEK derivation
    wrapped_dek: EncryptedBlob,
    tier: RecoveryTier,
    escrowed_dek: Option<EncryptedBlob>, // present iff tier == ServerEscrow
}

#[derive(Serialize, Deserialize)]
struct LoginRequest {
    email: String,
    password_hash: String,
}

#[derive(Serialize, Deserialize)]
struct LoginResponse {
    user_id: Uuid,
    password_salt: Vec<u8>,
    wrapped_dek: EncryptedBlob,
    tier: RecoveryTier,
}

## Self-hosted/Saas split
- Initially everything will go in the one repo
- There will be a rust server that acts as the primary relay and auth mechanism. It will run off both sqlite and postgres.
- The postgres version is multi-tenant
- There will also be a saas orchestration server for payment, licensing etc.
- Prior to release, a core repo will break out and private repo will take core as a submodule.

## List limits
256 (max lists) * 4096 * (280 utf-8 chars) = ~300MB english, ~900MB Chinese / Japanese

## Snapshots
- Snapshots (loro shallow snapshots) are requested by server from a single (any) client after a threshold is reached - 10000 ops. last seen frontier per client must be tracked by server so we can computer horizon. frontiers are reported after each sync. out-of-date clients will be called stale clients. no connection within 6mo + a stale version vector = stale. Maybe easiest way to detect is a merge failure - or we can anticipate a failure. An client with a stale db will have the option to export their data & then catch up (steamroll).

## Encryption
- Key derivation function (KDF)
- Data encryption key (DEK)
- Key encryption key (KEK)
- Recovery code (secondary encryption - BIP39-style)

## Initial encryption flow
1. user defines password
2. app generates a min 32-byte DEK
3. app derives KEK from user's pw (e.g. Argon2)
4. app uses kek to encrypt dek
5. encrypted DEK uploaded to server
6. DEK on client used to encrypt data

## Storage
- Postgresql module (via feature flag) for saas
- Sqlite module (via feature flag) for self-hosted
- ops: (user_id, version_vector, op_data, created_at)
- snapshots: (user_id, version_vector, snapshot_data, created_at, storage_location)

## Bin lifecycle
- Simply a status, full deletes happen at user request and happen on a device

## Websocket
- encode as JSON first, later try baremessages.org, messagepack, flatbuffer or protobuff

## Self-hosted architecture
- Core app
- Sqlite

## SaaS architecture
Email address -> account
- Separate rust app for bootstrapping

## Storage
2 CRDT lists

## Pricing
USD$49 lifetime

## MCP
Yes - via local tool
For non-technical people, without running local infra, it would have to be mediated via an API through an intermediary containing key.

## Devices
I am targeting, in order:
1. CLI
2. Web
3. iOS
4. Android (fdroid/google play)
5. MacOS (app store)
6. Apple watch (app store)
