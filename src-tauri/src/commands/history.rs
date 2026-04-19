//! 会話履歴永続化（PM-150 / PM-151）。
//!
//! `~/.ccmux-ide-gui/history.db`（Windows: `%USERPROFILE%\.ccmux-ide-gui\history.db`）
//! に rusqlite bundled で sessions / messages / attachments テーブルと、messages の
//! 全文検索用 FTS5 virtual table を初期化する。
//!
//! ## スキーマ
//!
//! ```sql
//! CREATE TABLE IF NOT EXISTS sessions(
//!   id TEXT PRIMARY KEY,
//!   title TEXT,
//!   created_at INTEGER,
//!   updated_at INTEGER,
//!   project_path TEXT
//! );
//!
//! CREATE TABLE IF NOT EXISTS messages(
//!   id TEXT PRIMARY KEY,
//!   session_id TEXT NOT NULL,
//!   role TEXT,
//!   content TEXT,
//!   created_at INTEGER,
//!   FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
//! );
//!
//! CREATE TABLE IF NOT EXISTS attachments(
//!   id TEXT PRIMARY KEY,
//!   message_id TEXT NOT NULL,
//!   path TEXT,
//!   mime_type TEXT,
//!   FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
//! );
//!
//! CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
//!   content, content='messages', content_rowid='rowid',
//!   tokenize = 'unicode61 remove_diacritics 2'
//! );
//! ```
//!
//! ## スレッドセーフ化
//!
//! Tauri の `State<HistoryState>` に `Arc<Mutex<Connection>>` を持たせ、各 command
//! は `tokio::task::spawn_blocking` でガード取得 + クエリ発行する。
//!
//! ## Chunk A / C との接続
//!
//! - Chunk A（`lib/stores/chat.ts`）は `currentSessionId` を受け取ったら以降の
//!   `append_message` をこの session id に紐付ける（本ファイルの `create_session` /
//!   `append_message` が frontend から `callTauri` 経由で呼ばれる）。
//! - Chunk C（`search_fts.rs`）は今後 `messages_fts` に対し `MATCH` / `snippet()` で
//!   横断検索を実装する（本 DDL を流用）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use time::OffsetDateTime;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// 型定義（frontend ↔ backend の JSON 転送仕様）
// ---------------------------------------------------------------------------

/// 1 セッション（最小カラム）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_path: Option<String>,
}

/// サイドバー一覧向け（最後のメッセージ抜粋付き）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_path: Option<String>,
    /// 直近 messages.content を 80 文字 trunc（UI 側の省略表示用）。
    pub last_message_excerpt: Option<String>,
    /// 直近 messages.role（user / assistant / tool_use 等）。
    pub last_message_role: Option<String>,
}

/// 1 メッセージ（添付含む）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub attachments: Vec<Attachment>,
}

/// 添付ファイル（画像ペースト等）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub path: String,
    pub mime_type: Option<String>,
}

/// append_message 時のみ使う軽量型（id は backend で採番するので不要）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub path: String,
    pub mime_type: Option<String>,
}

// ---------------------------------------------------------------------------
// Tauri state（Arc<Mutex<Connection>> を invoke_handler で共有）
// ---------------------------------------------------------------------------

/// `invoke_handler` に `manage(HistoryState::default())` で注入する state。
/// `Arc<Mutex<Option<Connection>>>` で `init_history_db()` 成功時のみ Some を保持。
pub struct HistoryState {
    pub conn: Arc<Mutex<Option<Connection>>>,
}

impl Default for HistoryState {
    fn default() -> Self {
        Self {
            conn: Arc::new(Mutex::new(None)),
        }
    }
}

// ---------------------------------------------------------------------------
// 起動時初期化
// ---------------------------------------------------------------------------

/// `~/.ccmux-ide-gui/history.db` へのパスを返す。
///
/// `dirs::home_dir()` を使用（Windows: `%USERPROFILE%`、macOS: `$HOME`、Linux: `$HOME`）。
/// ディレクトリが存在しなければ作成する。
fn db_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home dir が解決できません")?;
    let dir = home.join(".ccmux-ide-gui");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("history dir 作成失敗: {}", dir.display()))?;
    Ok(dir.join("history.db"))
}

