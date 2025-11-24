use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use pasetors::keys::{AsymmetricKeyPair, Generate};
use pasetors::version4::V4;

fn generate_keys() -> Result<(), Box<dyn std::error::Error>> {
    let kp = AsymmetricKeyPair::<V4>::generate()?;
    let secret_base64 = BASE64.encode(kp.secret.as_bytes());
    let public_base64 = BASE64.encode(kp.public.as_bytes());
    println!("paseto_pk = {}", public_base64);
    println!("paseto_sk = {}", secret_base64);
    Ok(())
}

fn main() {
    if let Err(e) = generate_keys() {
        eprintln!("Error generating keys: {}", e);
        std::process::exit(1);
    }
}
