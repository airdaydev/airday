// Per-origin DEK vault singleton. The implementation lives in
// `@airday/core/storage/dek-vault`; this module constructs the single
// instance the web client uses and injects the wasm `Dek.fromHex`
// factory so core stays type-only on wasm.

import { Dek } from "@airday/core/wasm";
import { DekVault } from "@airday/core/storage/dek-vault";

export type { VaultedSession } from "@airday/core/storage/dek-vault";

export const dekVault = new DekVault((hex) => Dek.fromHex(hex));
