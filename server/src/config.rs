use serde::Deserialize;

#[derive(Deserialize)]
pub struct AirdayConfig {
    pub port: usize,
    pub host: String, // TODO: Use an IP address type
    pub sqlite_host: String,
}

impl AirdayConfig {
    pub fn from_toml(toml_string: &str) -> Self {
        let config_res: Result<AirdayConfig, toml::de::Error> = toml::from_str(toml_string);
        let config = match config_res {
            Ok(config) => config,
            Err(err) => panic!(
                "Failed to parse config string, error propagated from serde:\n {}",
                err
            ),
        };
        config
    }
}
