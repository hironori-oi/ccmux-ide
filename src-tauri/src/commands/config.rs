//! Derived from ccmux-ide/src/ide/config.rs (MIT Licensed).
//!
//! OS keyring による ANTHROPIC_API_KEY の get/set を Tauri command として公開。
//! - Windows: Credential Manager
//! - macOS:   Keychain
//! - Linux:   Secret Service (gnome-keyring / KWallet)
//!
//! service 名は `ccmux-ide`、entry 名は `anthropic_api_key`。

use anyhow::{Context, Result};

/// keyring のサービス名（OS 資格情報ストアでの分類）。
const KEYRING_SERVICE: &str = "ccmux-ide";

/// keyring のエントリ名。
const KEYRING_ENTRY: &str = "anthropic_api_key";

/// Tauri command: keyring から API Key を取得。未設定時は `Ok(None)`。
#[tauri::command]
pub async fn get_api_key() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| load_api_key().map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

/// Tauri command: keyring に API Key を保存。空文字を渡すと削除する。
#[tauri::command]
pub async fn set_api_key(key: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || store_api_key(&key).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn load_api_key() -> Result<Option<String>> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY) {
        Ok(entry) => match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow::Error::new(e).context("keyring 取得失敗")),
        },
        Err(e) => Err(anyhow::Error::new(e).context("keyring エントリ初期化失敗")),
    }
}

fn store_api_key(key: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)
        .context("keyring エントリ初期化失敗")?;
    if key.is_empty() {
        match entry.delete_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::Error::new(e).context("keyring エントリ削除失敗")),
        }
    } else {
        entry
            .set_password(key)
            .context("keyring 書き込み失敗 (Windows Credential Manager 等に要確認)")
    }
}
