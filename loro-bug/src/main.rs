//! Reproduces an infinite loop (100% CPU, import never returns) in
//! `ChangeStore::get_change_by_lamport_lte` when importing a small
//! concurrent movable-list update into a doc with a long history.
//!
//! Run:
//!   cargo run --release            # hangs forever in the final import
//!   cargo run --release -- control # same shape, short tail: returns
//!
//! See README.md for the root-cause analysis.

use loro::{ExportMode, LoroDoc};

const PEER_A: u64 = 1;
const PEER_B: u64 = 2;

/// Ops before element "b", so its block is neither the first nor the last.
const OPS_BEFORE_B: usize = 20_000;
/// Long tail: > 8 * MAX_BLOCK_SIZE = 32768 lamports after "b" arms the
/// block bisection in `get_change_by_lamport_lte`, which cannot terminate.
const LONG_TAIL: usize = 40_000;
/// Short tail: the bisection never arms; the descending scan (which does
/// not consult the broken block end-lamport) finds the block and the
/// import returns.
const SHORT_TAIL: usize = 1_000;

fn main() {
    let control = std::env::args().any(|a| a == "control");
    let tail_ops = if control { SHORT_TAIL } else { LONG_TAIL };
    eprintln!(
        "building fixture ({} tail ops, {})",
        tail_ops,
        if control { "control: returns" } else { "hangs" }
    );
    let (snapshot, update) = fixture(tail_ops);

    let target = LoroDoc::new();
    target.import(&snapshot).expect("import snapshot");

    // Diverge locally so the incoming update is concurrent with the local
    // frontier; a linear append would take a fast path that skips the
    // movable-list checkout diff (and its idlp_to_id lookups) entirely.
    target
        .get_text("pad")
        .insert(0, "x")
        .expect("local pad edit");
    target.commit();

    eprintln!("importing move update ({} bytes)...", update.len());
    target.import(&update).expect("import move update");
    eprintln!("move update import returned");
}

/// Build (snapshot, update): peer A's history with movable-list element
/// "b" buried mid-oplog and `tail_ops` filler ops after it, plus a small
/// concurrent peer-B update that moves "b".
fn fixture(tail_ops: usize) -> (Vec<u8>, Vec<u8>) {
    let source = LoroDoc::new();
    source.set_peer_id(PEER_A).expect("set peer id");

    let list = source.get_movable_list("list");
    list.insert(0, "a").expect("insert element a");
    source.commit();

    // Filler ops must not RLE-merge: consecutive list appends collapse
    // into one op that contributes nothing to the block's estimated size,
    // leaving the whole history in a single block (no repro). Inserting at
    // position 0 defeats merging (Insert ops only merge when appended
    // directly after the previous one), like real scattered edits.
    let filler = source.get_list("filler");
    for i in 0..OPS_BEFORE_B {
        filler
            .insert(0, format!("filler-entry-{i:08}"))
            .expect("insert filler");
        if i % 100 == 99 {
            source.commit();
        }
    }
    source.commit();

    // Element "b": created here, never moved or set again in peer A's
    // history, so resolving it later must go through idlp_to_id.
    list.insert(1, "b").expect("insert element b");
    source.commit();

    for i in 0..tail_ops {
        filler
            .insert(0, format!("filler-entry-post-{i:08}"))
            .expect("insert filler");
        if i % 100 == 99 {
            source.commit();
        }
    }
    source.commit();

    let snapshot = source
        .export(ExportMode::Snapshot)
        .expect("export snapshot");

    // Peer B: move "b" and export just that change.
    let editor = LoroDoc::new();
    editor.set_peer_id(PEER_B).expect("set peer id");
    editor.import(&snapshot).expect("import snapshot into editor");
    let before = editor.oplog_vv();
    editor
        .get_movable_list("list")
        .mov(1, 0)
        .expect("move element b");
    editor.commit();
    let update = editor
        .export(ExportMode::updates(&before))
        .expect("export move update");

    (snapshot, update)
}
