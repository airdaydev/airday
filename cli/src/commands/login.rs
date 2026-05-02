use airday_core::{Doc, WrappedDek};
use airday_protocol::{
    DeviceRegistration, LoginRequest, LoginResponse, PreloginRequest, PreloginResponse,
};
use clap::Parser;
use dialoguer::{Input, Password};

use crate::config::{DeviceConfig, Profile, Secrets};
use crate::keystore::{dek_to_hex, derive_master};
use crate::net::Client;

use super::{default_device_name, default_server};

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
    let password: String = Password::new().with_prompt("Password").interact()?;
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

    println!("Deriving keys…");
    let master_salt = pre.master_salt.clone();
    let kdf_params = pre.kdf_params;
    let master = tokio::task::spawn_blocking({
        let pw = password;
        move || derive_master(&pw, &master_salt, kdf_params)
    })
    .await??;
    let kek = master.kek()?;
    let auth_secret = master.auth_secret()?;

    let resp: LoginResponse = client
        .post(
            "/api/account/login",
            &LoginRequest {
                email: email.clone(),
                auth_secret: auth_secret.as_bytes().to_vec(),
                register_device: Some(DeviceRegistration { name: device_name }),
            },
        )
        .await?;

    let nonce: [u8; airday_core::AEAD_NONCE_LEN] = resp
        .wrapped_dek_nonce
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("server returned wrapped_dek_nonce of wrong length"))?;
    let dek = kek.unwrap(&WrappedDek {
        ciphertext: resp.wrapped_dek,
        nonce,
    })?;

    let device = resp.device.ok_or_else(|| {
        anyhow::anyhow!("server did not return a device credential despite register_device")
    })?;

    let profile = Profile::create(&resp.account_id)?;
    profile.write_device(&DeviceConfig {
        account_id: resp.account_id.clone(),
        email,
        server_url: args.server,
        device_id: device.device_id,
        last_acked_op_id: 0,
        last_sync_at: None,
    })?;
    profile.write_secrets(&Secrets {
        device_token: device.device_token,
        dek_hex: dek_to_hex(&dek),
    })?;
    // Empty doc; the next subcommand's Session::open pulls from op
    // id 0, applies device-1's seed + history, and we converge.
    profile.write_doc(&Doc::empty())?;

    println!("Logged in to account {}", resp.account_id);
    if !resp.recovery_present {
        println!("(no recovery code is enrolled — losing your password loses your data)");
    }
    Ok(())
}