/// DDL を 1 発で流す。IF NOT EXISTS なので繰り返し呼んでも無害。
fn apply_ddl(conn: &Connection) -> Result<()> {
    // foreign_keys は接続単位の PRAGMA なので都度 ON にする。
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS sessions(
            id TEXT PRIMARY KEY,
            title TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            project_path TEXT
        );

        CREATE TABLE IF NOT EXISTS messages(
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT,
            content TEXT,
            created_at INTEGER,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session_id
            ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at
            ON messages(session_id, created_at);

        CREATE TABLE IF NOT EXISTS attachments(
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            path TEXT,
            mime_type TEXT,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_attachments_message_id
            ON attachments(message_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            content='messages',
            content_rowid='rowid',
            tokenize = 'unicode61 remove_diacritics 2'
        );

        -- messages と messages_fts を同期する trigger 群。
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
                VALUES('delete', old.rowid, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content)
                VALUES('delete', old.rowid, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        ",
    )
    .context("DDL 実行失敗")?;
    Ok(())
}

/// アプリ起動 setup hook から呼ぶ。失敗しても panic しない（上位でログ出力）。
pub fn init_history_db(state: &HistoryState) -> Result<()> {
    let path = db_path()?;
    let conn = Connection::open(&path)
        .with_context(|| format!("SQLite open 失敗: {}", path.display()))?;
    apply_ddl(&conn)?;
    let mut guard = state
        .conn
        .lock()
        .map_err(|e| anyhow::anyhow!("conn mutex poisoned: {e}"))?;
    *guard = Some(conn);
    Ok(())
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

fn now_epoch() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

/// `spawn_blocking` の中でロックを取り、クロージャに `&mut Connection` を渡す。
async fn with_conn_mut<T, F>(state: &HistoryState, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
{
    let arc = state.conn.clone();
    tokio::task::spawn_blocking(move || -> Result<T, String> {
        let mut guard = arc
            .lock()
            .map_err(|e| format!("conn mutex poisoned: {e}"))?;
        let conn = guard
            .as_mut()
            .ok_or_else(|| "history DB が未初期化です（init_history_db 失敗）".to_string())?;
        f(conn)
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// content を 80 文字で truncate（改行は空白に）。
fn excerpt(content: &str) -> String {
    let one_line: String = content.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    if one_line.chars().count() <= 80 {
        one_line
    } else {
        one_line.chars().take(80).collect::<String>() + "…"
    }
}

fn load_attachments(conn: &Connection, message_id: &str) -> Result<Vec<Attachment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, message_id, path, mime_type \
             FROM attachments WHERE message_id = ?1 ORDER BY id",
        )
        .map_err(|e| format!("attachments prepare 失敗: {e}"))?;
    let rows = stmt
        .query_map(params![message_id], |r| {
            Ok(Attachment {
                id: r.get(0)?,
                message_id: r.get(1)?,
                path: r.get(2)?,
                mime_type: r.get(3)?,
            })
        })
        .map_err(|e| format!("attachments query 失敗: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("attachments row 失敗: {e}"))?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// 新規セッション作成。
#[tauri::command]
pub async fn create_session(
    state: State<'_, HistoryState>,
    title: Option<String>,
    project_path: Option<String>,
) -> Result<Session, String> {
    let id = new_uuid();
    let now = now_epoch();
    let title_c = title.clone();
    let pp_c = project_path.clone();
    let id_c = id.clone();

    with_conn_mut(&state, move |conn| {
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id_c, title_c, now, now, pp_c],
        )
        .map_err(|e| format!("sessions INSERT 失敗: {e}"))?;
        Ok(Session {
            id: id_c,
            title: title_c,
            created_at: now,
            updated_at: now,
            project_path: pp_c,
        })
    })
    .await
}

/// メッセージ追加。session.updated_at も更新する（トランザクション）。
#[tauri::command]
pub async fn append_message(
    state: State<'_, HistoryState>,
    session_id: String,
    role: String,
    content: String,
    attachments: Vec<AttachmentInput>,
) -> Result<Message, String> {
    let id = new_uuid();
    let now = now_epoch();
    let session_id_c = session_id.clone();
    let role_c = role.clone();
    let content_c = content.clone();
    let id_c = id.clone();

    with_conn_mut(&state, move |conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("transaction 開始失敗: {e}"))?;

        // session 存在チェック（ON DELETE CASCADE はあるが、存在しない session_id を
        // そっと飲み込むと UI で追跡困難になるため明示的にエラーにする）。
        let exists: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ?1",
                params![session_id_c],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("sessions SELECT 失敗: {e}"))?;
        if exists.is_none() {
            return Err(format!("session_id={session_id_c} が存在しません"));
        }

        tx.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id_c, session_id_c, role_c, content_c, now],
        )
        .map_err(|e| format!("messages INSERT 失敗: {e}"))?;

        let mut att_out: Vec<Attachment> = Vec::with_capacity(attachments.len());
        for a in &attachments {
            let aid = new_uuid();
            tx.execute(
                "INSERT INTO attachments (id, message_id, path, mime_type) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![aid, id_c, a.path, a.mime_type],
            )
            .map_err(|e| format!("attachments INSERT 失敗: {e}"))?;
            att_out.push(Attachment {
                id: aid,
                message_id: id_c.clone(),
                path: a.path.clone(),
                mime_type: a.mime_type.clone(),
            });
        }

        tx.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id_c],
        )
        .map_err(|e| format!("sessions UPDATE 失敗: {e}"))?;

        tx.commit()
            .map_err(|e| format!("transaction commit 失敗: {e}"))?;

        Ok(Message {
            id: id_c,
            session_id: session_id_c,
            role: role_c,
            content: content_c,
            created_at: now,
            attachments: att_out,
        })
    })
    .await
}

