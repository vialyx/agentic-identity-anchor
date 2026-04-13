use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub api_url: String,
    pub token: String,
}

#[derive(Debug, Deserialize, Default)]
struct ProfileConfig {
    api_url: Option<String>,
    token: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ConfigFile {
    #[serde(flatten)]
    profiles: std::collections::HashMap<String, ProfileConfig>,
}

impl Config {
    pub fn load(profile: &str) -> Result<Self> {
        // Environment variables take precedence
        if let (Ok(api_url), Ok(token)) = (
            std::env::var("ANCHOR_API_URL"),
            std::env::var("ANCHOR_TOKEN"),
        ) {
            return Ok(Config { api_url, token });
        }

        let config_path = Self::config_path();
        let content = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Could not read config file at {}", config_path.display()))?;

        let file: ConfigFile = toml::from_str(&content).context("Failed to parse config file")?;

        let p = file
            .profiles
            .get(profile)
            .with_context(|| format!("Profile '{}' not found in config", profile))?;

        Ok(Config {
            api_url: p.api_url.clone().context("api_url missing in profile")?,
            token: p.token.clone().context("token missing in profile")?,
        })
    }

    fn config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".anchor-ctl")
            .join("config.toml")
    }
}
