use anyhow::Result;
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use tabled::Tabled;

use crate::{
    client::ApiClient,
    output::{print_item, print_table, OutputFormat},
};

#[derive(Args)]
pub struct TenantsArgs {
    #[command(subcommand)]
    cmd: TenantCmd,
}

#[derive(Subcommand)]
enum TenantCmd {
    /// List all tenants
    List,
    /// Create a new tenant
    Create {
        #[arg(long)]
        name: String,
    },
    /// Get a tenant by ID
    Get { tenant_id: String },
}

#[derive(Debug, Deserialize, Serialize, Tabled)]
#[serde(rename_all = "camelCase")]
struct TenantRow {
    #[tabled(rename = "Tenant ID")]
    tenant_id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Created At")]
    created_at: String,
}

impl TenantsArgs {
    pub async fn run(self, client: &ApiClient, fmt: &OutputFormat) -> Result<()> {
        match self.cmd {
            TenantCmd::List => {
                let items: Vec<TenantRow> = client.get("/v1/tenants").await?;
                print_table(&items, fmt);
            }
            TenantCmd::Create { name } => {
                let item: TenantRow = client
                    .post("/v1/tenants", serde_json::json!({"name": name}))
                    .await?;
                println!("Created tenant: {}", item.tenant_id);
                print_item(&item, fmt);
            }
            TenantCmd::Get { tenant_id } => {
                let item: TenantRow = client.get(&format!("/v1/tenants/{tenant_id}")).await?;
                print_item(&item, fmt);
            }
        }
        Ok(())
    }
}
