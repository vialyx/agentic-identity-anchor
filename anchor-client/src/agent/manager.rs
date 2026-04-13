use crate::agent::inventory::{AgentStatus, InstalledAgent, Inventory};
use crate::config::Config;
use crate::crypto::verify;
use crate::transport::client::{AnchorClient, PolicyAction};
use anyhow::Context;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

pub struct AgentManager {
    config: Config,
    client: Arc<AnchorClient>,
    inventory: Arc<Mutex<Inventory>>,
}

impl AgentManager {
    pub fn new(config: Config, client: Arc<AnchorClient>) -> anyhow::Result<Self> {
        let inv = Inventory::load(Path::new(&config.data_dir)).context("Load agent inventory")?;
        Ok(Self {
            config,
            client,
            inventory: Arc::new(Mutex::new(inv)),
        })
    }

    /// Expose the shared inventory so the daemon can pass it to HealthReporter.
    pub fn inventory(&self) -> Arc<Mutex<Inventory>> {
        Arc::clone(&self.inventory)
    }

    /// Fetch policy from control plane and apply changes.
    pub async fn sync(&self) -> anyhow::Result<()> {
        info!("Syncing agent policy");
        let policy = self.client.get_policy().await?;

        for agent in &policy.agents {
            let result = match agent.action {
                PolicyAction::Install => {
                    self.install(
                        &agent.agent_id,
                        &agent.version,
                        &agent.download_url,
                        &agent.sha256,
                        agent.sig_url.as_deref(),
                    )
                    .await
                }
                PolicyAction::Update => {
                    self.update(
                        &agent.agent_id,
                        &agent.version,
                        &agent.download_url,
                        &agent.sha256,
                    )
                    .await
                }
                PolicyAction::Remove => self.remove(&agent.agent_id).await,
                PolicyAction::Keep => {
                    info!("Agent {} kept at version {}", agent.agent_id, agent.version);
                    Ok(())
                }
            };

            if let Err(e) = result {
                error!(
                    "Failed to apply policy for agent {}: {:#}",
                    agent.agent_id, e
                );
            }
        }
        Ok(())
    }

    /// Download, verify, and install an agent binary.
    pub async fn install(
        &self,
        agent_id: &str,
        version: &str,
        download_url: &str,
        expected_sha256: &str,
        sig_url: Option<&str>,
    ) -> anyhow::Result<()> {
        info!("Installing agent {agent_id} v{version}");

        let download_path = self.download_path(agent_id, version);
        self.client
            .download_artifact(download_url, &download_path)
            .await?;

        verify::verify_sha256(&download_path, expected_sha256)
            .context("SHA-256 verification failed after download")?;

        if let Some(s_url) = sig_url {
            let sig_path = download_path.with_extension("sig");
            self.client.download_artifact(s_url, &sig_path).await?;

            // Public key comes from config data_dir/public_key.hex
            let pubkey_path = PathBuf::from(&self.config.data_dir).join("public_key.hex");
            if pubkey_path.exists() {
                let pubkey_hex = tokio::fs::read_to_string(&pubkey_path)
                    .await
                    .context("Read public key")?;
                verify::verify_file_signature(&download_path, &sig_path, pubkey_hex.trim())
                    .context("Signature verification failed")?;
            } else {
                warn!("sig_url provided but public_key.hex not found; skipping signature check");
            }
        }

        let install_dir = self.agent_install_dir(agent_id, version);
        tokio::fs::create_dir_all(&install_dir)
            .await
            .context("Create install directory")?;

        let binary_name = self.agent_binary_name(agent_id);
        let dest = install_dir.join(&binary_name);

        // Back up current version for rollback before overwriting
        if dest.exists() {
            let prev = dest.with_extension("prev");
            tokio::fs::rename(&dest, &prev).await.ok();
        }

        tokio::fs::rename(&download_path, &dest)
            .await
            .context("Move binary to install path")?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&dest, perms).context("Set executable permissions")?;
        }

        let agent = InstalledAgent {
            agent_id: agent_id.to_string(),
            version: version.to_string(),
            install_path: dest.to_string_lossy().into_owned(),
            installed_at: Utc::now().to_rfc3339(),
            status: AgentStatus::Stopped,
            pid: None,
        };
        self.inventory.lock().await.upsert(agent)?;

        info!(
            "Agent {agent_id} v{version} installed at {}",
            dest.display()
        );
        Ok(())
    }

    /// Remove an installed agent.
    pub async fn remove(&self, agent_id: &str) -> anyhow::Result<()> {
        info!("Removing agent {agent_id}");
        let install_path = {
            let inv = self.inventory.lock().await;
            inv.get(agent_id).map(|a| PathBuf::from(&a.install_path))
        };

        if let Some(path) = install_path {
            if let Some(dir) = path.parent() {
                if dir.exists() {
                    tokio::fs::remove_dir_all(dir)
                        .await
                        .with_context(|| format!("Remove agent dir: {}", dir.display()))?;
                }
            }
        }

        self.inventory.lock().await.remove(agent_id)?;
        info!("Agent {agent_id} removed");
        Ok(())
    }

    /// Check if update needed and perform it.
    pub async fn update(
        &self,
        agent_id: &str,
        new_version: &str,
        download_url: &str,
        expected_sha256: &str,
    ) -> anyhow::Result<()> {
        let current_version = {
            let inv = self.inventory.lock().await;
            inv.get(agent_id).map(|a| a.version.clone())
        };

        if let Some(cv) = &current_version {
            if cv == new_version {
                info!("Agent {agent_id} already at v{new_version}, no update needed");
                return Ok(());
            }
            info!("Updating agent {agent_id} from v{cv} to v{new_version}");
        } else {
            info!("Agent {agent_id} not installed; performing fresh install for update");
        }

        self.install(agent_id, new_version, download_url, expected_sha256, None)
            .await
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn download_path(&self, agent_id: &str, version: &str) -> PathBuf {
        PathBuf::from(&self.config.data_dir)
            .join("downloads")
            .join(format!("{}_{}", agent_id, version))
    }

    fn agent_install_dir(&self, agent_id: &str, version: &str) -> PathBuf {
        PathBuf::from(&self.config.data_dir)
            .join("agents")
            .join(agent_id)
            .join(format!("v{version}"))
    }

    fn agent_binary_name(&self, agent_id: &str) -> String {
        #[cfg(target_os = "windows")]
        return format!("{agent_id}.exe");
        #[cfg(not(target_os = "windows"))]
        return agent_id.to_string();
    }
}
