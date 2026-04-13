use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

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
        Self::load_from_path(profile, &config_path)
    }

    fn load_from_path(profile: &str, config_path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(config_path)
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

#[cfg(test)]
mod tests {
    use super::Config;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_temp_config(content: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time before epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("anchor-ctl-config-{nanos}.toml"));
        std::fs::write(&path, content).expect("failed to write temp config");
        path
    }

    #[test]
    fn load_profile_from_file() {
        let path = write_temp_config(
            r#"
[default]
api_url = "https://api.example.com"
token = "abc123"
"#,
        );

        let cfg = Config::load_from_path("default", &path).expect("failed to load config");
        assert_eq!(cfg.api_url, "https://api.example.com");
        assert_eq!(cfg.token, "abc123");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_profile_returns_error() {
        let path = write_temp_config(
            r#"
[default]
api_url = "https://api.example.com"
token = "abc123"
"#,
        );

        let err =
            Config::load_from_path("prod", &path).expect_err("expected missing profile error");
        let msg = format!("{err:#}");
        assert!(msg.contains("Profile 'prod' not found"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_token_returns_error() {
        let path = write_temp_config(
            r#"
[default]
api_url = "https://api.example.com"
"#,
        );

        let err =
            Config::load_from_path("default", &path).expect_err("expected missing token error");
        let msg = format!("{err:#}");
        assert!(msg.contains("token missing in profile"));

        let _ = std::fs::remove_file(path);
    }
}
