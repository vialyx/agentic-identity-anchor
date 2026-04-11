use anyhow::Result;
use clap::{Args, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};
use tabled::Tabled;

use crate::{client::ApiClient, output::{print_item, print_table, OutputFormat}};

#[derive(Args)]
pub struct AgentsArgs {
    #[command(subcommand)]
    cmd: AgentCmd,
}

#[derive(Subcommand)]
enum AgentCmd {
    /// List available agent versions
    List {
        #[arg(long)] platform: Option<String>,
        #[arg(long)] stable: bool,
    },
    /// Publish a new agent version
    Publish {
        #[arg(long)] agent_id: String,
        #[arg(long)] version: String,
        #[arg(long)] platform: String,
        #[arg(long)] arch: String,
        #[arg(long)] file: std::path::PathBuf,
        #[arg(long)] stable: bool,
    },
}

#[derive(Debug, Deserialize, Serialize, Tabled)]
#[serde(rename_all = "camelCase")]
struct AgentVersionRow {
    #[tabled(rename = "Agent ID")]
    agent_id: String,
    #[tabled(rename = "Version")]
    version: String,
    #[tabled(rename = "Platform")]
    platform: String,
    #[tabled(rename = "Arch")]
    arch: String,
    #[tabled(rename = "Stable")]
    stable: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResponse {
    agent_id: String,
    version: String,
    upload_url: String,
}

impl AgentsArgs {
    pub async fn run(self, client: &ApiClient, fmt: &OutputFormat) -> Result<()> {
        match self.cmd {
            AgentCmd::List { platform, stable } => {
                let mut path = "/v1/agents".to_string();
                let mut sep = '?';
                if let Some(p) = &platform {
                    path.push_str(&format!("{sep}platform={p}"));
                    sep = '&';
                }
                if stable {
                    path.push_str(&format!("{sep}stable=true"));
                }
                let items: Vec<AgentVersionRow> = client.get(&path).await?;
                print_table(&items, fmt);
            }
            AgentCmd::Publish { agent_id, version, platform, arch, file, stable } => {
                let body = serde_json::json!({
                    "agentId": agent_id,
                    "version": version,
                    "platform": platform,
                    "arch": arch,
                    "stable": stable,
                });
                let resp: PublishResponse =
                    client.post("/v1/agents/versions", body).await?;

                let bytes = tokio::fs::read(&file).await?;
                let pb = ProgressBar::new(bytes.len() as u64);
                pb.set_style(
                    ProgressStyle::with_template(
                        "{spinner:.green} [{bar:40.cyan/blue}] {bytes}/{total_bytes}",
                    )
                    .unwrap()
                    .progress_chars("=>-"),
                );
                pb.set_position(0);
                client.put_bytes(&resp.upload_url, bytes, "application/octet-stream").await?;
                pb.finish_with_message("uploaded");
                println!("Published {} v{} ({platform}/{arch})", resp.agent_id, resp.version);
                print_item(&resp, fmt);
            }
        }
        Ok(())
    }
}
