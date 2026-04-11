use anyhow::Result;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use tabled::Tabled;

use crate::{client::ApiClient, output::{print_item, print_table, OutputFormat}};

#[derive(Args)]
pub struct DevicesArgs {
    #[command(subcommand)]
    cmd: DeviceCmd,
}

#[derive(Subcommand)]
enum DeviceCmd {
    /// List devices for a tenant
    List {
        #[arg(long)] tenant: String,
        #[arg(long)] group: Option<String>,
        #[arg(long)] status: Option<String>,
    },
    /// Get details of a single device
    Get {
        device_id: String,
        #[arg(long)] tenant: String,
    },
    /// Quarantine a device
    Quarantine {
        device_id: String,
        #[arg(long)] tenant: String,
    },
}

#[derive(Debug, Deserialize, Serialize, Tabled)]
#[serde(rename_all = "camelCase")]
struct DeviceRow {
    #[tabled(rename = "Device ID")]
    device_id: String,
    #[tabled(rename = "Hostname")]
    hostname: String,
    #[tabled(rename = "OS")]
    os: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Last Seen")]
    last_seen: String,
    #[tabled(rename = "Group")]
    #[serde(default)]
    group_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceDetail {
    device_id: String,
    hostname: String,
    os: String,
    arch: String,
    status: String,
    last_seen: String,
    #[serde(default)]
    group_id: String,
    #[serde(default)]
    cert_thumbprint: String,
}

impl DevicesArgs {
    pub async fn run(self, client: &ApiClient, fmt: &OutputFormat) -> Result<()> {
        match self.cmd {
            DeviceCmd::List { tenant, group, status } => {
                let mut path = format!("/v1/tenants/{tenant}/devices");
                let mut sep = '?';
                if let Some(g) = &group {
                    path.push_str(&format!("{sep}groupId={g}"));
                    sep = '&';
                }
                if let Some(s) = &status {
                    path.push_str(&format!("{sep}status={s}"));
                }
                let items: Vec<DeviceRow> = client.get(&path).await?;
                print_table(&items, fmt);
            }
            DeviceCmd::Get { device_id, tenant } => {
                let path = format!("/v1/tenants/{tenant}/devices/{device_id}");
                let item: DeviceDetail = client.get(&path).await?;
                print_item(&item, fmt);
            }
            DeviceCmd::Quarantine { device_id, tenant } => {
                let path = format!("/v1/tenants/{tenant}/devices/{device_id}/status");
                let _: serde_json::Value = client
                    .patch(&path, serde_json::json!({"status": "quarantined"}))
                    .await?;
                println!("Device {device_id} quarantined.");
            }
        }
        Ok(())
    }
}
