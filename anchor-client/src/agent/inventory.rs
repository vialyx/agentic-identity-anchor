use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Stopped,
    Failed,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Running => write!(f, "running"),
            AgentStatus::Stopped => write!(f, "stopped"),
            AgentStatus::Failed => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledAgent {
    pub agent_id: String,
    pub version: String,
    pub install_path: String,
    pub installed_at: String,
    pub status: AgentStatus,
    pub pid: Option<u32>,
}

pub struct Inventory {
    data_dir: PathBuf,
    agents: HashMap<String, InstalledAgent>,
}

impl Inventory {
    /// Load inventory from `data_dir/inventory.json`.  Returns an empty
    /// inventory if the file does not exist yet.
    pub fn load(data_dir: &Path) -> anyhow::Result<Self> {
        let path = data_dir.join("inventory.json");
        let agents = if path.exists() {
            let contents = std::fs::read_to_string(&path)
                .with_context(|| format!("Read inventory: {}", path.display()))?;
            serde_json::from_str(&contents).context("Parse inventory JSON")?
        } else {
            HashMap::new()
        };
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            agents,
        })
    }

    /// Persist inventory to `data_dir/inventory.json`.
    pub fn save(&self) -> anyhow::Result<()> {
        let path = self.data_dir.join("inventory.json");
        std::fs::create_dir_all(&self.data_dir)
            .with_context(|| format!("Create data dir: {}", self.data_dir.display()))?;
        let json = serde_json::to_string_pretty(&self.agents).context("Serialize inventory")?;
        std::fs::write(&path, json)
            .with_context(|| format!("Write inventory: {}", path.display()))?;
        Ok(())
    }

    pub fn get(&self, agent_id: &str) -> Option<&InstalledAgent> {
        self.agents.get(agent_id)
    }

    pub fn upsert(&mut self, agent: InstalledAgent) -> anyhow::Result<()> {
        self.agents.insert(agent.agent_id.clone(), agent);
        self.save()
    }

    pub fn remove(&mut self, agent_id: &str) -> anyhow::Result<()> {
        self.agents.remove(agent_id);
        self.save()
    }

    pub fn list(&self) -> Vec<&InstalledAgent> {
        self.agents.values().collect()
    }
}
