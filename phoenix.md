# Airday pheonix

Airday is a local-first, person list app intend for single users to write down & sort intent, options, ideas, reminders. Specifically the unique value proposition of Airday is to be the lowest friction, FOSS* (except the Apple apps), simplest workflow, E2EE, multi-device, single human user, digital capture/intent/log tool.

There is a primary list called "Current", a bin and multiple custom lists. The default custom list is "Holding". Binned items can be individually deleted, restored (either to its parent list if available or back to current) or the entire bin deleted.

Data is E2EE.

The data actions are:

- create_item
- edit_item
- delete_item
- move_item_position

- create_list
- move_list_position
- rename_list
- delete_list (except hot_list)

An item is:

List {
  id: uuid_v7,
  label: String,
}

enum ItemType {
  0 = Text
}

Item {
  id: uuid_v7,
  type: ItemType,
  text: String,
}

(user_id, device_id) -> {
  last_seen_at,
  frontier,    // version vector for the user's whole document
  state_hash,  // optional
  active,
}

## Self-hosted/Saas split
- Initially everything will go in the one repo
- There will be a rust server that acts as the primary relay and auth mechanism. It will run off both sqlite and postgres.
- The postgres version is multi-tenant &
- There will also be a saas orchestration server for payment, licensing etc.
- Prior to release, a core repo will break out and private repo will take core as a submodule.

## Storage:
2x CRDTs:
- Items (LoroMap<string, Item>)
- List of lists (LoroMovableList)
Device state (frontier, auth)

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
- Item kind + List kind
- Ops are stored as op_type "op" per customer with Version Vector (compaction target)
- Snapshots are stored as op_type "snapshot" per customer - pathway to s3 / alt-storage offload

## Bin lifecycle
- Simply a status, full deletes happen at user request and happen on a device

## General architecture
- ZK server <-> Many clients, ZK requests snapshot from client to trim tombstones
- Web: Vanilla JS
- Rust: Core app (shared)
- Loro moveable list seems like a good fit
- Postgres

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
