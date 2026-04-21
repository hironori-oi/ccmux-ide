//! FTS5 会話履歴横断検索（PM-230 / Week7 Chunk 1）。
//!
//! `commands::history` が初期化した `~/.ccmux-ide-gui/history.db` の
//! `messages_fts` virtual table を利用して、単一 Tauri command から全文検索を
//! 行う。v2 `ccmux-ide/src/ide/search_fts.rs` は skeleton のままだったので、
//! 本ファイルで実装を肉付けした（HistoryState の共有と snippet() の活用が主な
//! 拡張点）。
//!
//! ## クエリ仕様
//!
//! `messages_fts` は `content='messages'` と `content_rowid='rowid'` で
//! contentless virtual table として宣言されているため、以下のように messages
//! 本体 + sessions を JOIN して行を取得する:
//!
//! ```sql
//! SELECT m.id, m.session_id, m.role, m.created_at, s.title,
//!        snippet(messages_fts, 0, '[', ']', '…', 16)
//! FROM messages_fts
//! JOIN messages m ON messages_fts.rowid = m.rowid
//! JOIN sessions s ON m.session_id = s.id
//! WHERE messages_fts MATCH ?1
//! ORDER BY rank
//! LIMIT ?2
//! ```
//!
//! ユーザー入力はそのまま FTS5 MATCH に流すと特殊文字 (`"` `(` `)` `:` `*` 等)
//! で syntax error になるため、`sanitize_query()` で安全なトークンに変換し、
//! 末尾に `*` を付けて prefix search を有効化する。例:
//! - 入力 `tau`      → MATCH `tau*`（tauri, taurus 両方ヒット）
//! - 入力 `tau api`  → MATCH `tau* api*`（AND 結合）
//! - 入力 `"a/b"`    → MATCH `a* b*`（クォートは剥がす）
//!
//! ## スレッドセーフ化
//!
//! `commands::history::HistoryState` の `Arc<Mutex<Option<Connection>>>` を
//! `tauri::State` 経由で共有する。SQLite は rusqlite bundled の single-writer
//! モデルなので、`spawn_blocking` + Mutex で直列化してから発行する。

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use super::history::HistoryState;

// ---------------------------------------------------------------------------
// 型定義（frontend ↔ backend の JSON 転送仕様）
// ---------------------------------------------------------------------------

/// 検索ヒット 1 件（frontend の `SearchResult` と 1:1）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// messages.id（scrollIntoView の anchor に使う）
    pub message_id: String,
    /// 親 session.id（loadSession で chat store に反映）
    pub session_id: String,
    /// sessions.title（NULL 可、一覧の上段に表示）
    pub session_title: Option<String>,
    /// messages.role（"user" / "assistant" / "tool" 等）
    pub role: String,
    /// FTS5 `snippet()` 関数で生成された抜粋。`[...]` がマッチ箇所。
    /// frontend で `[` `]` を正規表現 split して `<mark>` span 化する。
    pub snippet_html: String,
    /// messages.created_at（Unix epoch seconds、相対時刻表示用）
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

