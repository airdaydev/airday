// use toml::Table;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct AirdayConfig {
    pub port: usize,
    pub host: String, // TODO: Use an IP address type
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
    // pub fn load_config() {
    //     let value = "PORT = 3000".parse::<Table>().unwrap();
    //     assert_eq!(value["PORT"].as_str(), Some("port"));
    //     // AirdayConfig::new(value["PORT"]);
    // }
}
