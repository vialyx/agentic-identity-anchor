use serde::Serialize;
use tabled::{Table, Tabled};

/// Output format requested by the operator.
#[derive(Clone, clap::ValueEnum)]
pub enum OutputFormat {
    Table,
    Json,
}

/// Print a list of items as a pretty ASCII table or JSON array.
pub fn print_table<T: Tabled + Serialize>(items: &[T], format: &OutputFormat) {
    match format {
        OutputFormat::Table => {
            if items.is_empty() {
                println!("(no results)");
            } else {
                println!("{}", Table::new(items));
            }
        }
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(items).unwrap_or_default());
        }
    }
}

/// Print a single item as a two-column key/value table or pretty JSON.
pub fn print_item<T: Serialize>(item: &T, format: &OutputFormat) {
    match format {
        OutputFormat::Table => {
            let val = serde_json::to_value(item).unwrap_or_default();
            if let serde_json::Value::Object(map) = val {
                let rows: Vec<[String; 2]> = map
                    .into_iter()
                    .map(|(k, v)| {
                        let v_str = match &v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        [k, v_str]
                    })
                    .collect();
                let mut table = tabled::builder::Builder::from_iter(rows).build();
                table.with(tabled::settings::Style::rounded());
                println!("{table}");
            } else {
                println!("{}", serde_json::to_string_pretty(item).unwrap_or_default());
            }
        }
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(item).unwrap_or_default());
        }
    }
}
