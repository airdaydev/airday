// Per-account device row — sync identity + resume cursor.
//
// Lives in the `airday-web` database (alongside vault + prefs), keyed
// per account. It is the web analogue of the CLI's `device.json`:
// `lastAckedSeq` is the durable resume cursor the engine is seeded with
// at boot and re-persisted as it advances. Kept separate from the
// engine's op-log database (`airday-engine`) for the same reason the
// CLI keeps the cursor in config rather than deriving it from the op
// log — compaction prunes acked rows, so the op log can't be the
// source of truth for "how far has the server acked us."
//
// Extracted from the now-retired `IdbWalStorage` so the engine op log
// can move to `IdbStorage` while this row stays put. The row shape
// (`{ account_id, device }`) is unchanged, so existing device rows
// written by the WAL build are read back verbatim.

import { type DeviceConfig, normalizeDeviceConfig } from "./adapter.ts";
import { openAirdayDb, STORE_DEVICE } from "./web-db.ts";

interface DeviceRow {
  account_id: string;
  device: DeviceConfig;
}

export async function getDevice(
  accountId: string,
): Promise<DeviceConfig | null> {
  const db = await openAirdayDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DEVICE, "readonly");
    const req = tx.objectStore(STORE_DEVICE).get(accountId);
    req.onsuccess = () => {
      const row = req.result as DeviceRow | undefined;
      resolve(normalizeDeviceConfig(row?.device));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putDevice(
  accountId: string,
  device: DeviceConfig,
): Promise<void> {
  const db = await openAirdayDb();
  const row: DeviceRow = { account_id: accountId, device };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_DEVICE, "readwrite");
    tx.objectStore(STORE_DEVICE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("device put aborted"));
  });
}
