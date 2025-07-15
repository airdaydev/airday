use serde::Deserialize;

#[derive(Deserialize, Clone)]
#[serde(default)]
pub struct AirdayConfig {
    pub port: usize,
    pub host: String, // TODO: Use an IP address type
    pub sqlx_host: String,
    pub secure_cookies: bool,
    #[serde(deserialize_with = "deserialize_lowercase")]
    pub log_level: String,
    pub otlp_host: Option<String>,
}

fn deserialize_lowercase<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    Ok(s.to_lowercase())
}

impl Default for AirdayConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            host: String::from("localhost"),
            sqlx_host: String::from("sqlite:default.db"),
            secure_cookies: true,
            otlp_host: None,
            log_level: String::from("info"),
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
