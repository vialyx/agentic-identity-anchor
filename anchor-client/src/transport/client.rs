use crate::config::Config;
use crate::transport::cert;
use anyhow::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::{debug, info};
use uuid::Uuid;

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RegisterRequest {
    pub tenant_id: String,
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub cert_thumbprint: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub device_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct HeartbeatPayload {
    pub device_id: String,
    pub cpu_usage_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub uptime_seconds: u64,
    pub agents: Vec<AgentInfo>,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct AgentInfo {
    pub agent_id: String,
    pub version: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatResponse {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct PolicyResponse {
    pub agents: Vec<AgentPolicy>,
    pub self_update: Option<SelfUpdatePolicy>,
}

#[derive(Debug, Deserialize)]
pub struct AgentPolicy {
    pub agent_id: String,
    pub version: String,
    pub download_url: String,
    pub sha256: String,
    pub sig_url: Option<String>,
    pub action: PolicyAction,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyAction {
    Install,
    Update,
    Remove,
    Keep,
}

#[derive(Debug, Deserialize)]
pub struct SelfUpdatePolicy {
    pub version: String,
    pub download_url: String,
    pub sha256: String,
    pub sig_url: Option<String>,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct AnchorClient {
    inner: reqwest::Client,
    base_url: String,
    tenant_id: String,
    device_id: String,
}

impl AnchorClient {
    pub fn new(config: &Config, device_id: &str) -> anyhow::Result<Self> {
        let identity = cert::load_identity(&config.cert_path, &config.key_path)?;
        let ca_cert = cert::load_ca_cert(&config.ca_cert_path)?;

        let inner = reqwest::Client::builder()
            .use_rustls_tls()
            .identity(identity)
            .add_root_certificate(ca_cert)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .context("Failed to build HTTP client")?;

        Ok(Self {
            inner,
            base_url: config.control_plane_url.trim_end_matches('/').to_string(),
            tenant_id: config.tenant_id.clone(),
            device_id: device_id.to_string(),
        })
    }

    fn request_headers(&self) -> reqwest::header::HeaderMap {
        use reqwest::header::{HeaderMap, HeaderValue};
        let mut map = HeaderMap::new();
        let request_id = Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();
        if let (Ok(rid), Ok(ts)) = (
            HeaderValue::from_str(&request_id),
            HeaderValue::from_str(&timestamp),
        ) {
            map.insert("X-Request-Id", rid);
            map.insert("X-Timestamp", ts);
        }
        map
    }

    pub async fn register(
        &self,
        hostname: &str,
        os: &str,
        arch: &str,
        cert_thumbprint: &str,
    ) -> anyhow::Result<RegisterResponse> {
        let url = format!(
            "{}/v1/tenants/{}/devices/register",
            self.base_url, self.tenant_id
        );
        let body = RegisterRequest {
            tenant_id: self.tenant_id.clone(),
            hostname: hostname.to_string(),
            os: os.to_string(),
            arch: arch.to_string(),
            cert_thumbprint: cert_thumbprint.to_string(),
            timestamp: Utc::now().to_rfc3339(),
        };

        info!("Registering device with control plane");
        let resp = self
            .inner
            .post(&url)
            .headers(self.request_headers())
            .json(&body)
            .send()
            .await
            .context("Register request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Register returned HTTP {status}: {body}");
        }

        resp.json::<RegisterResponse>()
            .await
            .context("Failed to deserialize RegisterResponse")
    }

    pub async fn heartbeat(&self, payload: HeartbeatPayload) -> anyhow::Result<HeartbeatResponse> {
        let url = format!(
            "{}/v1/tenants/{}/devices/{}/heartbeat",
            self.base_url, self.tenant_id, self.device_id
        );

        debug!("Sending heartbeat");
        let resp = self
            .inner
            .post(&url)
            .headers(self.request_headers())
            .json(&payload)
            .send()
            .await
            .context("Heartbeat request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Heartbeat returned HTTP {status}: {body}");
        }

        resp.json::<HeartbeatResponse>()
            .await
            .context("Failed to deserialize HeartbeatResponse")
    }

    pub async fn get_policy(&self) -> anyhow::Result<PolicyResponse> {
        let url = format!(
            "{}/v1/tenants/{}/devices/{}/policy",
            self.base_url, self.tenant_id, self.device_id
        );

        debug!("Fetching policy");
        let resp = self
            .inner
            .get(&url)
            .headers(self.request_headers())
            .send()
            .await
            .context("Policy request failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Policy returned HTTP {status}: {body}");
        }

        resp.json::<PolicyResponse>()
            .await
            .context("Failed to deserialize PolicyResponse")
    }

    /// Stream-download an artifact to `dest`, creating parent directories as needed.
    pub async fn download_artifact(&self, url: &str, dest: &Path) -> anyhow::Result<()> {
        use tokio::io::AsyncWriteExt;

        info!("Downloading artifact from {url}");
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let resp = self
            .inner
            .get(url)
            .headers(self.request_headers())
            .send()
            .await
            .context("Artifact download request failed")?;

        let status = resp.status();
        if !status.is_success() {
            anyhow::bail!("Download returned HTTP {status}");
        }

        let bytes = resp
            .bytes()
            .await
            .context("Failed to read response bytes")?;
        let mut file = tokio::fs::File::create(dest)
            .await
            .with_context(|| format!("Failed to create file: {}", dest.display()))?;
        file.write_all(&bytes).await?;
        file.flush().await?;

        debug!("Saved artifact to {}", dest.display());
        Ok(())
    }
}
