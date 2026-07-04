# Loro import hang: infinite loop in `ChangeStore::get_change_by_lamport_lte`

Importing a small, valid, concurrent movable-list update into a `LoroDoc`
with a long history can hang forever: `import()` never returns and burns
100% CPU. The import is deterministic — the same update against the same
snapshot hangs every time.

- **Affected:** loro / loro-internal `1.12.0` and `1.13.6` (latest release);
  the relevant code is unchanged on git `main` as of 2026-07-04.
- **Repro:** `cargo run --release` in this directory (pure public `loro`
  API, ~60k-op synthetic doc, hangs in the final import).
  `cargo run --release -- control` runs the identical shape with a short
  history tail and returns, isolating the trigger.

## Observed behavior

The final `import()` spins forever on one thread. Sampled stack:

```
LoroDoc::import_with
→ import_changes_and_apply_delta_to_state_if_needed
→ DiffCalculator::calc_diff_internal
→ MovableListDiffCalculator::calculate_diff
→ MovableListHistoryCache::last_value
→ OpLog::idlp_to_id
→ ChangeStore::get_change_by_lamport_lte      ← loops forever
→ BTreeMap::range_mut                          (re-created every iteration)
```

Attaching a debugger to the loop shows a frozen state, e.g.
`lower_bound = 26095`, `upper_bound = 26096`, `is_binary_searching = true`,
with every iteration probing the same block and re-assigning
`lower_bound = (lower_bound + upper_bound) / 2` — a no-op once
`upper - lower == 1`.

## Root cause

Two defects combine.

### 1. Block header decode loses the block's end lamport

In the change-block header, `counters` is decoded with an extra final
entry so that `counters.last()` is the block's **end** counter — but
`lamports` gets no such entry: it holds only each change's **start**
lamport. The decoder even computes the true end (`lamport_start +
lamport_len`) and uses it only to derive the last change's start
(`crates/loro-internal/src/oplog/change_store/block_meta_encode.rs`,
`decode_changes_header`):

```rust
// the last lamport
let last_len = *lengths.last().unwrap_or(&0) as u32;
let last_lamport = lamport_start
    .checked_add(lamport_len)
    .and_then(|end| end.checked_sub(last_len))?;
lamports.push(last_lamport as Lamport);   // last change's START lamport

// we need counter range, so encode
counters.push(first_counter.checked_add(counter_len)?);  // real END counter
```

`ChangesBlock::from_bytes` (`crates/loro-internal/src/oplog/change_store.rs`)
then builds the block metadata from those vecs:

```rust
let counter_range = (header.counter, *header.counters.last()...);   // (start, end)   ✅
let lamport_range = (*header.lamports.first()..., *header.lamports.last()...);
//                                    ^ (start, LAST CHANGE'S START)  ❌ not the end
```

So for any block decoded from storage, `lamport_range.1` is the start
lamport of its last change, not the block's end. For a **single-change
block** the range degenerates to `(start, start)` — and single-change
blocks are the common case, because changes with equal timestamps merge
on import (`ChangesBlock::push_change` merges until the ~4 KB block size
estimate fills).

Blocks built in memory by `push_change` maintain `lamport_range.1`
correctly; only the decode path is affected.

### 2. The lamport bisection cannot terminate without that end value

`ChangeStore::get_change_by_lamport_lte` (same file) walks a peer's
blocks backwards; when the probed block starts more than
`8 * MAX_BLOCK_SIZE = 32768` lamports above the target it switches to a
hand-rolled bisection over `mem_parsed_kv`. The bisection recognizes the
containing block with:

```rust
if block.lamport_range.0 <= idlp.lamport
    && (!is_binary_searching || idlp.lamport < block.lamport_range.1)
```

With the stale `lamport_range.1`, any target lamport that falls inside a
block's **last change** fails `idlp.lamport < block.lamport_range.1` —
for single-change blocks, that is *every lamport in the block*. From
there:

- blocks whose (stale) end is `<= target` push `lower_bound` up — and
  that now **includes the containing block itself**;
- blocks starting above the target push `upper_bound` down;
- no block can ever satisfy the found-condition, so once
  `upper_bound - lower_bound == 1`, `mid_bound == lower_bound` and the
  loop state stops changing entirely: infinite loop.

The non-bisection descending scan short-circuits the `lamport_range.1`
test (`!is_binary_searching || …`), which is why short histories work by
accident, and why the bug only appears once the 32768-lamport gap arms
the bisection.

## Trigger conditions

All of these must hold, which is why the hang is rare in the wild:

1. **A movable-list element created long ago and never moved or set
   since.** The movable-list diff's `last_value`/`last_pos` find no Set /
   Move entry in the history caches and fall back to
   `OpLog::idlp_to_id(elem_id)` → `get_change_by_lamport_lte`.
2. **A checkout-mode diff** — the incoming update must be concurrent with
   the local frontier (multi-device sync). A linear append takes a fast
   path that never performs these lookups.
3. **> 32768 lamports of history after the element's creation op**, so
   the probe gap arms the bisection.

`export(ExportMode::state_only(..))` + re-import works around the hang by
dropping the op history entirely.

## Suggested fix

A change's lamport span equals its counter span, so the decode path has
everything it needs. In `ChangesBlock::from_bytes`:

```rust
let last_change_len = header.counters[n] - header.counters[n - 1];
let lamport_range = (
    *header.lamports.first()?,
    *header.lamports.last()? + last_change_len as Lamport,  // true block end
);
```

(or equivalently, push `lamport_start + lamport_len` onto
`header.lamports` during decode, mirroring `counters`). Independently,
the bisection in `get_change_by_lamport_lte` deserves a progress guard —
today any inconsistency in block metadata converts into a hard hang.

## Notes on the fixture shape (`src/main.rs`)

Two non-obvious details were needed to reproduce this with synthetic
data; both mirror what real documents do naturally:

- **Filler ops must not RLE-merge.** Consecutive `list.push(...)` calls
  collapse into a single op that contributes nothing to the block-size
  estimate, so the entire history stays in one block and the lookup never
  bisects. Inserting at position 0 defeats merging, like real scattered
  edits.
- **Same-timestamp changes merge on import** regardless of the source
  doc's merge settings, producing exactly the single-change blocks whose
  decoded `lamport_range` degenerates to `(start, start)`.

## How this was found

A production multi-device doc (~4.4 MB snapshot, movable lists) began
hanging one client deterministically on a 102-byte update that moved a
months-old list element. Sampling showed the stack above; a debugger on
the live loop showed the frozen `lower/upper` bounds; instrumenting
`get_change_by_lamport_lte` revealed every in-memory block reporting a
degenerate `lamports=(X, X)` range, which led back to the header decode.
This crate is the minimized, data-free reconstruction.
