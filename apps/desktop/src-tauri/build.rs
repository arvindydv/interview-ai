use std::fs;

fn main() {
    // Bake PARAKEET_* values from apps/desktop/.env into the binary (read by src/config.rs).
    // Real environment variables win, so CI can inject production URLs.
    println!("cargo:rerun-if-changed=../.env");
    if let Ok(env) = fs::read_to_string("../.env") {
        for line in env.lines().map(str::trim) {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                if key.starts_with("PARAKEET_") && std::env::var(key).is_err() {
                    println!("cargo:rustc-env={key}={}", value.trim().trim_matches('"'));
                }
            }
        }
    }
    for key in ["PARAKEET_WEB_URL", "PARAKEET_API_URL", "PARAKEET_SUPABASE_URL", "PARAKEET_SUPABASE_PUBLISHABLE_KEY"] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    tauri_build::build()
}
