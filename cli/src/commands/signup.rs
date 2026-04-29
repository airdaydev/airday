use airday_core::{generate_recovery_code, random_bytes, Dek, Doc};
use airday_protocol::{KdfParams, RecoveryMaterial, SignupRequest, SignupResponse};
use clap::Parser;
use dialoguer::{Confirm, Input};

use crate::config::{DeviceConfig, Profile, Secrets};
use crate::keystore::{derive_master, dek_to_hex};
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
    /// Skip the interactive recovery-code prompt; create an account
    /// without a recovery wrap.
    #[arg(long)]
    pub no_recovery: bool,
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    let email = match args.email {
        Some(e) => e,
        None => Input::new().with_prompt("Email").interact_text()?,
    };
    let password = prompt_new_password("Password")?;
    let device_name = args
        .device_name
        .unwrap_or_else(|| {
            Input::new()
                .with_prompt("Device name")
                .default(default_device_name())
                .interact_text()
                .unwrap_or_else(|_| default_device_name())
        });

    let want_recovery = if args.no_recovery {
        false
    } else {
        Confirm::new()
            .with_prompt("Generate a recovery code? (recommended)")
            .default(true)
            .interact()?
    };

    let kdf_params = KdfParams::DEFAULT;

    println!("Deriving keys (this takes a moment)…");
    let master_salt: [u8; 16] = random_bytes();
    let master = tokio::task::spawn_blocking({
        let pw = password.clone();
        let salt = master_salt.to_vec();
        move || derive_master(&pw, &salt, kdf_params)
    })
    .await??;

    let kek = master.kek()?;
    let auth_secret = master.auth_secret()?;
    let dek = Dek::generate();
    let wrapped = kek.wrap(&dek)?;

    let recovery_code_to_show: Option<String>;
    let recovery_material: Option<RecoveryMaterial> = if want_recovery {
        let code = generate_recovery_code()?;
        let recovery_salt: [u8; 16] = random_bytes();
        let code_str = code.as_str().to_string();
        let salt_vec = recovery_salt.to_vec();
        let r_master = tokio::task::spawn_blocking(move || {
            airday_core::derive_recovery_master(&code_str, &salt_vec, kdf_params)
        })
        .await??;
        let r_kek = r_master.kek()?;
        let r_auth = r_master.auth_secret()?;
        let r_wrapped = r_kek.wrap(&dek)?;
        recovery_code_to_show = Some(code.as_str().to_string());
        Some(RecoveryMaterial {
            recovery_salt: recovery_salt.to_vec(),
            recovery_auth_secret: r_auth.as_bytes().to_vec(),
            recovery_wrapped_dek: r_wrapped.ciphertext,
            recovery_wrapped_dek_nonce: r_wrapped.nonce.to_vec(),
        })
    } else {
        recovery_code_to_show = None;
        None
    };

    let client = Client::new(args.server.clone());
    let resp: SignupResponse = client
        .post(
            "/api/account/signup",
            &SignupRequest {
                email: email.clone(),
                master_salt: master_salt.to_vec(),
                kdf_params,
                auth_secret: auth_secret.as_bytes().to_vec(),
                wrapped_dek: wrapped.ciphertext,
                wrapped_dek_nonce: wrapped.nonce.to_vec(),
                recovery: recovery_material,
                device_name: device_name.clone(),
            },
        )
        .await?;

    let profile = Profile::create(&resp.account_id)?;
    profile.write_device(&DeviceConfig {
        account_id: resp.account_id.clone(),
        email: email.clone(),
        server_url: args.server,
        device_id: resp.device_id,
        last_acked_op_id: 0,
    })?;
    profile.write_secrets(&Secrets {
        device_token: resp.device_token,
        dek_hex: dek_to_hex(&dek),
    })?;
    // Seed the local doc with built-in lists. The seed travels to
    // future devices as the first push on the op stream.
    profile.write_doc(&Doc::new()?)?;

    println!("Account created: {email} ({})", resp.account_id);
    if let Some(code) = recovery_code_to_show {
        println!();
        println!("RECOVERY CODE — write this down NOW. It will not be shown again.");
        println!();
        println!("    {code}");
        println!();
        use std::io::{BufRead, Write};
        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        loop {
            print!("Type the recovery code back to confirm: ");
            stdout.flush()?;
            let mut line = String::new();
            stdin.lock().read_line(&mut line)?;
            let trimmed = line.trim();
            match airday_core::parse_recovery_code(trimmed) {
                Ok(parsed) if parsed.as_str() == code => break,
                Ok(_) => println!("does not match the generated code"),
                Err(_) => println!("not a valid 12-word phrase"),
            }
        }
        println!("Recovery code confirmed.");
    }
    Ok(())
}
