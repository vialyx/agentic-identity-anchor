use crate::config::Config;
use crate::crypto::verify;
use crate::transport::client::AnchorClient;
use anyhow::Context;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{info, warn};

pub struct SelfUpdater {
    config: Config,
    client: Arc<AnchorClient>,
    current_version: String,
}

impl SelfUpdater {
    pub fn new(config: Config, client: Arc<AnchorClient>) -> Self {
        Self {
            config,
            client,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    /// Check the control plane for a self-update.  Returns `true` if an update
    /// was applied (the process will restart itself).
    pub async fn check_and_update(&self) -> anyhow::Result<bool> {
        let policy = self.client.get_policy().await?;

        let Some(su) = policy.self_update else {
            info!("No self-update policy present");
            return Ok(false);
        };

        // Compare using semver to support pre-release tags properly
        let current = semver::Version::parse(&self.current_version)
            .unwrap_or_else(|_| semver::Version::new(0, 0, 0));
        let available =
            semver::Version::parse(&su.version).context("Parse available version from policy")?;

        if available <= current {
            info!(
                "Self-update: current={} available={} – no update needed",
                self.current_version, su.version
            );
            return Ok(false);
        }

        info!(
            "Self-update available: {} → {}",
            self.current_version, su.version
        );
        self.apply_update(
            &su.version,
            &su.download_url,
            &su.sha256,
            su.sig_url.as_deref(),
        )
        .await?;
        Ok(true)
    }

    /// Rollback to the `.prev` binary if an update went wrong.
    pub fn rollback() -> anyhow::Result<()> {
        let current_exe = std::env::current_exe().context("Locate current executable")?;
        let prev = current_exe.with_extension("prev");

        if !prev.exists() {
            anyhow::bail!("No .prev binary found for rollback");
        }

        info!(
            "Rolling back: {} → {}",
            prev.display(),
            current_exe.display()
        );
        std::fs::rename(&prev, &current_exe).context("Rename .prev to current binary")?;
        info!("Rollback succeeded – please restart the service");
        Ok(())
    }

    // ── Private ───────────────────────────────────────────────────────────────

    async fn apply_update(
        &self,
        version: &str,
        url: &str,
        sha256: &str,
        sig_url: Option<&str>,
    ) -> anyhow::Result<()> {
        let staging = PathBuf::from(&self.config.data_dir).join("anchor-new");
        self.client.download_artifact(url, &staging).await?;

        verify::verify_sha256(&staging, sha256).context("SHA-256 check on new binary")?;

        if let Some(s_url) = sig_url {
            let sig_path = staging.with_extension("sig");
            self.client.download_artifact(s_url, &sig_path).await?;

            let pubkey_path = PathBuf::from(&self.config.data_dir).join("public_key.hex");
            if pubkey_path.exists() {
                let pubkey_hex = tokio::fs::read_to_string(&pubkey_path)
                    .await
                    .context("Read public key")?;
                verify::verify_file_signature(&staging, &sig_path, pubkey_hex.trim())
                    .context("Signature verification on new binary")?;
            } else {
                warn!("sig_url provided but public_key.hex not found; skipping signature check");
            }
        }

        let current_exe = std::env::current_exe().context("Locate current executable")?;
        backup_current_binary(&current_exe).await?;
        replace_binary(&staging, &current_exe).await?;

        info!("Self-update to v{version} applied; restarting…");
        restart_process(&current_exe)
    }
}

async fn backup_current_binary(current_exe: &Path) -> anyhow::Result<()> {
    let prev = current_exe.with_extension("prev");
    tokio::fs::copy(current_exe, &prev)
        .await
        .with_context(|| format!("Backup {} to {}", current_exe.display(), prev.display()))?;
    info!("Backed up current binary to {}", prev.display());
    Ok(())
}

async fn replace_binary(staging: &Path, dest: &Path) -> anyhow::Result<()> {
    // On Windows, rename may fail if the target is locked; on Unix it's atomic.
    tokio::fs::rename(staging, dest)
        .await
        .with_context(|| format!("Replace {} with {}", dest.display(), staging.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(dest, perms).context("Set executable permissions")?;
    }

    Ok(())
}

fn restart_process(exe: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let args: Vec<_> = std::env::args().collect();
        let err = std::process::Command::new(exe).args(&args[1..]).exec();
        // exec() only returns on error
        Err(anyhow::anyhow!("exec failed: {err}"))
    }
    #[cfg(not(unix))]
    {
        let args: Vec<_> = std::env::args().collect();
        std::process::Command::new(exe)
            .args(&args[1..])
            .spawn()
            .context("Spawn updated binary")?;
        std::process::exit(0);
    }
}
