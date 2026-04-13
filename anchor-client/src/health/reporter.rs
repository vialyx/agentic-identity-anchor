use crate::agent::inventory::Inventory;
use crate::transport::client::{AgentInfo, AnchorClient, HeartbeatPayload};
use anyhow::Context;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Disks, System};
use tokio::sync::Mutex;
use tracing::{error, info};

pub struct HealthReporter {
    client: Arc<AnchorClient>,
    inventory: Arc<Mutex<Inventory>>,
    interval: Duration,
}

impl HealthReporter {
    pub fn new(
        client: Arc<AnchorClient>,
        inventory: Arc<Mutex<Inventory>>,
        interval: Duration,
    ) -> Self {
        Self {
            client,
            inventory,
            interval,
        }
    }

    /// Run a continuous heartbeat loop using tokio's interval timer.
    pub async fn run(&self) -> anyhow::Result<()> {
        let mut ticker = tokio::time::interval(self.interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if let Err(e) = self.send_heartbeat().await {
                error!("Heartbeat error: {e:#}");
            }
        }
    }

    /// Collect system metrics and dispatch a single heartbeat to the control plane.
    pub async fn send_heartbeat(&self) -> anyhow::Result<()> {
        let (cpu_usage, memory_used, memory_total, disk_used, disk_total, uptime) =
            tokio::task::spawn_blocking(collect_system_metrics)
                .await
                .context("Spawn blocking for metrics")?;

        let agents: Vec<AgentInfo> = {
            let inv = self.inventory.lock().await;
            inv.list()
                .iter()
                .map(|a| AgentInfo {
                    agent_id: a.agent_id.clone(),
                    version: a.version.clone(),
                    status: a.status.to_string(),
                })
                .collect()
        };

        let payload = HeartbeatPayload {
            device_id: String::new(), // filled by AnchorClient (it owns device_id)
            cpu_usage_percent: cpu_usage,
            memory_used_bytes: memory_used,
            memory_total_bytes: memory_total,
            disk_used_bytes: disk_used,
            disk_total_bytes: disk_total,
            uptime_seconds: uptime,
            agents,
            timestamp: Utc::now().to_rfc3339(),
        };

        self.client
            .heartbeat(payload)
            .await
            .context("Send heartbeat")?;

        info!("Heartbeat sent (cpu={cpu_usage:.1}%)");
        Ok(())
    }
}

/// Run inside a blocking thread since sysinfo is synchronous.
fn collect_system_metrics() -> (f32, u64, u64, u64, u64, u64) {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    let uptime = System::uptime();

    let disks = Disks::new_with_refreshed_list();
    let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
    let disk_available: u64 = disks.iter().map(|d| d.available_space()).sum();
    let disk_used = disk_total.saturating_sub(disk_available);

    (cpu_usage, memory_used, memory_total, disk_used, disk_total, uptime)
}
