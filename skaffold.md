# Airday spec (todo list - working title)

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

## Storage:
2x CRDTs
Items (LoroMap<string, Item>)
A single list (LoroMovableList)

## List limits
256 (max lists) * 4096 * (280 utf-8 chars) = 300MB english, 900MB Chinese / Japanese

## Snapshots

Snapshots are requested by server from a single (any) client after a certain threshold is reached.

## Bin lifecycle

## General architecture
- ZK server <-> Many clients, ZK requests snapshot from client to trim tombstones
- Web: Vanilla JS
- Rust: Core app (shared)
- Loro moveable list seems like a good fit

## Self-hosted architecture
- Core app

## SaaS architecture
Email address -> account
- Separate rust app for bootstrapping

## Storage
2 CRDT lists

## Encryption
- Key management plan

## Pricing
USD$49 lifetime

## MCP
Yes - via local tool
For non-technical people, without running local infra, it would have to be mediated via an API through an intermediary containing key.

## Why the name Airday
It was going to be a big fat calendar app, the legacy of which continues (https://danielgormly.github.io/primavera-ui/cal/). Now the google result ranks fairly well & a 6-letter domain with two english words is pretty good.

## Devices
I am targeting, in order:
1. CLI
2. Web
3. iOS
4. Android (fdroid/google play)
5. MacOS (app store)
6. Apple watch (app store)
