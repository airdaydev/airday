use serde::Deserialize;

#[derive(Deserialize, Clone)]
#[serde(default)]
pub struct AirdayConfig {
    pub port: usize,
    pub host: String, // TODO: Use an IP address type
    pub sqlx_host: String,
    pub secure_cookies: bool,
}

impl Default for AirdayConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            host: String::from("localhost"),
            sqlx_host: String::from("sqlite:default.db"),
            secure_cookies: true,
        }
    }
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
