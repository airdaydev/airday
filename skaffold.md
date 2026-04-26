# Airday spec (todo list - working title)

Airday is a local-first list app intend for single users to write down & sort intent, options, ideas, reminders. Specifically the unique value proposition of Airday is to be the lowest friction, FOSS* (except the Apple apps), simplest workflow, E2EE, multi-device, single human user, digital capture/intent/log tool.

There is a primary list called "Current", a bin and multiple custom lists. The default custom list is "Holding". Binned items can be individually deleted, restored (either to its parent list if available or back to current) or the entire bin deleted.

Data is E2EE.

The actions are:

- create_item
- edit_item
- delete_item

- edit_item

- create_list
- move_list_position
- rename_list
- delete_list (except hot_list)

## Storage:
2x CRDTs
Items
Lists

## List limits
256 (max lists) * 4096 * (280 utf-8 chars) = 300MB english, 900MB Chinese / Japanese


## Rollover

The Current list is the most likely hot list. Rollover may be applied at a certain threshold as achieved by consensus through the system. When another clients receives word of a rollover, that client:
- Cycles through the list that rolls over
- for their own copy of the source list, they find items that match (on id?) - check if there are any pending updates, apply text/data updates on those matching items in the new list if hot list they relegate to a custom list as "current_{date}_archive"

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

## Pricing

## MCP
Required

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