/// セッション一覧を updated_at DESC で取得（最後のメッセージ抜粋付き）。
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, HistoryState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<SessionSummary>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    with_conn_mut(&state, move |conn| {
        // 直近 message を latest_message sub-query で 1 件だけ pull。
        let sql = "\
            SELECT s.id, s.title, s.created_at, s.updated_at, s.project_path, \
                   m.content, m.role \
            FROM sessions s \
            LEFT JOIN messages m ON m.id = ( \
                SELECT id FROM messages \
                WHERE session_id = s.id \
                ORDER BY created_at DESC LIMIT 1 \
            ) \
            ORDER BY s.updated_at DESC \
            LIMIT ?1 OFFSET ?2";
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("sessions prepare 失敗: {e}"))?;
        let rows = stmt
            .query_map(params![limit, offset], |r| {
                let content: Option<String> = r.get(5)?;
                let role: Option<String> = r.get(6)?;
                Ok(SessionSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    created_at: r.get(2)?,
                    updated_at: r.get(3)?,
                    project_path: r.get(4)?,
                    last_message_excerpt: content.as_deref().map(excerpt),
                    last_message_role: role,
                })
            })
            .map_err(|e| format!("sessions query 失敗: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("sessions row 失敗: {e}"))?);
        }
        Ok(out)
    })
    .await
}

/// 指定セッションの全メッセージを created_at ASC で取得（添付も同梱）。
#[tauri::command]
pub async fn get_session_messages(
    state: State<'_, HistoryState>,
    session_id: String,
) -> Result<Vec<Message>, String> {
    with_conn_mut(&state, move |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, created_at \
                 FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| format!("messages prepare 失敗: {e}"))?;
        let msgs = stmt
            .query_map(params![session_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| format!("messages query 失敗: {e}"))?;

        let mut out = Vec::new();
        let mut rows_buf = Vec::new();
        for row in msgs {
            rows_buf.push(row.map_err(|e| format!("messages row 失敗: {e}"))?);
        }
        drop(stmt);

        for (id, session_id, role, content, created_at) in rows_buf {
            let attachments = load_attachments(conn, &id)?;
            out.push(Message {
                id,
                session_id,
                role,
                content,
                created_at,
                attachments,
            });
        }
        Ok(out)
    })
    .await
}

/// セッション削除。ON DELETE CASCADE で messages / attachments も連鎖削除。
#[tauri::command]
pub async fn delete_session(
    state: State<'_, HistoryState>,
    session_id: String,
) -> Result<(), String> {
    with_conn_mut(&state, move |conn| {
        // FK 連鎖削除のため PRAGMA foreign_keys を毎回 ON（WAL 接続でも必要）。
        conn.execute("PRAGMA foreign_keys = ON", [])
            .map_err(|e| format!("PRAGMA foreign_keys 失敗: {e}"))?;
        let affected = conn
            .execute(
                "DELETE FROM sessions WHERE id = ?1",
                params![session_id],
            )
            .map_err(|e| format!("sessions DELETE 失敗: {e}"))?;
        if affected == 0 {
            return Err(format!("session_id={session_id} が存在しません"));
        }
        Ok(())
    })
    .await
}

/// タイトル変更。updated_at も更新する。
#[tauri::command]
pub async fn rename_session(
    state: State<'_, HistoryState>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let now = now_epoch();
    with_conn_mut(&state, move |conn| {
        let affected = conn
            .execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, session_id],
            )
            .map_err(|e| format!("sessions UPDATE 失敗: {e}"))?;
        if affected == 0 {
            return Err(format!("session_id={session_id} が存在しません"));
        }
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------------------
// テスト（in-memory DB）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    //! Tauri `State<T>` は `#[tauri::command]` 内部でのみ取得できるため、
    //! ここではピュアな DDL 適用と SQL 発行の回帰テストのみ行う（invoke_handler
    //! 統合テストは E2E レイヤ / WSL2 実機検証に任せる）。
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn ddl_applies_cleanly_twice() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        apply_ddl(&conn).unwrap();
    }

    #[test]
    fn excerpt_truncates_multiline() {
        let s = "a\nb\nc".to_string();
        assert_eq!(excerpt(&s), "a b c");
        let long = "あ".repeat(120);
        let e = excerpt(&long);
        // 80 chars + '…'
        assert_eq!(e.chars().count(), 81);
        assert!(e.ends_with('…'));
    }

    #[test]
    fn insert_message_syncs_fts() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path) \
             VALUES ('s1', 'test', 1, 1, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m1', 's1', 'user', 'hello world claude', 2)",
            [],
        )
        .unwrap();
        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'claude'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }
}
