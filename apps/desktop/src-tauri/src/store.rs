//! Refresh-token storage in the OS credential store (spec I5): macOS Keychain, Windows Credential
//! Manager, Linux Secret Service (GNOME Keyring / KWallet). Only the short refresh token is stored,
//! well under Windows' 2.5 KB credential limit; the access token lives in memory.
//!
//! Minimal Linux setups without a Secret Service fall back to a 0600 file in the app data dir.

use std::{fs, path::{Path, PathBuf}};

const SERVICE: &str = "in.friday-ai.desktop";
const ACCOUNT: &str = "supabase-refresh-token";

pub struct SecureStore {
    fallback: PathBuf,
}

impl SecureStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { fallback: data_dir.join("session.fallback") }
    }

    fn entry() -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT)
    }

    pub fn load(&self) -> Option<String> {
        match Self::entry().and_then(|e| e.get_password()) {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => fs::read_to_string(&self.fallback).ok(),
            Err(err) => {
                log::warn!("credential store unavailable ({err}); using fallback file");
                fs::read_to_string(&self.fallback).ok()
            }
        }
    }

    pub fn save(&self, token: &str) {
        match Self::entry().and_then(|e| e.set_password(token)) {
            Ok(()) => {
                let _ = fs::remove_file(&self.fallback);
            }
            Err(err) => {
                log::warn!("credential store unavailable ({err}); storing session in a private file");
                if let Some(dir) = self.fallback.parent() {
                    let _ = fs::create_dir_all(dir);
                }
                write_private(&self.fallback, token);
            }
        }
    }

    pub fn clear(&self) {
        if let Ok(e) = Self::entry() {
            let _ = e.delete_credential();
        }
        let _ = fs::remove_file(&self.fallback);
    }
}

#[cfg(unix)]
fn write_private(path: &Path, contents: &str) {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path);
    if let Ok(mut f) = file {
        let _ = f.write_all(contents.as_bytes());
    }
}

#[cfg(not(unix))]
fn write_private(path: &Path, contents: &str) {
    let _ = fs::write(path, contents);
}
