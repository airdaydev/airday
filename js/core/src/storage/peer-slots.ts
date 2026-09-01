// Stable per-slot Loro peer id for the web client — the browser
// analogue of the CLI's `read_or_mint_peer_slot` (`cli/src/peer.rs`,
// design in `spec/peer-id-plan.md`).
//
// The mapping (slot → peer id) lives in the `peer_slots` IDB store and
// is minted once, then read forever. The mapping alone is NOT the
// claim: minting under a slot's peer id is only safe while the caller
// holds the Web Lock that owns that slot (today: the single-tab gate's
// `airday-single-tab` lock owns slot 0). No lock held → don't call
// this; boot with a random peer instead. Two live docs on one peer
// mint duplicate `(peer, counter)` op ids — unrecoverable corruption.
//
// Read-or-mint runs get + conditional put inside ONE readwrite
// transaction, so even a racing pair of calls converges on a single
// minted id (IDB serialises readwrite transactions per store).

import { openAirdayDb, type PeerSlotRow, STORE_PEER_SLOTS } from "./web-db.ts";

/** Loro reserves `u64::MAX` (`set_peer_id` rejects it). */
const RESERVED_PEER = 0xffffffffffffffffn;

/** Random u64 peer id, never the reserved `u64::MAX` — mirrors the
 *  CLI's `mint_peer_id`. */
function mintPeerId(): bigint {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let peer = 0n;
    for (const b of bytes) peer = (peer << 8n) | BigInt(b);
    if (peer !== RESERVED_PEER) return peer;
  }
}

/**
 * The stable peer id for `slot`, minting and persisting one on first
 * use. Returns a `bigint` ready for `Doc.createWithPeer` /
 * `Doc.emptyWithPeer`. Callers must hold the slot's Web Lock — see the
 * module header.
 */
export async function readOrMintPeerSlot(slot: number): Promise<bigint> {
  const db = await openAirdayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PEER_SLOTS, "readwrite");
    const store = tx.objectStore(STORE_PEER_SLOTS);
    const get = store.get(slot);
    let peer: bigint | null = null;
    get.onsuccess = () => {
      const row = get.result as PeerSlotRow | undefined;
      if (row) {
        peer = BigInt(`0x${row.peerIdHex}`);
        return;
      }
      peer = mintPeerId();
      store.put({
        slot,
        peerIdHex: peer.toString(16).padStart(16, "0"),
        createdAt: Date.now(),
      } satisfies PeerSlotRow);
    };
    tx.oncomplete = () => {
      if (peer === null) reject(new Error("peer slot read never ran"));
      else resolve(peer);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("peer slot tx aborted"));
  });
}
