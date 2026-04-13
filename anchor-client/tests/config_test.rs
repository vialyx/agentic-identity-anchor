use std::io::Write;
use tempfile::NamedTempFile;

// Helper: create a temporary TOML config file with the given content.
fn write_toml(content: &str) -> NamedTempFile {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(content.as_bytes()).unwrap();
    f
}

#[test]
fn load_valid_config() {
    let toml = r#"
        tenant_id = "tenant-abc"
        control_plane_url = "https://control.example.com"
        cert_path = "/etc/anchor/client.crt"
        key_path = "/etc/anchor/client.key"
        ca_cert_path = "/etc/anchor/ca.crt"
        data_dir = "/var/lib/anchor"
        heartbeat_interval_secs = 30
        update_check_interval_secs = 300
        log_level = "info"
    "#;
    let f = write_toml(toml);
    let cfg = anchor_client_lib::config::Config::load(f.path()).expect("Should parse valid config");

    assert_eq!(cfg.tenant_id, "tenant-abc");
    assert_eq!(cfg.control_plane_url, "https://control.example.com");
    assert_eq!(cfg.heartbeat_interval_secs, 30);
    assert_eq!(cfg.update_check_interval_secs, 300);
    assert!(cfg.device_id.is_none());
}

#[test]
fn load_config_with_optional_device_id() {
    let toml = r#"
        tenant_id = "t1"
        device_id = "dev-123"
        control_plane_url = "https://cp.example.com"
        cert_path = "/certs/c.pem"
        key_path = "/certs/k.pem"
        ca_cert_path = "/certs/ca.pem"
        data_dir = "/data"
        heartbeat_interval_secs = 60
        update_check_interval_secs = 600
        log_level = "debug"
    "#;
    let f = write_toml(toml);
    let cfg = anchor_client_lib::config::Config::load(f.path()).unwrap();
    assert_eq!(cfg.device_id.as_deref(), Some("dev-123"));
}

#[test]
fn missing_required_field_returns_error() {
    // control_plane_url is missing
    let toml = r#"
        tenant_id = "t1"
        cert_path = "/c.pem"
        key_path = "/k.pem"
        ca_cert_path = "/ca.pem"
        data_dir = "/data"
        heartbeat_interval_secs = 30
        update_check_interval_secs = 300
        log_level = "info"
    "#;
    let f = write_toml(toml);
    let result = anchor_client_lib::config::Config::load(f.path());
    assert!(
        result.is_err(),
        "Should fail when required field is missing"
    );
}

#[test]
fn nonexistent_config_file_returns_error() {
    let result =
        anchor_client_lib::config::Config::load(std::path::Path::new("/nonexistent/config.toml"));
    assert!(result.is_err());
}

#[test]
fn device_id_path_is_under_data_dir() {
    let toml = r#"
        tenant_id = "t1"
        control_plane_url = "https://cp.example.com"
        cert_path = "/c.pem"
        key_path = "/k.pem"
        ca_cert_path = "/ca.pem"
        data_dir = "/var/lib/anchor"
        heartbeat_interval_secs = 30
        update_check_interval_secs = 300
        log_level = "info"
    "#;
    let f = write_toml(toml);
    let cfg = anchor_client_lib::config::Config::load(f.path()).unwrap();
    let id_path = cfg.device_id_path();
    assert!(id_path.starts_with("/var/lib/anchor"));
    assert_eq!(id_path.file_name().unwrap(), "device_id");
}
