use airday_core::random_bytes;
use airday_protocol::{KdfParams, PasswordChangeRequest, PreloginRequest, PreloginResponse};
use dialoguer::Password;

use super::prompt_new_password;
use crate::config::Profile;
use crate::keystore::{dek_from_hex, derive_master};
use crate::net::Client;

pub async fn run() -> anyhow::Result<()> {
    let profile = Profile::require_active()?;
    let device = profile.read_device()?;
    let secrets = profile.read_secrets()?;

    let current_password: String = Password::new().with_prompt("Current password").interact()?;
    let new_password = prompt_new_password("New password")?;

    let client = Client::new(device.server_url.clone());
    let pre: PreloginResponse = client
        .post(
            "/api/account/prelogin",
            &PreloginRequest {
                email: device.email.clone(),
            },
        )
        .await?;

    println!("Verifying current password…");
    let current_master = {
        let pw = current_password;
        let salt = pre.master_salt.clone();
        let params = pre.kdf_params;
        tokio::task::spawn_blocking(move || derive_master(&pw, &salt, params)).await??
    };
    let current_auth = current_master.auth_secret()?;

    println!("Re-keying…");
    let new_master_salt: [u8; 16] = random_bytes();
    let new_master = {
        let pw = new_password;
        let salt = new_master_salt.to_vec();
        tokio::task::spawn_blocking(move || derive_master(&pw, &salt, KdfParams::DEFAULT)).await??
    };
    let new_kek = new_master.kek()?;
    let new_auth = new_master.auth_secret()?;

    let dek = dek_from_hex(&secrets.dek_hex)?;
    let new_wrapped = new_kek.wrap(&dek)?;

    client
        .post_authed_no_response(
            "/api/account/password/change",
            &secrets.device_token,
            &PasswordChangeRequest {
                current_auth_secret: current_auth.as_bytes().to_vec(),
                new_master_salt: new_master_salt.to_vec(),
                new_kdf_params: KdfParams::DEFAULT,
                new_auth_secret: new_auth.as_bytes().to_vec(),
                new_wrapped_dek: new_wrapped.ciphertext,
                new_wrapped_dek_nonce: new_wrapped.nonce.to_vec(),
            },
        )
        .await?;

    // The DEK didn't change — only its server-side wrap. Local secrets
    // file already holds the correct DEK + device token.
    let _ = profile;

    println!("Password changed.");
    Ok(())
}
