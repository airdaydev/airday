// Stage 5 of slice 4: the wasm `Dek.seal/open` symmetry that the
// browser OPFS adapter relies on for encrypt-at-rest. The full OPFS
// adapter only runs in a browser; this file validates the underlying
// crypto primitive in Bun without standing up `navigator.storage`.

import { describe, expect, test } from "bun:test";

import { Dek, deriveLogin, wrapDek, unwrapDek } from "../wasm/airday_core_web.js";

describe("Dek.seal / Dek.open round-trip", () => {
  test("seal then open recovers the plaintext", () => {
    const dek = Dek.generate();
    const plaintext = new TextEncoder().encode("hello opfs");
    const blob = dek.seal(plaintext);
    const back = dek.open(blob);
    expect(new TextDecoder().decode(back)).toBe("hello opfs");
  });

  test("opening with the wrong DEK throws", () => {
    const a = Dek.generate();
    const b = Dek.generate();
    const blob = a.seal(new Uint8Array([1, 2, 3]));
    expect(() => b.open(blob)).toThrow();
  });

  test("DEK clone produces a key that opens the original's blobs", () => {
    const a = Dek.generate();
    const b = a.clone();
    const blob = a.seal(new Uint8Array([7, 7, 7]));
    expect(Array.from(b.open(blob))).toEqual([7, 7, 7]);
  });
});

describe("wrapDek / unwrapDek round-trip", () => {
  test("wrap with kek then unwrap with same kek returns the same DEK", () => {
    const salt = new Uint8Array(16).fill(1);
    const derived = deriveLogin("correct horse battery staple", salt, 8, 1, 1);
    const dek = Dek.generate();
    const orig = dek.toHex();
    const wrapped = wrapDek(derived.kek, dek);
    const recovered = unwrapDek(derived.kek, wrapped.ciphertext, wrapped.nonce);
    expect(recovered.toHex()).toBe(orig);
  });
});
