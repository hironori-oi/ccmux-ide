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
//!   project_path TEXT,
//!   project_id TEXT DEFAULT NULL  -- v5 Chunk B / DEC-032 で追加
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
///
/// v5 Chunk B (DEC-032): `project_id` を追加。既存 session は NULL（未分類）として
/// 保持し、project 切替時に activeProjectId から自動 attach される。
///
/// PM-830 (v3.5.14): `sdk_session_id` を追加。Claude Agent SDK 側 session の
/// UUID（`SDKSystemMessage.session_id`）を保持し、次回送信時に
/// `query({ resume: sdk_session_id })` で context を継続する。NULL は未取得
/// （初回送信前 / 取得前のレガシー session）で、その場合は stateless 呼出となる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_path: Option<String>,
    /// DEC-032: project registry の id（例 "PRJ-012"）。NULL は未分類。
    pub project_id: Option<String>,
    /// PM-830: Claude Agent SDK 側 session UUID。次回送信で `resume` に渡して context 継続。
    pub sdk_session_id: Option<String>,
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
    /// DEC-032: session を登録した project registry の id。NULL は未分類。
    pub project_id: Option<String>,
    /// PM-830: Claude Agent SDK 側 session UUID（context 継続用）。NULL は未取得。
    pub sdk_session_id: Option<String>,
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

/// sessions テーブルに指定列が存在するか確認する。
///
/// SQLite の `ALTER TABLE ADD COLUMN` は冪等でない（既に列があると error）ため、
/// `PRAGMA table_info(sessions)` で列の存在を確認してから ALTER を発行する。
/// apply_ddl を 2 回以上呼んでも安全なよう、migrate 側で存在確認する。
fn sessions_has_column(conn: &Connection, column: &str) -> Result<bool> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(sessions)")
        .context("PRAGMA table_info prepare 失敗")?;
    let rows = stmt
        .query_map([], |row| {
            // PRAGMA table_info の列順: cid, name, type, notnull, dflt_value, pk
            let name: String = row.get(1)?;
            Ok(name)
        })
        .context("PRAGMA table_info query 失敗")?;
    for row in rows {
        let name = row.context("PRAGMA table_info row 失敗")?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `sessions.project_id` 列の存在チェック。
///
/// v1.12.0 (DEC-058) 以降、`delete_project` が本列に依存して cascade するため、
/// **apply_ddl の末尾で invariant として assertion** し、万一 migration が
/// 完走しなかった DB では起動時に検知できるようにする。既存テストからの
/// 参照と役割を合わせて 1 本化した（旧 unused warning の正式活用）。
fn sessions_has_project_id(conn: &Connection) -> Result<bool> {
    sessions_has_column(conn, "project_id")
}

/// v5 Chunk B / DEC-032 の schema migration。
///
/// - 既存 DB（project_id 列がない）には `ALTER TABLE ADD COLUMN` を発行
/// - 新規 DB は apply_ddl の CREATE TABLE で既に列が入っているため no-op
/// - 2 回以上呼んでも冪等（列が存在すれば skip）
fn migrate_sessions_project_id(conn: &Connection) -> Result<()> {
    if sessions_has_column(conn, "project_id")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE sessions ADD COLUMN project_id TEXT DEFAULT NULL",
        [],
    )
    .context("ALTER TABLE sessions ADD COLUMN project_id 失敗")?;
    Ok(())
}

