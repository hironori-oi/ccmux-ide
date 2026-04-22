//! Derived from ccmux (MIT Licensed).
//!
//! OS keyring による ANTHROPIC_API_KEY の get/set を Tauri command として公開。
//! - Windows: Credential Manager
//! - macOS:   Keychain
//! - Linux:   Secret Service (gnome-keyring / KWallet)
//!
//! service 名は `sumi`、entry 名は `anthropic_api_key`。
//!
//! ## DEC-054 リネームマイグレーション (v1.3.x → v1.4+)
//!
//! 旧版は service 名 `ccmux-ide` で登録していた。`load_api_key()` は新 service
//! で見つからない場合に旧 service を参照し、見つかれば新 service にコピー +
//! 旧 service から削除して migrate する（1 回限り）。これにより v1.3.x 時代に
//! API Key を保存済のユーザーは再入力不要で v1.4+ にアップグレード可能。

use anyhow::{Context, Result};

/// keyring のサービス名（OS 資格情報ストアでの分類）。
const KEYRING_SERVICE: &str = "sumi";

/// DEC-054: 旧 service 名（`ccmux-ide`）。migration でのみ読み取る。
const LEGACY_KEYRING_SERVICE: &str = "ccmux-ide";

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
            Err(keyring::Error::NoEntry) => {
                // DEC-054: 新 service が空の場合のみ旧 service を参照して migrate。
                // 旧 service の get/delete エラーは silently fall-through する
                // （migration 失敗 = ユーザーが再入力する程度の影響、致命的ではない）。
                match migrate_legacy_api_key() {
                    Ok(migrated) => Ok(migrated),
                    Err(_) => Ok(None),
                }
            }
            Err(e) => Err(anyhow::Error::new(e).context("keyring 取得失敗")),
        },
        Err(e) => Err(anyhow::Error::new(e).context("keyring エントリ初期化失敗")),
    }
}

/// DEC-054: 旧 service (`ccmux-ide`) から key を読み取り、新 service にコピー後
/// 旧 service からは削除する。見つからない / エラーは `Ok(None)` を返す。
fn migrate_legacy_api_key() -> Result<Option<String>> {
    let legacy = match keyring::Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_ENTRY) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let key = match legacy.get_password() {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    // 新 service に書き込み（失敗時は migration を中止し旧 entry は残す）。
    let new_entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)
        .context("新 keyring エントリ初期化失敗")?;
    new_entry
        .set_password(&key)
        .context("新 keyring への migration 書き込み失敗")?;
    // 旧 entry を削除（失敗しても warn のみ、key 本体は既に移行済）。
    let _ = legacy.delete_password();
    eprintln!("[keyring] migrated API key: ccmux-ide -> sumi");
    Ok(Some(key))
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
