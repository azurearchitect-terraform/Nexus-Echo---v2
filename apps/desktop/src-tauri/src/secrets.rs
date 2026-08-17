//! Provider credentials live in the OS keychain — Keychain on macOS, Credential
//! Manager on Windows, Secret Service on Linux. They are never written to the
//! SQLite database or serialized into settings JSON. Provider and transcription
//! requests currently run in the webview, so the raw value crosses IPC only when
//! a configured provider needs it; normal settings UI uses masked hints.

use anyhow::{anyhow, Result};
use keyring::Entry;

const SERVICE: &str = "ai.nexusecho.desktop";

fn entry(key_ref: &str) -> Result<Entry> {
    Entry::new(SERVICE, key_ref).map_err(|e| anyhow!("keychain unavailable: {e}"))
}

pub fn set_secret(key_ref: &str, value: &str) -> Result<()> {
    entry(key_ref)?
        .set_password(value)
        .map_err(|e| anyhow!("failed to store credential: {e}"))
}

pub fn get_secret(key_ref: &str) -> Result<Option<String>> {
    match entry(key_ref)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow!("failed to read credential: {e}")),
    }
}

pub fn delete_secret(key_ref: &str) -> Result<()> {
    match entry(key_ref)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!("failed to delete credential: {e}")),
    }
}

/// What the UI is allowed to see.
pub fn mask(secret: &str) -> String {
    let len = secret.chars().count();
    if len <= 8 {
        return "•".repeat(len.max(4));
    }
    let tail: String = secret.chars().skip(len - 4).collect();
    format!("{}••••{}", &secret[..3.min(secret.len())], tail)
}