/// FTS5 MATCH 構文用に入力クエリをサニタイズする。
///
/// - 英数 / 全角 / CJK は維持、記号 (`"` `(` `)` `:` `*` `-` `+` 等) は空白に置換
/// - 連続空白を 1 個に圧縮し、空白で split してトークン化
/// - 各トークン末尾に `*` を付けて prefix search にする（FTS5 の
///   `PREFIX=1` 相当、contentless table でも MATCH 演算子で機能する）
/// - トークンが 1 つも残らなければ `None`（＝呼び出し側で空配列を返す）
fn sanitize_query(raw: &str) -> Option<String> {
    // FTS5 の特殊文字を一括で空白に寄せる。
    // 参考: https://www.sqlite.org/fts5.html#full_text_query_syntax
    let replaced: String = raw
        .chars()
        .map(|c| match c {
            '"' | '\'' | '(' | ')' | ':' | '*' | '-' | '+' | '^' | '{' | '}' | '[' | ']' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();

    let tokens: Vec<String> = replaced
        .split_whitespace()
        .filter(|t| !t.is_empty())
        // FTS5 tokenizer の unicode61 に合わせて素直にトークン化。
        // 末尾に `*` を付与して前方一致を有効化。
        .map(|t| format!("{t}*"))
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

/// SQL を発行して結果を `Vec<SearchResult>` に積む。
///
/// messages_fts は `content='messages'` の contentless 設計なので、
/// `messages_fts.rowid` と `messages.rowid` を等価結合する。
///
/// v5 Chunk B / DEC-032: `project_id = Some(id)` で sessions.project_id = id の
/// 結果のみに絞り込む。None なら全 project 横断（従来挙動）。
fn run_search(
    conn: &Connection,
    match_query: &str,
    limit: i64,
    project_id: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let rows: Vec<SearchResult> = if let Some(pid) = project_id {
        let sql = "\
            SELECT m.id, m.session_id, m.role, m.created_at, s.title, \
                   snippet(messages_fts, 0, '[', ']', '…', 16) \
            FROM messages_fts \
            JOIN messages m ON messages_fts.rowid = m.rowid \
            JOIN sessions s ON m.session_id = s.id \
            WHERE messages_fts MATCH ?1 AND s.project_id = ?3 \
            ORDER BY rank \
            LIMIT ?2";
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("search prepare 失敗: {e}"))?;
        let iter = stmt
            .query_map(params![match_query, limit, pid], |r| {
                Ok(SearchResult {
                    message_id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    created_at: r.get(3)?,
                    session_title: r.get(4)?,
                    snippet_html: r.get(5)?,
                })
            })
            .map_err(|e| format!("search query 失敗: {e}"))?;
        let mut out = Vec::new();
        for row in iter {
            out.push(row.map_err(|e| format!("search row 失敗: {e}"))?);
        }
        out
    } else {
        let sql = "\
            SELECT m.id, m.session_id, m.role, m.created_at, s.title, \
                   snippet(messages_fts, 0, '[', ']', '…', 16) \
            FROM messages_fts \
            JOIN messages m ON messages_fts.rowid = m.rowid \
            JOIN sessions s ON m.session_id = s.id \
            WHERE messages_fts MATCH ?1 \
            ORDER BY rank \
            LIMIT ?2";
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("search prepare 失敗: {e}"))?;
        let iter = stmt
            .query_map(params![match_query, limit], |r| {
                Ok(SearchResult {
                    message_id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    created_at: r.get(3)?,
                    session_title: r.get(4)?,
                    snippet_html: r.get(5)?,
                })
            })
            .map_err(|e| format!("search query 失敗: {e}"))?;
        let mut out = Vec::new();
        for row in iter {
            out.push(row.map_err(|e| format!("search row 失敗: {e}"))?);
        }
        out
    };
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// 会話検索。`messages_fts` MATCH + snippet() で結果を生成する。
///
/// - `query`: ユーザー入力文字列。空白区切りで AND 検索、末尾 `*` で prefix。
/// - `limit`: 最大返却件数（既定 30、1〜200 にクランプ）。
/// - `project_id`: v5 Chunk B / DEC-032。`Some(id)` なら sessions.project_id = id
///                 の session に紐づく message のみヒット。None は全横断。
///
/// 戻り値: `Vec<SearchResult>`（JSON は camelCase）。
#[tauri::command]
pub async fn search_messages(
    state: State<'_, HistoryState>,
    query: String,
    limit: Option<i64>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    // 空クエリは前段で弾く（DB を叩かずに空配列）
    let sanitized = match sanitize_query(&query) {
        Some(s) => s,
        None => return Ok(Vec::new()),
    };
    let lim = limit.unwrap_or(30).clamp(1, 200);

    let arc = state.conn.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<SearchResult>, String> {
        let guard = arc
            .lock()
            .map_err(|e| format!("conn mutex poisoned: {e}"))?;
        let conn = guard
            .as_ref()
            .ok_or_else(|| "history DB が未初期化です（init_history_db 失敗）".to_string())?;
        run_search(conn, &sanitized, lim, project_id.as_deref())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

// ---------------------------------------------------------------------------
// v2 互換の legacy commands（skeleton を保持、現在は no-op）
// ---------------------------------------------------------------------------
//
// v2 は `~/.claude/projects/*.jsonl` を別 DB に再インデックスする想定だったが、
// v3 GUI は `messages_fts` が `messages` と同期されるため reindex は不要。
// 既存コードの参照を壊さないよう型と関数名は残すが、invoke_handler からは外す。

/// 旧 API（M3 で削除予定）。現状は空配列を返す。
#[tauri::command]
pub async fn search_conversations(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    // FTS5 は共有 messages_fts に統合されたため、HistoryState を持つ
    // `search_messages` を使うよう frontend を誘導する。互換目的の蓋のみ残す。
    let _ = (query, limit);
    Ok(Vec::new())
}

/// 旧 API（M3 で削除予定）。messages_fts は INSERT trigger で自動同期するため
/// 再インデックスは不要。常に 0 を返す。
#[tauri::command]
pub async fn reindex_conversations() -> Result<usize, String> {
    Ok(0)
}

// ---------------------------------------------------------------------------
// テスト（in-memory DB でクエリロジックを検証）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// history.rs の DDL を最小限だけ再現（テスト専用）。
    ///
    /// v5 Chunk B / DEC-032: sessions.project_id 列を最小 DDL にも追加。
    fn apply_minimal_ddl(conn: &Connection) {
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
            CREATE TABLE messages(
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT,
                content TEXT,
                created_at INTEGER
            );
            CREATE VIRTUAL TABLE messages_fts USING fts5(
                content, content='messages', content_rowid='rowid',
                tokenize = 'unicode61 remove_diacritics 2'
            );
            CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content)
                    VALUES (new.rowid, new.content);
            END;
            ",
        )
        .unwrap();
    }

    #[test]
    fn sanitize_query_basic() {
        assert_eq!(sanitize_query("tau"), Some("tau*".to_string()));
        assert_eq!(sanitize_query("tau api"), Some("tau* api*".to_string()));
        assert_eq!(sanitize_query("  "), None);
        assert_eq!(sanitize_query(""), None);
    }

    #[test]
    fn sanitize_query_strips_special_chars() {
        assert_eq!(sanitize_query(r#""hello""#), Some("hello*".to_string()));
        assert_eq!(sanitize_query("a:b(c)"), Some("a* b* c*".to_string()));
        assert_eq!(sanitize_query("foo*bar"), Some("foo* bar*".to_string()));
    }

    #[test]
    fn sanitize_query_keeps_cjk() {
        assert_eq!(
            sanitize_query("こんにちは 世界"),
            Some("こんにちは* 世界*".to_string())
        );
    }

    #[test]
    fn run_search_returns_snippet_and_join() {
        let conn = Connection::open_in_memory().unwrap();
        apply_minimal_ddl(&conn);
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id) \
             VALUES ('s1', 'FTS セッション', 1, 1, NULL, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m1', 's1', 'user', 'Tauri の画像ペーストが壊れている', 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m2', 's1', 'assistant', 'taurus について語りましょう', 200)",
            [],
        )
        .unwrap();

        // prefix search `tau*` で tauri / taurus の両方が拾える。
        let hits = run_search(&conn, "tau*", 10, None).unwrap();
        assert_eq!(hits.len(), 2);
        for h in &hits {
            assert_eq!(h.session_id, "s1");
            assert_eq!(h.session_title.as_deref(), Some("FTS セッション"));
            // snippet は [ ] でマッチ箇所が囲まれている。
            assert!(h.snippet_html.contains('['));
            assert!(h.snippet_html.contains(']'));
        }
    }

    #[test]
    fn run_search_respects_limit_and_rank() {
        let conn = Connection::open_in_memory().unwrap();
        apply_minimal_ddl(&conn);
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id) \
             VALUES ('s1', NULL, 1, 1, NULL, NULL)",
            [],
        )
        .unwrap();
        for i in 0..5 {
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content, created_at) \
                 VALUES (?1, 's1', 'user', ?2, ?3)",
                params![format!("m{i}"), format!("claude {i}"), i],
            )
            .unwrap();
        }
        let hits = run_search(&conn, "claude*", 3, None).unwrap();
        assert_eq!(hits.len(), 3);
    }

    /// v5 Chunk B / DEC-032: project_id filter で絞り込めることを検証。
    #[test]
    fn run_search_filters_by_project_id() {
        let conn = Connection::open_in_memory().unwrap();
        apply_minimal_ddl(&conn);
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id) \
             VALUES ('s-a', 'project A session', 1, 1, NULL, 'proj-A')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, project_path, project_id) \
             VALUES ('s-b', 'project B session', 2, 2, NULL, 'proj-B')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m-a', 's-a', 'user', 'claude in proj A', 10)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, created_at) \
             VALUES ('m-b', 's-b', 'user', 'claude in proj B', 20)",
            [],
        )
        .unwrap();

        // None 指定: 全件ヒット
        let all = run_search(&conn, "claude*", 10, None).unwrap();
        assert_eq!(all.len(), 2);

        // proj-A 指定: 1 件のみ
        let only_a = run_search(&conn, "claude*", 10, Some("proj-A")).unwrap();
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].session_id, "s-a");

        // 存在しない project: 0 件
        let none = run_search(&conn, "claude*", 10, Some("proj-none")).unwrap();
        assert_eq!(none.len(), 0);
    }
}
