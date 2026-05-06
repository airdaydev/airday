# Multi-tab strategy

Currently we have a WAL (idb) and a snapshot (OPFS) in our web app. This gets a little weird across multiple tabs.

Locally produces ops appending to WAL is fine, good even.
Remote WAL appends will duplicate per tab! This is redundant work obviously. Also duplicate websocket

Attempting to acquire a navigator.lock for snapshot write (opfs) is fine because it's a biggish, rarer transaction.

It is not viable for WAL which is a hot path.

So our choices going forward are:
- move towards a shared worker with intents/mirror. This approach is good but fairly complex to reliably track sharedworker state / active sessions.
- leader election, with intents/mirror.
- leader election, with followers throwing our remote writes. everything else is per tab.
