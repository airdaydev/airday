//! Keystore = the union of `Profile.read_secrets()` + Argon2 derivation
//! at session start. This module is currently a thin facade over the
//! plain-file `Secrets` blob. It exists so the eventual keychain
//! integration drops into one place rather than threading through every
//! command.

use airday_core::{Dek, Kek, PasswordMaster};
use airday_protocol::KdfParams;

#[derive(Debug, thiserror::Error)]
pub enum KeystoreError {
    #[error(transparent)]
    Crypto(#[from] airday_core::CryptoError),
    #[error("invalid hex: {0}")]
    Hex(#[from] hex::FromHexError),
}

pub fn derive_master(password: &str, salt: &[u8], params: KdfParams) -> Result<PasswordMaster, KeystoreError> {
    Ok(airday_core::derive_password_master(password.as_bytes(), salt, params)?)
}

pub fn dek_from_hex(hex_dek: &str) -> Result<Dek, KeystoreError> {
    let bytes = hex::decode(hex_dek)?;
    Ok(Dek::from_bytes(&bytes)?)
}

pub fn dek_to_hex(dek: &Dek) -> String {
    hex::encode(dek.as_bytes())
}

#[allow(dead_code)]
pub fn kek_from_master(master: &PasswordMaster) -> Result<Kek, KeystoreError> {
    Ok(master.kek()?)
}
