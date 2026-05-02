use airday_core::{derive_recovery_master, parse_recovery_code, random_bytes, Doc, WrappedDek};
use airday_protocol::{
    KdfParams, PasswordResetRequest, PasswordResetResponse, PreloginRequest, PreloginResponse,
    RecoverRequest, RecoverResponse,
};
use clap::Parser;
use dialoguer::Input;

use crate::config::{DeviceConfig, Profile, Secrets};
use crate::keystore::{dek_to_hex, derive_master};
use crate::net::Client;

use super::{default_device_name, default_server, prompt_new_password};

#[derive(Parser, Debug)]
pub struct Args {
    #[arg(long, default_value_t = default_server())]
    pub server: String,
    #[arg(long)]
    pub email: Option<String>,
    #[arg(long)]
    pub device_name: Option<String>,
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    let email = match args.email {
        Some(e) => e,
        None => Input::new().with_prompt("Email").interact_text()?,
    };
    let phrase: String = Input::new()
        .with_prompt("Recovery code (12 words)")
        .interact_text()?;
    let recovery_code = parse_recovery_code(&phrase)?;
    let new_password = prompt_new_password("New password")?;
    let device_name = args.device_name.unwrap_or_else(|| {
        Input::new()
            .with_prompt("Device name")
            .default(default_device_name())
            .interact_text()
            .unwrap_or_else(|_| default_device_name())
    });

    let client = Client::new(args.server.clone());
    let pre: PreloginResponse = client
        .post(
            "/api/account/prelogin",
            &PreloginRequest {
                email: email.clone(),
            },
        )
        .await?;
    let recovery_salt = pre
        .recovery_salt
        .ok_or_else(|| anyhow::anyhow!("this account does not have a recovery code enrolled"))?;
    let kdf_params = pre.kdf_params;

    println!("Verifying recovery code…");
    let r_master = {
        let phrase = recovery_code.as_str().to_string();
        let salt = recovery_salt.clone();
        tokio::task::spawn_blocking(move || derive_recovery_master(&phrase, &salt, kdf_params))
            .await??
    };
    let r_kek = r_master.kek()?;
    let r_auth = r_master.auth_secret()?;

    let recovered: RecoverResponse = client
        .post(
            "/api/account/recover",
            &RecoverRequest {
                email: email.clone(),
                recovery_auth_secret: r_auth.as_bytes().to_vec(),
            },
        )
        .await?;

    let r_nonce: [u8; airday_core::AEAD_NONCE_LEN] = recovered
        .recovery_wrapped_dek_nonce
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("server returned recovery wrap nonce of wrong length"))?;
    let dek = r_kek.unwrap(&WrappedDek {
        ciphertext: recovered.recovery_wrapped_dek,
        nonce: r_nonce,
    })?;

    println!("Re-keying with new password…");
    let new_master_salt: [u8; 16] = random_bytes();
    let new_master = {
        let pw = new_password;
        let salt = new_master_salt.to_vec();
        tokio::task::spawn_blocking(move || derive_master(&pw, &salt, KdfParams::DEFAULT)).await??
    };
    let new_kek = new_master.kek()?;
    let new_auth = new_master.auth_secret()?;
    let new_wrapped = new_kek.wrap(&dek)?;

    let reset: PasswordResetResponse = client
        .post(
            "/api/account/password/reset",
            &PasswordResetRequest {
                recovery_session_token: recovered.recovery_session_token,
                new_master_salt: new_master_salt.to_vec(),
                new_kdf_params: KdfParams::DEFAULT,
                new_auth_secret: new_auth.as_bytes().to_vec(),
                new_wrapped_dek: new_wrapped.ciphertext,
                new_wrapped_dek_nonce: new_wrapped.nonce.to_vec(),
                device_name,
            },
        )
        .await?;

    let profile = Profile::create(&recovered.account_id)?;
    profile.write_device(&DeviceConfig {
        account_id: recovered.account_id.clone(),
        email,
        server_url: args.server,
        device_id: reset.device_id,
        last_acked_op_id: 0,
        last_sync_at: None,
    })?;
    profile.write_secrets(&Secrets {
        device_token: reset.device_token,
        dek_hex: dek_to_hex(&dek),
    })?;
    profile.write_doc(&Doc::empty())?;

    println!("Recovery complete. Account {}.", recovered.account_id);
    Ok(())
}
