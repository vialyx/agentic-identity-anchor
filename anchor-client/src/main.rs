use anchor_client_lib::config::Config;
use anchor_client_lib::service::daemon::{register_device, run_daemon};
use anyhow::Context;
use clap::Parser;
use std::path::PathBuf;
use tracing::info;

/// Anchor – cross-platform root-of-trust daemon
#[derive(Debug, Parser)]
#[command(name = "anchor-client", version, about)]
struct Cli {
    /// Path to the TOML configuration file
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Run as a background daemon (default behaviour)
    #[arg(long)]
    daemon: bool,

    /// Register this device with the control plane and exit
    #[arg(long)]
    register: bool,

    /// Print version and exit (handled automatically by clap)
    #[arg(long, hide = true)]
    version_flag: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Bootstrap tracing before loading config so early errors are visible.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config_path = cli.config.clone().unwrap_or_else(Config::default_path);

    let config = Config::load(&config_path)
        .with_context(|| format!("Load config from {}", config_path.display()))?;

    // Re-initialise tracing with the level specified in config.
    // The first subscriber is already installed; using a no-op guard keeps it.
    info!("Anchor daemon starting (log_level={})", config.log_level);

    if cli.register {
        register_device(&config).await?;
        return Ok(());
    }

    // --daemon flag or default: run the main loop.
    run_daemon(config).await
}
