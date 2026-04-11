fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    match target_os.as_str() {
        "windows" => {
            println!("cargo:rustc-cfg=platform=\"windows\"");
        }
        "macos" => {
            println!("cargo:rustc-cfg=platform=\"macos\"");
        }
        "linux" => {
            println!("cargo:rustc-cfg=platform=\"linux\"");
        }
        _ => {}
    }

    // Re-run build script only if it changes
    println!("cargo:rerun-if-changed=build.rs");
}
