//! A stable identifier for this computer, so the free trial is granted once per machine instead of
//! once per account. It comes from the operating system (not from our own files), so reinstalling the
//! app or signing up with another email doesn't change it. Only a salted SHA-256 of it leaves the
//! device; the API hashes it again with its own secret before storing it.

use sha2::{Digest, Sha256};

/// App-specific salt, so the value is useless for matching against other products' ids.
const SALT: &str = "friday-ai/machine/v1";

/// Hex SHA-256 of the OS machine id, or None if the OS doesn't expose one.
pub fn fingerprint() -> Option<String> {
    let id = raw_id()?;
    let id = id.trim().to_lowercase();
    // Placeholder ids some images ship with identify nothing.
    if id.is_empty() || id.chars().all(|c| c == '0' || c == '-') {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(SALT.as_bytes());
    hash.update(b":");
    hash.update(id.as_bytes());
    Some(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Windows: the MachineGuid written at install time.
#[cfg(target_os = "windows")]
fn raw_id() -> Option<String> {
    use winreg::{enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY}, RegKey};
    // The 64-bit view, so a 32-bit build reads the same value.
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"SOFTWARE\Microsoft\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        .and_then(|k| k.get_value::<String, _>("MachineGuid"))
        .ok()
}

/// macOS: the hardware UUID (IOPlatformUUID).
#[cfg(target_os = "macos")]
fn raw_id() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .find(|l| l.contains("\"IOPlatformUUID\""))
        .and_then(|l| l.split('"').nth(3))
        .map(str::to_owned)
}

/// Linux: the systemd/D-Bus machine id.
#[cfg(target_os = "linux")]
fn raw_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"].iter().find_map(|p| std::fs::read_to_string(p).ok())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn raw_id() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn fingerprint_is_stable_hex() {
        if let Some(a) = super::fingerprint() {
            assert_eq!(a.len(), 64);
            assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
            assert_eq!(Some(a), super::fingerprint());
        }
    }
}
