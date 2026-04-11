use anyhow::{bail, Context, Result};
use serde::{de::DeserializeOwned, Serialize};

/// HTTP client for the Anchor control plane API.
pub struct ApiClient {
    inner: reqwest::Client,
    base_url: String,
    token: String,
}

impl ApiClient {
    pub fn new(base_url: String, token: String) -> Self {
        let inner = reqwest::Client::builder()
            .use_rustls_tls()
            .build()
            .expect("failed to build HTTP client");
        Self { inner, base_url, token }
    }

    /// Perform a GET request and deserialise the JSON response.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self
            .inner
            .get(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .with_context(|| format!("GET {url}"))?;
        self.parse(resp).await
    }

    /// Perform a POST request with a JSON body and deserialise the JSON response.
    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: B) -> Result<T> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self
            .inner
            .post(&url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("POST {url}"))?;
        self.parse(resp).await
    }

    /// Perform a PATCH request with a JSON body and deserialise the JSON response.
    pub async fn patch<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: B) -> Result<T> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self
            .inner
            .patch(&url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("PATCH {url}"))?;
        self.parse(resp).await
    }

    /// Upload raw bytes to a presigned URL (no auth header).
    pub async fn put_bytes(&self, url: &str, bytes: Vec<u8>, content_type: &str) -> Result<()> {
        let resp = self
            .inner
            .put(url)
            .header("Content-Type", content_type)
            .body(bytes)
            .send()
            .await
            .with_context(|| format!("PUT {url}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("upload failed ({status}): {body}");
        }
        Ok(())
    }

    async fn parse<T: DeserializeOwned>(&self, resp: reqwest::Response) -> Result<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            bail!("API error ({status}): {body}");
        }
        resp.json::<T>().await.context("failed to deserialise response")
    }
}
