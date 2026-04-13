use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use std::io::Write;
use tempfile::NamedTempFile;

use anchor_client_lib::crypto::verify::{sha256_file, verify_file_signature, verify_sha256};

fn make_temp_file(content: &[u8]) -> NamedTempFile {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(content).unwrap();
    f.flush().unwrap();
    f
}

fn sign_bytes(signing_key: &SigningKey, data: &[u8]) -> [u8; 64] {
    signing_key.sign(data).to_bytes()
}

// ── SHA-256 tests ─────────────────────────────────────────────────────────────

#[test]
fn sha256_known_value() {
    // echo -n "hello" | sha256sum
    let f = make_temp_file(b"hello");
    let hex = sha256_file(f.path()).unwrap();
    assert_eq!(
        hex,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn sha256_empty_file() {
    let f = make_temp_file(b"");
    let hex = sha256_file(f.path()).unwrap();
    assert_eq!(
        hex,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn verify_sha256_matching() {
    let f = make_temp_file(b"anchor");
    let expected = sha256_file(f.path()).unwrap();
    verify_sha256(f.path(), &expected).unwrap();
}

#[test]
fn verify_sha256_mismatch_returns_error() {
    let f = make_temp_file(b"anchor");
    let bad_hash = "0000000000000000000000000000000000000000000000000000000000000000";
    assert!(verify_sha256(f.path(), bad_hash).is_err());
}

// ── Ed25519 signature tests ───────────────────────────────────────────────────

#[test]
fn ed25519_sign_and_verify() {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();

    let payload = b"test payload for anchor signature verification";
    let file = make_temp_file(payload);
    let sig_bytes = sign_bytes(&signing_key, payload);

    let mut sig_file = NamedTempFile::new().unwrap();
    sig_file.write_all(&sig_bytes).unwrap();
    sig_file.flush().unwrap();

    let pubkey_hex = hex::encode(verifying_key.as_bytes());
    verify_file_signature(file.path(), sig_file.path(), &pubkey_hex).unwrap();
}

#[test]
fn ed25519_tampered_file_fails() {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();

    let original = b"original content";
    let sig_bytes = sign_bytes(&signing_key, original);

    // Write the *tampered* content to the file
    let file = make_temp_file(b"tampered content!!");
    let mut sig_file = NamedTempFile::new().unwrap();
    sig_file.write_all(&sig_bytes).unwrap();
    sig_file.flush().unwrap();

    let pubkey_hex = hex::encode(verifying_key.as_bytes());
    let result = verify_file_signature(file.path(), sig_file.path(), &pubkey_hex);
    assert!(
        result.is_err(),
        "Verification should fail for tampered file"
    );
}

#[test]
fn ed25519_wrong_key_fails() {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let wrong_key = SigningKey::generate(&mut csprng);

    let payload = b"test payload";
    let sig_bytes = sign_bytes(&signing_key, payload);

    let file = make_temp_file(payload);
    let mut sig_file = NamedTempFile::new().unwrap();
    sig_file.write_all(&sig_bytes).unwrap();
    sig_file.flush().unwrap();

    let wrong_pubkey_hex = hex::encode(wrong_key.verifying_key().as_bytes());
    let result = verify_file_signature(file.path(), sig_file.path(), &wrong_pubkey_hex);
    assert!(result.is_err(), "Verification should fail with wrong key");
}

#[test]
fn ed25519_invalid_pubkey_hex_returns_error() {
    let file = make_temp_file(b"data");
    let sig_file = make_temp_file(&[0u8; 64]);
    let result = verify_file_signature(file.path(), sig_file.path(), "not_valid_hex!!");
    assert!(result.is_err());
}
