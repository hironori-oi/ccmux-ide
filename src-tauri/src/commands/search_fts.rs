//! Derived from ccmux-ide/src/ide/search_fts.rs (MIT Licensed).
//!
//! FTS5 会話履歴検索のスケルトン。M3（Week8）で本実装。
//! `~/.claude/projects/<slug>/*.jsonl` を rusqlite FTS5 仮想テーブルにインデックス
//! して、`search_conversations(query)` で横断検索する。
//!
//! 現段階では rusqlite の DB 初期化だけ通し、`search` / `reindex` は空結果を
//! 返す。スキーマは下記コメント参照。

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::Serialize;

// FTS5 スキーマ（M3 で本実装時にコメント解除）:
// ```sql
// CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
//   session_id UNINDEXED,
//   ts UNINDEXED,
//   role UNINDEXED,
//   content,
//   tokenize = 'unicode61 remove_diacritics 2'
// );
// ```

/// 検索ヒット 1 件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub ts: String,
    pub role: String,
    pub snippet: String,
}

/// DB パス: `<config>/ccmux-ide/search_fts.sqlite`
fn db_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("config dir が解決できません")?;
    let dir = base.join("ccmux-ide");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("config dir 作成失敗: {}", dir.display()))?;
    Ok(dir.join("search_fts.sqlite"))
}

/// DB 接続を初期化してから渡す（Mutex<Option<Connection>> を lazy 初期化）。
fn with_conn<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    use std::sync::OnceLock;
    static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

    let mutex = DB.get_or_init(|| {
        // 初回失敗時は panic せずに memory DB にフォールバック。
        let conn = match db_path().and_then(|p| {
            Connection::open(&p).with_context(|| format!("SQLite open 失敗: {}", p.display()))
        }) {
            Ok(c) => c,
            Err(_) => Connection::open_in_memory().expect("in-memory SQLite must open"),
        };
        // スキーマ初期化は M3 で本実装。
        // let _ = conn.execute_batch(
        //     "CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
        //        session_id UNINDEXED, ts UNINDEXED, role UNINDEXED, content,
        //        tokenize = 'unicode61 remove_diacritics 2'
        //      );",
        // );
        Mutex::new(conn)
    });
    let guard = mutex.lock().expect("DB mutex poisoned");
    f(&guard)
}

/// Tauri command: FTS5 検索（M3 で本実装、現状は空配列）。
#[tauri::command]
pub async fn search_conversations(
    _query: String,
    _limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    tokio::task::spawn_blocking(|| -> Result<Vec<SearchHit>, String> {
        with_conn(|_conn| {
            // TODO (M3 / PM-170): snippet() で抜粋生成。
            Ok(Vec::new())
        })
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Tauri command: `~/.claude/projects/*.jsonl` を再帰走査してインデックス再構築。
#[tauri::command]
pub async fn reindex_conversations() -> Result<usize, String> {
    tokio::task::spawn_blocking(|| -> Result<usize, String> {
        with_conn(|_conn| {
            // TODO (M3 / PM-171): walkdir で jsonl を拾って 1 行ずつ INSERT。
            Ok(0usize)
        })
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
