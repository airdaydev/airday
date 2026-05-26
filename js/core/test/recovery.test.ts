// End-to-end exercise of the recovery-code flow against the wasm
// crypto surface — no server, no transport. Mirrors the protocol the
// CLI follows (cli/src/commands/signup.rs and recover.rs):
//
//   signup    : generate code → derive recovery KEK/auth → wrap DEK twice
//                (password KEK + recovery KEK)
//   recover   : parse code → re-derive recovery KEK/auth → unwrap recovery
//                wrap → DEK matches original
//   reset pwd : derive *new* password KEK from new password+salt → wrap
//                recovered DEK with new KEK → unwrap → DEK matches
//
// Argon2id uses test-weak params (m=8 KiB, t=1, p=1) so the suite stays
// snappy; the real KdfParams::DEFAULT (64 MiB, t=3) is exercised in
// Rust unit tests and not worth paying for here.

import { describe, expect, test } from "bun:test";

import {
  Dek,
  deriveLogin,
  deriveRecovery,
  generateRecoveryCode,
  parseRecoveryCode,
  unwrapDek,
  wrapDek,
} from "../wasm/airday_core_web.js";

const KDF = { m: 8, t: 1, p: 1 } as const;

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

describe("recovery code primitives", () => {
  test("generateRecoveryCode produces 12 BIP39 words", () => {
    const code = generateRecoveryCode();
    expect(code.split(/\s+/).length).toBe(12);
  });

  test("parseRecoveryCode normalizes whitespace", () => {
    const code = generateRecoveryCode();
    const messy = `   ${code.replace(/ /g, "\n   ")}   `;
    expect(parseRecoveryCode(messy)).toBe(code);
  });

  test("parseRecoveryCode rejects a non-BIP39 phrase", () => {
    expect(() =>
      parseRecoveryCode(
        "this is not a valid bip39 phrase at all please reject",
      ),
    ).toThrow();
  });

  test("deriveRecovery is deterministic for a given (code, salt, params)", () => {
    const code = generateRecoveryCode();
    const salt = randomSalt();
    const a = deriveRecovery(code, salt, KDF.m, KDF.t, KDF.p);
    const b = deriveRecovery(code, salt, KDF.m, KDF.t, KDF.p);
    expect(Array.from(a.recoveryKek)).toEqual(Array.from(b.recoveryKek));
    expect(Array.from(a.recoveryAuthSecret)).toEqual(
      Array.from(b.recoveryAuthSecret),
    );
  });

  test("recovery KEK and auth secret are distinct (HKDF separation)", () => {
    const code = generateRecoveryCode();
    const salt = randomSalt();
    const d = deriveRecovery(code, salt, KDF.m, KDF.t, KDF.p);
    expect(Array.from(d.recoveryKek)).not.toEqual(
      Array.from(d.recoveryAuthSecret),
    );
  });
});

describe("signup → recover → password reset", () => {
  test("recovery KEK opens the recovery wrap, then a new password KEK can re-wrap the DEK", () => {
    // -- signup -------------------------------------------------------
    const password = "correct horse battery staple";
    const masterSalt = randomSalt();
    const recoverySalt = randomSalt();

    const passwordDerived = deriveLogin(
      password,
      masterSalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );
    const recoveryCode = generateRecoveryCode();
    const recoveryDerived = deriveRecovery(
      recoveryCode,
      recoverySalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );

    const dek = Dek.generate();
    const dekHex = dek.toHex();

    const passwordWrapped = wrapDek(passwordDerived.kek, dek.clone());
    const recoveryWrapped = wrapDek(recoveryDerived.recoveryKek, dek.clone());

    // Sanity: the two wraps differ (random nonces + distinct KEKs).
    expect(Array.from(passwordWrapped.ciphertext)).not.toEqual(
      Array.from(recoveryWrapped.ciphertext),
    );

    // -- recover ------------------------------------------------------
    // User has lost their password, types their 12 words, possibly
    // with stray whitespace.
    const typed = `  ${recoveryCode.replace(/ /g, "  ")}  `;
    const normalized = parseRecoveryCode(typed);
    const recoveredDerived = deriveRecovery(
      normalized,
      recoverySalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );
    // The auth secret is what the client ships to /api/account/recover
    // — round-trip equality is what proves the server-side check would
    // pass.
    expect(Array.from(recoveredDerived.recoveryAuthSecret)).toEqual(
      Array.from(recoveryDerived.recoveryAuthSecret),
    );

    const recoveredDek = unwrapDek(
      recoveredDerived.recoveryKek,
      recoveryWrapped.ciphertext,
      recoveryWrapped.nonce,
    );
    expect(recoveredDek.toHex()).toBe(dekHex);

    // -- set new password --------------------------------------------
    const newPassword = "tr0ub4dor & 3";
    const newMasterSalt = randomSalt();
    const newPasswordDerived = deriveLogin(
      newPassword,
      newMasterSalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );
    const newPasswordWrapped = wrapDek(
      newPasswordDerived.kek,
      recoveredDek.clone(),
    );

    // Old password no longer unlocks the wrap that ships to the server.
    const reUnwrapped = unwrapDek(
      newPasswordDerived.kek,
      newPasswordWrapped.ciphertext,
      newPasswordWrapped.nonce,
    );
    expect(reUnwrapped.toHex()).toBe(dekHex);
    expect(() =>
      unwrapDek(
        passwordDerived.kek,
        newPasswordWrapped.ciphertext,
        newPasswordWrapped.nonce,
      ),
    ).toThrow();
  });

  test("wrong recovery code fails to unwrap", () => {
    const recoverySalt = randomSalt();
    const realCode = generateRecoveryCode();
    const realDerived = deriveRecovery(
      realCode,
      recoverySalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );
    const dek = Dek.generate();
    const wrapped = wrapDek(realDerived.recoveryKek, dek);

    // A different valid 12-word phrase — same salt, different code.
    let wrongCode = generateRecoveryCode();
    while (wrongCode === realCode) wrongCode = generateRecoveryCode();
    const wrongDerived = deriveRecovery(
      wrongCode,
      recoverySalt,
      KDF.m,
      KDF.t,
      KDF.p,
    );

    expect(Array.from(wrongDerived.recoveryAuthSecret)).not.toEqual(
      Array.from(realDerived.recoveryAuthSecret),
    );
    expect(() =>
      unwrapDek(wrongDerived.recoveryKek, wrapped.ciphertext, wrapped.nonce),
    ).toThrow();
  });

  test("wrong recovery_salt also fails (server-side mix-up scenario)", () => {
    const code = generateRecoveryCode();
    const realSalt = randomSalt();
    const wrongSalt = randomSalt();
    const real = deriveRecovery(code, realSalt, KDF.m, KDF.t, KDF.p);
    const skewed = deriveRecovery(code, wrongSalt, KDF.m, KDF.t, KDF.p);
    const dek = Dek.generate();
    const wrapped = wrapDek(real.recoveryKek, dek);
    expect(() =>
      unwrapDek(skewed.recoveryKek, wrapped.ciphertext, wrapped.nonce),
    ).toThrow();
  });
});
