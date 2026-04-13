use anyhow::Result;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use tabled::Tabled;

use crate::{
    client::ApiClient,
    output::{print_item, print_table, OutputFormat},
};

#[derive(Args)]
pub struct DeploymentsArgs {
    #[command(subcommand)]
    cmd: DeploymentCmd,
}

#[derive(Subcommand)]
enum DeploymentCmd {
    /// List deployment policies for a tenant
    List {
        #[arg(long)]
        tenant: String,
    },
    /// Create a deployment policy
    Create {
        #[arg(long)]
        tenant: String,
        #[arg(long)]
        group: String,
        #[arg(long)]
        agent: String,
        #[arg(long)]
        version: String,
        #[arg(long, default_value = "immediate")]
        strategy: String,
        #[arg(long)]
        canary_percent: Option<u8>,
    },
    /// Rollback a deployment to its previous version
    Rollback {
        deployment_id: String,
        #[arg(long)]
        tenant: String,
    },
}

#[derive(Debug, Deserialize, Serialize, Tabled)]
#[serde(rename_all = "camelCase")]
struct DeploymentRow {
    #[tabled(rename = "Deployment ID")]
    policy_id: String,
    #[tabled(rename = "Group")]
    group_id: String,
    #[tabled(rename = "Agent")]
    agent_id: String,
    #[tabled(rename = "Target Version")]
    target_version: String,
    #[tabled(rename = "Strategy")]
    strategy: String,
    #[tabled(rename = "Status")]
    status: String,
}

impl DeploymentsArgs {
    pub async fn run(self, client: &ApiClient, fmt: &OutputFormat) -> Result<()> {
        match self.cmd {
            DeploymentCmd::List { tenant } => {
                let items: Vec<DeploymentRow> = client
                    .get(&format!("/v1/tenants/{tenant}/deployments"))
                    .await?;
                print_table(&items, fmt);
            }
            DeploymentCmd::Create {
                tenant,
                group,
                agent,
                version,
                strategy,
                canary_percent,
            } => {
                let body = serde_json::json!({
                    "groupId": group,
                    "agentId": agent,
                    "targetVersion": version,
                    "strategy": strategy,
                    "canaryPercent": canary_percent.unwrap_or(0),
                });
                let item: DeploymentRow = client
                    .post(&format!("/v1/tenants/{tenant}/deployments"), body)
                    .await?;
                println!("Created deployment: {}", item.policy_id);
                print_item(&item, fmt);
            }
            DeploymentCmd::Rollback {
                deployment_id,
                tenant,
            } => {
                let path = format!("/v1/tenants/{tenant}/deployments/{deployment_id}/rollback");
                let item: DeploymentRow = client.post(&path, serde_json::json!({})).await?;
                println!("Rolled back deployment: {}", item.policy_id);
                print_item(&item, fmt);
            }
        }
        Ok(())
    }
}