/// PM-830 (v3.5.14) の schema migration: `sdk_session_id` 列を追加する。
///
/// - 既存 DB（sdk_session_id 列がない）には `ALTER TABLE ADD COLUMN` を発行
/// - 新規 DB は apply_ddl の CREATE TABLE で既に列が入っているため no-op
/// - 2 回以上呼んでも冪等（列が存在すれば skip）
///
/// 既存 session は NULL のまま保持され、初回送信時に sidecar から取得する
/// `system.session_id` で埋まる（その時点で stateless 1 回 → 以降 resume）。
fn migrate_sessions_sdk_session_id(conn: &Connection) -> Result<()> {
    if sessions_has_column(conn, "sdk_session_id")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT DEFAULT NULL",
        [],
    )
    .context("ALTER TABLE sessions ADD COLUMN sdk_session_id 失敗")?;
    Ok(())
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
            project_path TEXT,
            project_id TEXT DEFAULT NULL,
            sdk_session_id TEXT DEFAULT NULL
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

    // v5 Chunk B / DEC-032: 既存 DB の ALTER 補填 + index 追加（冪等）。
    // 新規 DB は CREATE TABLE ... project_id TEXT で既に列があるので ALTER は skip。
    migrate_sessions_project_id(conn)?;

    // PM-830: SDK session 継続用列の migration（冪等）。
    // 既存 DB の sdk_session_id 列が無ければ ALTER で追加、新規 DB は CREATE TABLE
    // 側に既に含まれているため no-op。
    migrate_sessions_sdk_session_id(conn)?;

    // project_id での filter を効かせるため index を追加（idempotent）。
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_project_id \
         ON sessions(project_id)",
        [],
    )
    .context("idx_sessions_project_id 作成失敗")?;

    // v1.12.0 / DEC-058 invariant check:
    // `delete_project` が project_id 列に依存するため、migration が完走して
    // 列が存在することを起動時に verify する。失敗すれば init_history_db が
    // Err を返し、lib.rs の setup hook 側でログに残る（Tauri 起動は継続）。
    if !sessions_has_project_id(conn)? {
        return Err(anyhow::anyhow!(
            "migration 未完: sessions.project_id 列が存在しません (delete_project 不可)"
        ));
    }

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
///
/// v5 Chunk B / DEC-032: `project_id: Option<String>` を受け取り、null なら未分類
/// として INSERT。frontend 側では activeProjectId を自動 attach する想定。
///
/// PM-939 (v3.5.22): セッションは必ずプロジェクトに紐づく。`project_id` が
/// `None` または空文字の場合は Err を返す（frontend の store / UI でも同等の
/// ガードを張っているが、slash / keyboard 経路や将来の新規 invoke 呼出に備えた
/// 最後の防衛線）。既存の未分類 session (project_id IS NULL) は読込 / 表示は
/// そのまま可能で、本 guard は **新規作成** のみに効く。
#[tauri::command]
pub async fn create_session(
    state: State<'_, HistoryState>,
    title: Option<String>,
    project_path: Option<String>,
    project_id: Option<String>,
) -> Result<Session, String> {
    // PM-939: project_id が無い / 空文字なら拒否。
    let pid_present = project_id
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !pid_present {
        return Err(
            "プロジェクトが選択されていません。プロジェクトを作成/選択してから新規セッションを作成してください。"
                .to_string(),
        );
    }

    let id = new_uuid();
    let now = now_epoch();
    let title_c = title.clone();
    let pp_c = project_path.clone();
    let pid_c = project_id.clone();
    let id_c = id.clone();

    with_conn_mut(&state, move |conn| {
        conn.execute(
            "INSERT INTO sessions \
                (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![id_c, title_c, now, now, pp_c, pid_c],
        )
        .map_err(|e| format!("sessions INSERT 失敗: {e}"))?;
        Ok(Session {
            id: id_c,
            title: title_c,
            created_at: now,
            updated_at: now,
            project_path: pp_c,
            project_id: pid_c,
            // PM-830: 初回送信時に sidecar から system event で取得 → update_session_sdk_id で埋める
            sdk_session_id: None,
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
///
/// v5 Chunk B / DEC-032: `project_id` で filter 可能。
/// - `Some(id)`: 指定 project の session のみ
/// - `None`:    全件（未分類含む）— 「未分類のみ」は呼出側で `projectId == null`
///               を filter して抽出する（特別なセンチネル文字列は使わない）
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, HistoryState>,
    limit: Option<i64>,
    offset: Option<i64>,
    project_id: Option<String>,
) -> Result<Vec<SessionSummary>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    with_conn_mut(&state, move |conn| {
        // 直近 message を latest_message sub-query で 1 件だけ pull。
        // project_id が Some ならそれで絞り込む。FTS5 と messages 側には
        // project_id を持たせない（sessions 側で join して引ける）。
        // PM-830: SELECT に sdk_session_id を追加（list_sessions 戻り値に含めて
        // frontend 側 fetchSessions で session store に保持 → 送信時 resume に使う）。
        let (sql, rows): (&str, Vec<SessionSummary>) = if let Some(pid) = project_id.clone() {
            let sql = "\
                SELECT s.id, s.title, s.created_at, s.updated_at, s.project_path, \
                       s.project_id, s.sdk_session_id, \
                       m.content, m.role \
                FROM sessions s \
                LEFT JOIN messages m ON m.id = ( \
                    SELECT id FROM messages \
                    WHERE session_id = s.id \
                    ORDER BY created_at DESC LIMIT 1 \
                ) \
                WHERE s.project_id = ?3 \
                ORDER BY s.updated_at DESC \
                LIMIT ?1 OFFSET ?2";
            let mut stmt = conn
                .prepare(sql)
                .map_err(|e| format!("sessions prepare 失敗: {e}"))?;
            let iter = stmt
                .query_map(params![limit, offset, pid], |r| {
                    let content: Option<String> = r.get(7)?;
                    let role: Option<String> = r.get(8)?;
                    Ok(SessionSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        created_at: r.get(2)?,
                        updated_at: r.get(3)?,
                        project_path: r.get(4)?,
                        project_id: r.get(5)?,
                        sdk_session_id: r.get(6)?,
                        last_message_excerpt: content.as_deref().map(excerpt),
                        last_message_role: role,
                    })
                })
                .map_err(|e| format!("sessions query 失敗: {e}"))?;
            let mut out = Vec::new();
            for row in iter {
                out.push(row.map_err(|e| format!("sessions row 失敗: {e}"))?);
            }
            (sql, out)
        } else {
            let sql = "\
                SELECT s.id, s.title, s.created_at, s.updated_at, s.project_path, \
                       s.project_id, s.sdk_session_id, \
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
            let iter = stmt
                .query_map(params![limit, offset], |r| {
                    let content: Option<String> = r.get(7)?;
                    let role: Option<String> = r.get(8)?;
                    Ok(SessionSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        created_at: r.get(2)?,
                        updated_at: r.get(3)?,
                        project_path: r.get(4)?,
                        project_id: r.get(5)?,
                        sdk_session_id: r.get(6)?,
                        last_message_excerpt: content.as_deref().map(excerpt),
                        last_message_role: role,
                    })
                })
                .map_err(|e| format!("sessions query 失敗: {e}"))?;
            let mut out = Vec::new();
            for row in iter {
                out.push(row.map_err(|e| format!("sessions row 失敗: {e}"))?);
            }
            (sql, out)
        };
        let _ = sql; // lint 対策: sql は debug 用、今は未使用
        Ok(rows)
    })
    .await
}

/// v5 Chunk B / DEC-032: 既存 session の project_id を再割当する。
///
/// 将来の一括移行・手動分類 UI 用の nice-to-have。
/// - `project_id = Some(id)` で指定 project に紐づけ
/// - `project_id = None`    で未分類へ戻す
#[tauri::command]
pub async fn update_session_project(
    state: State<'_, HistoryState>,
    session_id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let now = now_epoch();
    with_conn_mut(&state, move |conn| {
        let affected = conn
            .execute(
                "UPDATE sessions SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![project_id, now, session_id],
            )
            .map_err(|e| format!("sessions UPDATE project_id 失敗: {e}"))?;
        if affected == 0 {
            return Err(format!("session_id={session_id} が存在しません"));
        }
        Ok(())
    })
    .await
}

/// PM-830: session の `sdk_session_id` を更新する。
///
/// 初回送信完了時、sidecar が `system.session_id` を含む `sdk_session_ready`
/// outbound event を frontend に通知 → frontend が本 command を呼んで DB に保存する。
/// 2 回目以降の送信時に session store からこの id を引き、`send_agent_prompt` の
/// `resume` 引数に渡すことで Claude 側 context を継続する。
///
/// - `sdk_session_id = Some(id)` で正常 attach
/// - `sdk_session_id = None` で reset（resume 失敗時のフォールバック等で利用）
///
/// session が存在しない場合は明示的にエラー（silently 飲み込まない）。
#[tauri::command(rename_all = "camelCase")]
pub async fn update_session_sdk_id(
    state: State<'_, HistoryState>,
    session_id: String,
    sdk_session_id: Option<String>,
) -> Result<(), String> {
    let now = now_epoch();
    with_conn_mut(&state, move |conn| {
        let affected = conn
            .execute(
                "UPDATE sessions SET sdk_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![sdk_session_id, now, session_id],
            )
            .map_err(|e| format!("sessions UPDATE sdk_session_id 失敗: {e}"))?;
        if affected == 0 {
            return Err(format!("session_id={session_id} が存在しません"));
        }
        Ok(())
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

/// PRJ-012 v1.12.0 / DEC-058: プロジェクト削除の cascade 実装結果。
///
/// `delete_project` の戻り値として Frontend に渡す。Frontend 側は
/// `deleted_session_ids` を受け取って、session キーを持つ各 store
/// (session-preferences / monitor / chat / editor / terminal 等) の該当
/// entry を purge する。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectResult {
    /// 削除した project id（引数のエコーバック）。
    pub project_id: String,
    /// `sessions` テーブルから cascade 削除された session id 群。
    /// Frontend は ここに含まれる id について per-session state を全 purge する。
    pub deleted_session_ids: Vec<String>,
}

/// プロジェクト削除の cascade 実装 (PRJ-012 v1.12.0 / DEC-058)。
///
/// `sessions` テーブルに `project_id = ?1` で紐づく session を検索して、
/// それらを **単一 transaction** で削除する。`messages` / `attachments` は
/// sessions の FK `ON DELETE CASCADE` により自動削除される（下位 DDL 参照）。
/// FTS5 trigger (`messages_ad`) も同 transaction 内で messages の delete に
/// 追随するため、cascade 全体が原子的に成立する。
///
/// ## 返り値
/// 削除した session id 群を `DeleteProjectResult.deletedSessionIds` に詰めて返す。
/// Frontend 側で zustand store (session-preferences / monitor / chat 等) の
/// session キー entry を purge するのに利用する。
///
/// ## 失敗時の原子性
/// transaction 内で 1 step でも失敗すれば `tx.commit()?` に到達せず `Drop` で
/// 自動 ROLLBACK される。frontend には Err(String) が返り、store は一切変更
/// されない（呼出側は catch してリトライ or エラー toast を出す）。
///
/// ## projects テーブルの扱い
/// v1.12.0 時点で `projects` テーブルは DB に存在しない（プロジェクト一覧は
/// localStorage 側の zustand persist store で管理）。そのため本関数は
/// `sessions` テーブルの cascade のみ担い、projects 本体の削除は Frontend
/// (`useProjectStore.removeProject`) に委ねる。将来 projects テーブルを
/// 追加したタイミングで、この transaction 内に `DELETE FROM projects WHERE id = ?1`
/// を差し込む形で拡張する。
///
/// ## なぜ SELECT + DELETE を 2 step に分けるか
/// `DELETE ... RETURNING id` は rusqlite + SQLite 3.35+ で使えるが、
/// FTS5 trigger 連動との組み合わせで稀に戻り値が欠ける実装差があるため、
/// 安全な **(1) SELECT で id 一覧, (2) DELETE** の 2 step 方式を採用する。
/// 同一 transaction 内なので他セッションから中間状態は観測されない。
#[tauri::command(rename_all = "camelCase")]
pub async fn delete_project(
    state: State<'_, HistoryState>,
    project_id: String,
) -> Result<DeleteProjectResult, String> {
    let pid_c = project_id.clone();
    with_conn_mut(&state, move |conn| {
        // FK 連鎖削除 (messages / attachments ON DELETE CASCADE) のため毎回 ON。
        // WAL journal mode の接続でも session 単位で設定が必要。
        conn.execute("PRAGMA foreign_keys = ON", [])
            .map_err(|e| format!("PRAGMA foreign_keys 失敗: {e}"))?;

        let tx = conn
            .transaction()
            .map_err(|e| format!("transaction 開始失敗: {e}"))?;

        // Step 1: 削除対象の session id 一覧を取得する。
        // 空 Vec なら session 無し project の登録解除のみ（DELETE も実質 no-op）。
        let mut deleted_session_ids: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM sessions WHERE project_id = ?1")
                .map_err(|e| format!("sessions SELECT prepare 失敗: {e}"))?;
            let iter = stmt
                .query_map(params![pid_c], |row| row.get::<_, String>(0))
                .map_err(|e| format!("sessions SELECT query 失敗: {e}"))?;
            let mut out = Vec::new();
            for row in iter {
                out.push(row.map_err(|e| format!("sessions SELECT row 失敗: {e}"))?);
            }
            out
        };

        // Step 2: sessions を一括 DELETE。
        // ON DELETE CASCADE 経由で messages / attachments / messages_fts も連鎖削除。
        tx.execute(
            "DELETE FROM sessions WHERE project_id = ?1",
            params![pid_c],
        )
        .map_err(|e| format!("sessions DELETE 失敗: {e}"))?;

        // Step 3: transaction commit。Drop 時 rollback との境界。
        tx.commit()
            .map_err(|e| format!("transaction commit 失敗: {e}"))?;

        // 安定した順序で返す（Frontend のログ / テスト assertion を安定化させる目的）。
        deleted_session_ids.sort();
        Ok(DeleteProjectResult {
            project_id: pid_c,
            deleted_session_ids,
        })
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
        // 2 回目の apply_ddl でも sessions.project_id は存在する（冪等）
        assert!(sessions_has_project_id(&conn).unwrap());
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
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s1', 'test', 1, 1, NULL, NULL, NULL)",
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

    // -----------------------------------------------------------------------
    // v5 Chunk B / DEC-032: project_id 列の migration + filter 回帰テスト
    //
    // `with_conn_mut` は Tauri State 依存のため、ここでは Connection を直接
    // 操作して SQL 層の挙動を検証する。Tauri command の引数受け渡しは E2E
    // レイヤに任せる。
    // -----------------------------------------------------------------------

    /// 新規 DB の CREATE TABLE に project_id が含まれることを確認。
    #[test]
    fn apply_ddl_creates_project_id_column() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        assert!(sessions_has_project_id(&conn).unwrap());
    }

    /// 既存 DB（project_id 列がない）からの migration が冪等に動くことを確認。
    #[test]
    fn migrate_adds_project_id_to_legacy_db() {
        let conn = Connection::open_in_memory().unwrap();
        // v0 相当の legacy sessions（project_id 列なし）を手で作る
        conn.execute_batch(
            "
            CREATE TABLE sessions(
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                project_path TEXT
            );
            ",
        )
        .unwrap();
        assert!(!sessions_has_project_id(&conn).unwrap());

        // 初回 migrate: 列が追加される
        migrate_sessions_project_id(&conn).unwrap();
        assert!(sessions_has_project_id(&conn).unwrap());

        // 2 回目 migrate: skip されて error にならない（idempotent）
        migrate_sessions_project_id(&conn).unwrap();
        assert!(sessions_has_project_id(&conn).unwrap());
    }

    /// DDL の 2 回適用後も idx_sessions_project_id が作成済であることを確認。
    #[test]
    fn apply_ddl_creates_project_id_index() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        apply_ddl(&conn).unwrap();
        let idx_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master \
                 WHERE type='index' AND name='idx_sessions_project_id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 1);
    }

    /// project_id = NULL の既存 session は ALTER 後も NULL のまま保たれる（後方互換）。
    #[test]
    fn legacy_sessions_preserve_null_project_id_after_migration() {
        let conn = Connection::open_in_memory().unwrap();
        // v0 相当の legacy sessions + データを投入
        conn.execute_batch(
            "
            CREATE TABLE sessions(
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                project_path TEXT
            );
            INSERT INTO sessions (id, title, created_at, updated_at, project_path)
                VALUES ('legacy-1', 'old session', 1, 1, NULL);
            INSERT INTO sessions (id, title, created_at, updated_at, project_path)
                VALUES ('legacy-2', NULL, 2, 2, '/tmp/foo');
            ",
        )
        .unwrap();

        migrate_sessions_project_id(&conn).unwrap();

        // 既存 2 件の project_id が NULL のまま保持されていること
        let null_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(null_count, 2);

        let total: i64 = conn
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 2);
    }

    /// list_sessions の SQL 層で project_id filter が機能することを検証。
    /// （Tauri State を介さず、create_session / list_sessions の SQL を直接再現）。
    #[test]
    fn list_sessions_filters_by_project_id() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();

        // proj-A に 2 件、proj-B に 1 件、未分類 1 件
        let rows = [
            ("s-a1", Some("proj-A"), 10),
            ("s-a2", Some("proj-A"), 20),
            ("s-b1", Some("proj-B"), 30),
            ("s-none", None::<&str>, 40),
        ];
        for (id, pid, ts) in rows.iter() {
            conn.execute(
                "INSERT INTO sessions \
                   (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
                 VALUES (?1, NULL, ?2, ?2, NULL, ?3, NULL)",
                params![id, ts, pid],
            )
            .unwrap();
        }

        // proj-A フィルタ: 2 件
        let count_a: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id = ?1",
                params!["proj-A"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_a, 2);

        // proj-B フィルタ: 1 件
        let count_b: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id = ?1",
                params!["proj-B"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_b, 1);

        // 全件 (filter なし): 4 件
        let count_all: i64 = conn
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_all, 4);

        // 未分類 (project_id IS NULL): 1 件
        let count_null: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_null, 1);

        // 未分類は project_id = 'proj-A' filter には含まれない
        let not_in_a: Option<String> = conn
            .query_row(
                "SELECT id FROM sessions WHERE project_id = ?1 AND id = 's-none'",
                params!["proj-A"],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(not_in_a.is_none());
    }

    /// create_session が project_id = Some を受け付け、INSERT 後に list で引ける。
    #[test]
    fn create_session_sql_accepts_project_id_some() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();

        // create_session が内部で発行する SQL を模倣
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params!["new-1", Option::<String>::None, 100i64, 100i64, Option::<String>::None, Some("PRJ-012")],
        )
        .unwrap();

        let pid: Option<String> = conn
            .query_row(
                "SELECT project_id FROM sessions WHERE id = 'new-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pid.as_deref(), Some("PRJ-012"));
    }

    /// create_session が project_id = None を受け付け、NULL で INSERT される。
    #[test]
    fn create_session_sql_accepts_project_id_none() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();

        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                "new-2",
                Option::<String>::None,
                200i64,
                200i64,
                Option::<String>::None,
                Option::<String>::None
            ],
        )
        .unwrap();

        let pid: Option<String> = conn
            .query_row(
                "SELECT project_id FROM sessions WHERE id = 'new-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pid, None);
    }

    /// update_session_project 相当の SQL が期待通り書き換わる。
    #[test]
    fn update_session_project_reassigns_project_id() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s1', NULL, 1, 1, NULL, NULL, NULL)",
            [],
        )
        .unwrap();

        // 未分類 -> proj-X
        let affected = conn
            .execute(
                "UPDATE sessions SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
                params!["proj-X", 2i64, "s1"],
            )
            .unwrap();
        assert_eq!(affected, 1);

        let pid: Option<String> = conn
            .query_row(
                "SELECT project_id FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pid.as_deref(), Some("proj-X"));

        // proj-X -> None（未分類へ戻す）
        conn.execute(
            "UPDATE sessions SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![Option::<String>::None, 3i64, "s1"],
        )
        .unwrap();
        let pid2: Option<String> = conn
            .query_row(
                "SELECT project_id FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pid2, None);
    }

    // -----------------------------------------------------------------------
    // PM-830 (v3.5.14): sdk_session_id migration / update / list の回帰テスト
    //
    // - apply_ddl で新規 DB に列が含まれること
    // - 既存 DB（sdk_session_id 列なし）からの ALTER 補填が冪等に動くこと
    // - update_session_sdk_id 相当の SQL で attach / reset の双方ができること
    // - list_sessions が SELECT に sdk_session_id を含めて返せること
    // -----------------------------------------------------------------------

    /// 新規 DB の CREATE TABLE に sdk_session_id が含まれることを確認。
    #[test]
    fn apply_ddl_creates_sdk_session_id_column() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        assert!(sessions_has_column(&conn, "sdk_session_id").unwrap());
    }

    /// 既存 DB（project_id まではあるが sdk_session_id がない v5 相当）からの
    /// migration が冪等に動くことを確認。
    #[test]
    fn migrate_adds_sdk_session_id_to_v5_db() {
        let conn = Connection::open_in_memory().unwrap();
        // v5 相当: project_id まではあるが sdk_session_id がない
        conn.execute_batch(
            "
            CREATE TABLE sessions(
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                project_path TEXT,
                project_id TEXT DEFAULT NULL
            );
            INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id)
                VALUES ('legacy-1', 'old', 1, 1, NULL, 'PRJ-012');
            ",
        )
        .unwrap();
        assert!(sessions_has_column(&conn, "project_id").unwrap());
        assert!(!sessions_has_column(&conn, "sdk_session_id").unwrap());

        // 初回 migrate: 列が追加される、既存データは保持される
        migrate_sessions_sdk_session_id(&conn).unwrap();
        assert!(sessions_has_column(&conn, "sdk_session_id").unwrap());
        let sdk_id: Option<String> = conn
            .query_row(
                "SELECT sdk_session_id FROM sessions WHERE id = 'legacy-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sdk_id, None);

        // 2 回目 migrate: skip されて error にならない（idempotent）
        migrate_sessions_sdk_session_id(&conn).unwrap();
    }

    /// apply_ddl の 2 回適用後も sdk_session_id 列が確実に存在する（上位 idempotency 保証）。
    #[test]
    fn apply_ddl_twice_preserves_sdk_session_id() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        apply_ddl(&conn).unwrap();
        assert!(sessions_has_column(&conn, "sdk_session_id").unwrap());
    }

    /// update_session_sdk_id 相当の SQL で attach / reset 両方が動く。
    #[test]
    fn update_session_sdk_id_attaches_and_resets() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions \
                (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s1', NULL, 1, 1, NULL, NULL, NULL)",
            [],
        )
        .unwrap();

        // None -> Some(uuid)
        let sdk_uuid = "11111111-2222-3333-4444-555555555555";
        let affected = conn
            .execute(
                "UPDATE sessions SET sdk_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![Some(sdk_uuid), 2i64, "s1"],
            )
            .unwrap();
        assert_eq!(affected, 1);
        let got: Option<String> = conn
            .query_row(
                "SELECT sdk_session_id FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(got.as_deref(), Some(sdk_uuid));

        // Some -> None（resume 失敗時の reset 経路）
        conn.execute(
            "UPDATE sessions SET sdk_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![Option::<String>::None, 3i64, "s1"],
        )
        .unwrap();
        let got2: Option<String> = conn
            .query_row(
                "SELECT sdk_session_id FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(got2, None);
    }

    /// list_sessions の SELECT 列順序を真似て sdk_session_id が読み出せる。
    /// 実際の SessionSummary 構築は Tauri 経由なのでここでは SQL 形のみ検証する。
    #[test]
    fn list_sessions_select_returns_sdk_session_id() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions \
                (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s1', 'test', 1, 1, NULL, NULL, 'abc-123')",
            [],
        )
        .unwrap();

        // list_sessions (filter なしブランチ) と同じ SELECT 列順
        let sql = "\
            SELECT s.id, s.title, s.created_at, s.updated_at, s.project_path, \
                   s.project_id, s.sdk_session_id, \
                   m.content, m.role \
            FROM sessions s \
            LEFT JOIN messages m ON m.id = ( \
                SELECT id FROM messages \
                WHERE session_id = s.id \
                ORDER BY created_at DESC LIMIT 1 \
            ) \
            ORDER BY s.updated_at DESC \
            LIMIT 10 OFFSET 0";
        let mut stmt = conn.prepare(sql).unwrap();
        let mut rows = stmt.query([]).unwrap();
        let row = rows.next().unwrap().unwrap();
        let id: String = row.get(0).unwrap();
        let sdk_session_id: Option<String> = row.get(6).unwrap();
        assert_eq!(id, "s1");
        assert_eq!(sdk_session_id.as_deref(), Some("abc-123"));
    }

    // -----------------------------------------------------------------------
    // v1.12.0 / DEC-058: delete_project transaction cascade の SQL 検証
    //
    // Tauri State を介さず、delete_project 内部の transaction 手順と同じ
    // SQL を直接発行して、cascade の挙動と messages / attachments の連鎖削除、
    // 未対象 project (session_id 未一致) の保持を確認する。
    // -----------------------------------------------------------------------

    /// delete_project: 対象 project の sessions 全件が削除され、id リストが返る。
    /// 他 project の sessions は残る。
    #[test]
    fn delete_project_cascade_removes_target_sessions_only() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();

        // proj-A に 2 件、proj-B に 1 件、未分類 1 件
        for (id, pid, ts) in [
            ("s-a1", Some("proj-A"), 10i64),
            ("s-a2", Some("proj-A"), 20i64),
            ("s-b1", Some("proj-B"), 30i64),
            ("s-none", None::<&str>, 40i64),
        ] {
            conn.execute(
                "INSERT INTO sessions \
                   (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
                 VALUES (?1, NULL, ?2, ?2, NULL, ?3, NULL)",
                params![id, ts, pid],
            )
            .unwrap();
        }

        // delete_project(proj-A) の内部手順を再現:
        // SELECT で id 一覧取得 → DELETE で一括削除（同一 transaction 想定）
        let target = "proj-A";
        let deleted_ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM sessions WHERE project_id = ?1")
                .unwrap();
            let iter = stmt
                .query_map(params![target], |r| r.get::<_, String>(0))
                .unwrap();
            iter.map(|r| r.unwrap()).collect()
        };
        assert_eq!(deleted_ids.len(), 2);
        assert!(deleted_ids.contains(&"s-a1".to_string()));
        assert!(deleted_ids.contains(&"s-a2".to_string()));

        let affected = conn
            .execute(
                "DELETE FROM sessions WHERE project_id = ?1",
                params![target],
            )
            .unwrap();
        assert_eq!(affected, 2);

        // proj-B / 未分類 は残る
        let remaining: i64 = conn
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 2);
        let b_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id = ?1",
                params!["proj-B"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(b_count, 1);
    }

    /// delete_project: sessions を DELETE すると messages / attachments も
    /// FK `ON DELETE CASCADE` で連鎖削除される（messages_fts trigger も追随）。
    #[test]
    fn delete_project_cascades_to_messages_and_attachments() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        // FK CASCADE 有効化（delete_project 本体と同じ）
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        // proj-A の session 1 件 + message 2 件 + attachment 1 件、
        // proj-B の session 1 件 + message 1 件（残るべき）
        conn.execute(
            "INSERT INTO sessions \
               (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s-a', NULL, 1, 1, NULL, 'proj-A', NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions \
               (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s-b', NULL, 2, 2, NULL, 'proj-B', NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m-a1', 's-a', 'user', 'hello', 10), \
                    ('m-a2', 's-a', 'assistant', 'hi', 11), \
                    ('m-b1', 's-b', 'user', 'keep me', 12)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attachments (id, message_id, path, mime_type) \
             VALUES ('at-a1', 'm-a1', '/tmp/x.png', 'image/png')",
            [],
        )
        .unwrap();

        // proj-A 削除
        conn.execute(
            "DELETE FROM sessions WHERE project_id = ?1",
            params!["proj-A"],
        )
        .unwrap();

        // sessions: s-a 消滅、s-b 残存
        let sess: i64 = conn
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sess, 1);

        // messages: m-a1 / m-a2 消滅、m-b1 残存
        let msg: i64 = conn
            .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(msg, 1);
        let has_mb1: i64 = conn
            .query_row(
                "SELECT count(*) FROM messages WHERE id = 'm-b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_mb1, 1);

        // attachments: at-a1 消滅
        let att: i64 = conn
            .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(att, 0);

        // messages_fts: 削除対象 message は hit しない
        let hits_hi: i64 = conn
            .query_row(
                "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'hi'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits_hi, 0);
        let hits_keep: i64 = conn
            .query_row(
                "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'keep'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits_keep, 1);
    }

    /// delete_project: session 無し project を渡すと deleted_session_ids は空、
    /// かつ他の sessions / messages は一切触られない。
    #[test]
    fn delete_project_empty_project_returns_empty_list() {
        let conn = Connection::open_in_memory().unwrap();
        apply_ddl(&conn).unwrap();
        conn.execute(
            "INSERT INTO sessions \
               (id, title, created_at, updated_at, project_path, project_id, sdk_session_id) \
             VALUES ('s-keep', NULL, 1, 1, NULL, 'proj-KEEP', NULL)",
            [],
        )
        .unwrap();

        // session が紐付いていない project を削除
        let ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM sessions WHERE project_id = ?1")
                .unwrap();
            let iter = stmt
                .query_map(params!["proj-EMPTY"], |r| r.get::<_, String>(0))
                .unwrap();
            iter.map(|r| r.unwrap()).collect()
        };
        assert!(ids.is_empty());
        let affected = conn
            .execute(
                "DELETE FROM sessions WHERE project_id = ?1",
                params!["proj-EMPTY"],
            )
            .unwrap();
        assert_eq!(affected, 0);

        // proj-KEEP の session は残存
        let remaining: i64 = conn
            .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
    }
}
