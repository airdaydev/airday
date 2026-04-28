use pasetors::keys::{AsymmetricKeyPair, Generate};
use pasetors::paserk::FormatAsPaserk;
use pasetors::version4::V4;

fn generate_keys() -> Result<(), Box<dyn std::error::Error>> {
    let kp = AsymmetricKeyPair::<V4>::generate()?;
    let mut secret_paserk = String::new();
    kp.secret.fmt(&mut secret_paserk).unwrap();
    let mut public_paserk = String::new();
    kp.public.fmt(&mut public_paserk).unwrap();
    println!("paseto_pk = \"{}\"", public_paserk);
    println!("paseto_sk = \"{}\"", secret_paserk);
    Ok(())
}

fn main() {
    if let Err(e) = generate_keys() {
        eprintln!("Error generating keys: {}", e);
        std::process::exit(1);
    }
}
