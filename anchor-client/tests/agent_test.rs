use anchor_client_lib::agent::inventory::{AgentStatus, InstalledAgent, Inventory};
use chrono::Utc;
use tempfile::TempDir;

fn make_agent(id: &str, version: &str) -> InstalledAgent {
    InstalledAgent {
        agent_id: id.to_string(),
        version: version.to_string(),
        install_path: format!("/data/agents/{id}/v{version}/{id}"),
        installed_at: Utc::now().to_rfc3339(),
        status: AgentStatus::Stopped,
        pid: None,
    }
}

// ── Inventory persistence tests ───────────────────────────────────────────────

#[test]
fn empty_inventory_loads_from_missing_file() {
    let dir = TempDir::new().unwrap();
    let inv = Inventory::load(dir.path()).unwrap();
    assert!(inv.list().is_empty());
}

#[test]
fn upsert_and_get_agent() {
    let dir = TempDir::new().unwrap();
    let mut inv = Inventory::load(dir.path()).unwrap();

    let agent = make_agent("sensor", "1.0.0");
    inv.upsert(agent.clone()).unwrap();

    let got = inv.get("sensor").unwrap();
    assert_eq!(got.agent_id, "sensor");
    assert_eq!(got.version, "1.0.0");
}

#[test]
fn upsert_overwrites_existing_entry() {
    let dir = TempDir::new().unwrap();
    let mut inv = Inventory::load(dir.path()).unwrap();

    inv.upsert(make_agent("sensor", "1.0.0")).unwrap();
    inv.upsert(make_agent("sensor", "2.0.0")).unwrap();

    let got = inv.get("sensor").unwrap();
    assert_eq!(got.version, "2.0.0");
}

#[test]
fn remove_agent() {
    let dir = TempDir::new().unwrap();
    let mut inv = Inventory::load(dir.path()).unwrap();

    inv.upsert(make_agent("sensor", "1.0.0")).unwrap();
    inv.remove("sensor").unwrap();

    assert!(inv.get("sensor").is_none());
    assert!(inv.list().is_empty());
}

#[test]
fn inventory_persists_and_reloads() {
    let dir = TempDir::new().unwrap();

    {
        let mut inv = Inventory::load(dir.path()).unwrap();
        inv.upsert(make_agent("agent-a", "0.5.0")).unwrap();
        inv.upsert(make_agent("agent-b", "1.1.0")).unwrap();
    }

    let inv2 = Inventory::load(dir.path()).unwrap();
    assert_eq!(inv2.list().len(), 2);
    assert!(inv2.get("agent-a").is_some());
    assert!(inv2.get("agent-b").is_some());
    assert_eq!(inv2.get("agent-b").unwrap().version, "1.1.0");
}

#[test]
fn list_returns_all_agents() {
    let dir = TempDir::new().unwrap();
    let mut inv = Inventory::load(dir.path()).unwrap();

    for i in 0..5 {
        inv.upsert(make_agent(&format!("agent-{i}"), "1.0.0"))
            .unwrap();
    }

    assert_eq!(inv.list().len(), 5);
}

#[test]
fn agent_status_serialization_roundtrip() {
    let dir = TempDir::new().unwrap();
    let mut inv = Inventory::load(dir.path()).unwrap();

    let mut agent = make_agent("x", "1.0.0");
    agent.status = AgentStatus::Running;
    agent.pid = Some(1234);
    inv.upsert(agent).unwrap();

    let inv2 = Inventory::load(dir.path()).unwrap();
    let got = inv2.get("x").unwrap();
    assert_eq!(got.status, AgentStatus::Running);
    assert_eq!(got.pid, Some(1234));
}
