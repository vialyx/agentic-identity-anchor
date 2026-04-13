use anyhow::Result;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use tabled::Tabled;

use crate::{
    client::ApiClient,
    output::{print_item, print_table, OutputFormat},
};

#[derive(Args)]
pub struct GroupsArgs {
    #[command(subcommand)]
    cmd: GroupCmd,
}

#[derive(Subcommand)]
enum GroupCmd {
    /// List groups for a tenant
    List {
        #[arg(long)]
        tenant: String,
    },
    /// Create a new group
    Create {
        #[arg(long)]
        tenant: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        description: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize, Tabled)]
#[serde(rename_all = "camelCase")]
struct GroupRow {
    #[tabled(rename = "Group ID")]
    group_id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Description")]
    #[serde(default)]
    description: String,
}

impl GroupsArgs {
    pub async fn run(self, client: &ApiClient, fmt: &OutputFormat) -> Result<()> {
        match self.cmd {
            GroupCmd::List { tenant } => {
                let items: Vec<GroupRow> =
                    client.get(&format!("/v1/tenants/{tenant}/groups")).await?;
                print_table(&items, fmt);
            }
            GroupCmd::Create {
                tenant,
                name,
                description,
            } => {
                let body = serde_json::json!({
                    "name": name,
                    "description": description.unwrap_or_default()
                });
                let item: GroupRow = client
                    .post(&format!("/v1/tenants/{tenant}/groups"), body)
                    .await?;
                println!("Created group: {}", item.group_id);
                print_item(&item, fmt);
            }
        }
        Ok(())
    }
}
