use anyhow::Context;
use sha2::{Digest, Sha256};
use std::io::BufReader;

/// Load a mTLS identity (certificate + private key) from separate PEM files.
/// Concatenates both PEM files because reqwest::Identity::from_pem expects a
/// single buffer containing cert chain followed by private key.
pub fn load_identity(cert_path: &str, key_path: &str) -> anyhow::Result<reqwest::Identity> {
    let cert_pem = std::fs::read(cert_path)
        .with_context(|| format!("Failed to read certificate: {cert_path}"))?;
    let key_pem = std::fs::read(key_path)
        .with_context(|| format!("Failed to read private key: {key_path}"))?;

    let mut combined = cert_pem;
    combined.extend_from_slice(&key_pem);

    reqwest::Identity::from_pem(&combined).context("Failed to create TLS identity from PEM")
}

/// Load a CA certificate from a PEM file for server certificate verification.
pub fn load_ca_cert(ca_cert_path: &str) -> anyhow::Result<reqwest::Certificate> {
    let pem = std::fs::read(ca_cert_path)
        .with_context(|| format!("Failed to read CA certificate: {ca_cert_path}"))?;
    reqwest::Certificate::from_pem(&pem).context("Failed to parse CA certificate")
}

/// Compute the SHA-256 thumbprint (fingerprint) of the first certificate in a
/// PEM file.  Returns a lower-case hex string.
pub fn cert_thumbprint(cert_path: &str) -> anyhow::Result<String> {
    let pem_data = std::fs::read(cert_path)
        .with_context(|| format!("Failed to read certificate: {cert_path}"))?;

    let mut reader = BufReader::new(pem_data.as_slice());
    let certs: Vec<_> = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .context("Failed to parse PEM certificates")?;

    let cert = certs
        .first()
        .ok_or_else(|| anyhow::anyhow!("No certificate found in {cert_path}"))?;

    let digest = Sha256::digest(cert.as_ref());
    Ok(hex::encode(digest))
}
