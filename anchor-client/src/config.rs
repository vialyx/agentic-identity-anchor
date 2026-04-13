use anyhow::Context;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub tenant_id: String,
    pub device_id: Option<String>,
    pub control_plane_url: String,
    pub cert_path: String,
    pub key_path: String,
    pub ca_cert_path: String,
    pub data_dir: String,
    pub heartbeat_interval_secs: u64,
    pub update_check_interval_secs: u64,
    pub log_level: String,
}

impl Config {
    pub fn load(path: &Path) -> anyhow::Result<Config> {
        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;
        let config: Config =
            toml::from_str(&contents).with_context(|| "Failed to parse config TOML")?;
        Ok(config)
    }

    pub fn default_path() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            PathBuf::from(r"C:\ProgramData\Anchor\config.toml")
        }
        #[cfg(not(target_os = "windows"))]
        {
            PathBuf::from("/etc/anchor/config.toml")
        }
    }

    pub fn device_id_path(&self) -> PathBuf {
        PathBuf::from(&self.data_dir).join("device_id")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Missing required field: {0}")]
    MissingField(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    Parse(#[from] toml::de::Error),
}
