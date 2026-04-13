mod client;
mod commands;
mod config;
mod output;

use anyhow::Result;
use clap::{Parser, Subcommand};
use output::OutputFormat;

#[derive(Parser)]
#[command(name = "anchor-ctl", about = "Anchor control plane CLI", version)]
struct Cli {
    /// Config profile to use
    #[arg(long, default_value = "default", env = "ANCHOR_PROFILE")]
    profile: String,
    /// Output format
    #[arg(long, value_enum, default_value = "table")]
    output: OutputFormat,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Devices(commands::devices::DevicesArgs),
    Tenants(commands::tenants::TenantsArgs),
    Groups(commands::groups::GroupsArgs),
    Agents(commands::agents::AgentsArgs),
    Deployments(commands::deployments::DeploymentsArgs),
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let cfg = config::Config::load(&cli.profile)?;
    let client = client::ApiClient::new(cfg.api_url.clone(), cfg.token.clone());

    match cli.command {
        Commands::Devices(args) => args.run(&client, &cli.output).await,
        Commands::Tenants(args) => args.run(&client, &cli.output).await,
        Commands::Groups(args) => args.run(&client, &cli.output).await,
        Commands::Agents(args) => args.run(&client, &cli.output).await,
        Commands::Deployments(args) => args.run(&client, &cli.output).await,
    }
}
