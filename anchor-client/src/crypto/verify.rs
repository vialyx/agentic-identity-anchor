use anyhow::Context;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Verify an Ed25519 signature of a file.
///
/// * `file_path`       – path to the file whose content is being verified
/// * `sig_path`        – path to the raw 64-byte signature file
/// * `public_key_hex`  – 32-byte Ed25519 public key encoded as a lower-case hex string
pub fn verify_file_signature(
    file_path: &Path,
    sig_path: &Path,
    public_key_hex: &str,
) -> anyhow::Result<()> {
    let file_data =
        std::fs::read(file_path).with_context(|| format!("Read file: {}", file_path.display()))?;
    let sig_data =
        std::fs::read(sig_path).with_context(|| format!("Read sig: {}", sig_path.display()))?;

    let key_bytes: [u8; 32] = hex::decode(public_key_hex)
        .context("Decode public key hex")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Public key must be 32 bytes"))?;

    let sig_bytes: [u8; 64] = sig_data
        .try_into()
        .map_err(|_| anyhow::anyhow!("Signature must be 64 bytes"))?;

    let verifying_key =
        VerifyingKey::from_bytes(&key_bytes).context("Build Ed25519 verifying key")?;
    let signature = Signature::from_bytes(&sig_bytes);

    verifying_key
        .verify(&file_data, &signature)
        .context("Ed25519 signature verification failed")
}

/// Compute the SHA-256 hash of a file and return the lower-case hex string.
pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let data =
        std::fs::read(path).with_context(|| format!("Read file: {}", path.display()))?;
    let digest = Sha256::digest(&data);
    Ok(hex::encode(digest))
}

/// Verify that the SHA-256 hash of a file matches the expected hex value.
pub fn verify_sha256(path: &Path, expected_hex: &str) -> anyhow::Result<()> {
    let actual = sha256_file(path)?;
    if actual.to_lowercase() != expected_hex.to_lowercase() {
        anyhow::bail!(
            "SHA-256 mismatch for {}: expected {expected_hex}, got {actual}",
            path.display()
        );
    }
    Ok(())
}
