use crate::agent::manager::AgentManager;
use crate::config::Config;
use crate::health::reporter::HealthReporter;
use crate::transport::client::AnchorClient;
use crate::updater::self_update::SelfUpdater;
use anyhow::Context;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info};

/// Run the anchor daemon main loop.
///
/// Concurrently executes:
/// * health reporter (periodic heartbeat)
/// * agent policy sync loop
/// * self-update check loop
///
/// Exits cleanly on SIGTERM / SIGINT (Unix) or Ctrl-C (Windows).
pub async fn run_daemon(config: Config) -> anyhow::Result<()> {
    info!("Starting Anchor daemon v{}", env!("CARGO_PKG_VERSION"));

    let device_id = load_or_generate_device_id(&config).await?;
    info!("Device ID: {device_id}");

    let client = Arc::new(AnchorClient::new(&config, &device_id)?);
    let agent_manager = Arc::new(AgentManager::new(config.clone(), Arc::clone(&client))?);
    let inventory = agent_manager.inventory();

    let health_reporter = Arc::new(HealthReporter::new(
        Arc::clone(&client),
        Arc::clone(&inventory),
        Duration::from_secs(config.heartbeat_interval_secs),
    ));

    let updater = Arc::new(SelfUpdater::new(config.clone(), Arc::clone(&client)));
    let update_interval = Duration::from_secs(config.update_check_interval_secs);

    let hr = Arc::clone(&health_reporter);
    let am = Arc::clone(&agent_manager);
    let su = Arc::clone(&updater);

    tokio::select! {
        result = async move { hr.run().await } => {
            match result {
                Ok(()) => info!("Health reporter exited"),
                Err(e) => error!("Health reporter error: {e:#}"),
            }
        }
        result = agent_sync_loop(am, config.update_check_interval_secs) => {
            match result {
                Ok(()) => info!("Agent sync loop exited"),
                Err(e) => error!("Agent sync loop error: {e:#}"),
            }
        }
        result = update_check_loop(su, update_interval) => {
            match result {
                Ok(()) => info!("Update check loop exited"),
                Err(e) => error!("Update check loop error: {e:#}"),
            }
        }
        _ = shutdown_signal() => {
            info!("Shutdown signal received; stopping daemon");
        }
    }

    info!("Anchor daemon stopped");
    Ok(())
}

async fn agent_sync_loop(
    manager: Arc<AgentManager>,
    interval_secs: u64,
) -> anyhow::Result<()> {
    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        if let Err(e) = manager.sync().await {
            error!("Agent sync error: {e:#}");
        }
    }
}

async fn update_check_loop(
    updater: Arc<SelfUpdater>,
    interval: Duration,
) -> anyhow::Result<()> {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        match updater.check_and_update().await {
            Ok(true) => {
                // Process replaced itself; we should never reach here in the
                // update path, but handle gracefully anyway.
                info!("Self-update applied");
                break;
            }
            Ok(false) => {}
            Err(e) => error!("Self-update check error: {e:#}"),
        }
    }
    Ok(())
}

/// Wait for SIGTERM or SIGINT (or Ctrl-C on Windows).
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate())
            .expect("Failed to install SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt())
            .expect("Failed to install SIGINT handler");
        tokio::select! {
            _ = sigterm.recv() => {}
            _ = sigint.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl-C handler");
    }
}

/// Load an existing device ID from disk or generate and persist a new UUID.
pub async fn load_or_generate_device_id(config: &Config) -> anyhow::Result<String> {
    let path = config.device_id_path();

    if path.exists() {
        let id = tokio::fs::read_to_string(&path)
            .await
            .context("Read device ID file")?;
        let id = id.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Create data dir: {}", parent.display()))?;
    }
    tokio::fs::write(&path, &new_id)
        .await
        .context("Write device ID file")?;

    info!("Generated new device ID: {new_id}");
    Ok(new_id)
}

/// Register this device with the control plane.
pub async fn register_device(config: &Config) -> anyhow::Result<()> {
    let device_id = load_or_generate_device_id(config).await?;
    let client = AnchorClient::new(config, &device_id)?;

    let hostname = hostname();
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let thumbprint = crate::transport::cert::cert_thumbprint(&config.cert_path)?;

    let resp = client.register(&hostname, &os, &arch, &thumbprint).await?;
    info!("Registration response: status={}", resp.status);

    // Persist the server-assigned device ID (may differ from the locally generated one)
    let id_path = config.device_id_path();
    tokio::fs::write(&id_path, &resp.device_id)
        .await
        .context("Persist server-assigned device ID")?;

    info!("Device registered: {}", resp.device_id);
    Ok(())
}

fn hostname() -> String {
    // Try reading from OS; fall back to a sensible default.
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}
