## Limits

256 lists × 4096 items × 280 chars ≈ 300 MB English / 900 MB CJK. Treat as soft caps for now; enforcement is out of scope.

## Performance note:
Currently (2026.07) on a Mac M1 with ~6000 items performs reasonably, there is a very slight (my own perception) toll on web UI (that depends on data mutations) for moving items for example. A quick test shows The release-WASM core was ~0.13 ms per move with 10k historical items, so 10 FPS points to tens of milliseconds in JS reactivity/rendering - global changes per move? Seems likely.

In the case where there are say 10k live items, the 0.13ms should be ok even in the mega moveable list. In the case where the bulk of the items are in Done - we could move them into a second, simpler doc (like UUID-keyed map). Slight risk of data loss and or duplication (incl risk of UUID dupe).

Snapshots remain single encrypted blobs, but boot no longer multiplies their cost: local snapshot/tail replay finalizes indexes once, server bootstrap persists the received blob without immediately re-exporting it, and bulk state changes cross the UI boundary as one `FullResync` plus one compact workspace materialization. Chunking the snapshot format remains a future option if single-blob memory itself becomes the measured limit.
