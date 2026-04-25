//! Claude Code 組込 slash コマンド (PRJ-012 v4 / Chunk C / DEC-028)。
//!
//! Claude Code には CLI/TUI 内蔵の slash コマンド (`/mcp`, `/clear`, `/model`,
//! `/init`, `/help`, `/compact`, `/config`) があるが、Agent SDK 経由ではこれらを
//! 直接実行できない（SDK は `query()` API でモデル送信のみ）。そのため、本
//! モジュールは frontend 側 `lib/builtin-slash.ts` の intercept ハンドラから呼ばれ、
//! GUI ネイティブな action（dialog / router / Rust 呼出）に振り分けるための
//! Tauri command 群を提供する。
//!
//! ## 提供 command
//!
//! - `list_builtin_slashes` : 固定 7 件の組込 slash メタを返す（パレット表示用）
//! - `builtin_init_claude_md` : workspace ルートに `CLAUDE.md` 雛形を生成
//! - `read_mcp_config`  : Global (`~/.claude.json`) or Project (`.mcp.json`) を読む
//! - `write_mcp_config` : Global or Project の MCP 設定を保存（バリデーション込み）
//!
//! ## v4 スコープと M3 Could 申し送り
//!
//! - PTY 併用（B 案）は M3 後 v4 候補。本ファイルは A 案 (GUI ネイティブ実装) に閉じる。
//! - `/compact` は Agent SDK 側に compaction API が来るまで toast 案内のみ
//!   （frontend で完結するため Rust 側 command 不要）。

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// 組込 slash 1 件（frontend `BuiltinSlash` 型と 1:1）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinSlash {
    /// 先頭 `/` を含むコマンド名（例: `/mcp`）。
    pub name: String,
    /// 1 行の日本語要約。
    pub description: String,
    /// frontend 側 dispatcher が分岐に使う action ID。
    /// 値は `lib/builtin-slash.ts` の `BuiltinAction` と一致させる。
    pub action: String,
}

/// 組込スラッシュ一覧を固定で返す。順番は `/help` で表示する見た目の順序と揃える。
///
/// v1.24.2 (DEC-070 改訂): `/chrome` の action を `toggle_chrome_mode` に変更。
/// v1.24.0 では `passthrough_to_sdk` で SDK に流す設計だったが、`/chrome` は
/// CLI interactive mode 専用 built-in で SDK 経由では未対応 (Claude が
/// "isn't available in this environment" を返す) と判明したため、Sumi 側で
/// intercept する経路に修正。
#[tauri::command]
pub fn list_builtin_slashes() -> Vec<BuiltinSlash> {
    vec![
        BuiltinSlash {
            name: "/mcp".to_string(),
            description: "MCP サーバ設定（Global / Project）を編集".to_string(),
            action: "open_mcp_settings".to_string(),
        },
        BuiltinSlash {
            name: "/clear".to_string(),
            description: "現在のチャットセッションを消去".to_string(),
            action: "clear_session".to_string(),
        },
        BuiltinSlash {
            name: "/model".to_string(),
            description: "使用するモデル（Opus / Sonnet / Haiku）を切替".to_string(),
            action: "open_model_picker".to_string(),
        },
        BuiltinSlash {
            name: "/init".to_string(),
            description: "現在のワークスペースに CLAUDE.md 雛形を生成".to_string(),
            action: "init_claude_md".to_string(),
        },
        BuiltinSlash {
            name: "/help".to_string(),
            description: "組込コマンド一覧と使い方を表示".to_string(),
            action: "open_help".to_string(),
        },
        BuiltinSlash {
            name: "/compact".to_string(),
            description: "会話履歴を圧縮（M3 Could、v4 で対応予定）".to_string(),
            action: "compact_pending".to_string(),
        },
        BuiltinSlash {
            name: "/config".to_string(),
            description: "アプリ設定画面を開く".to_string(),
            action: "open_config".to_string(),
        },
        // PRJ-012 v1.24.2 (DEC-070 改訂): Claude Code 公式の Chrome ブラウザ操作。
        // v1.24.0 では `passthrough_to_sdk` で SDK に直接流す設計だったが、
        // `/chrome` は CLI interactive mode 専用 built-in のため SDK 経由では
        // 「isn't available in this environment」エラーになることが判明。
        // v1.24.2 から Sumi 側で intercept し、session の chromeEnabled を
        // toggle + sidecar 再起動する `toggle_chrome_mode` action に変更。
        BuiltinSlash {
            name: "/chrome".to_string(),
            description: "Chrome モードを切替（次の送信で --chrome 反映）".to_string(),
            action: "toggle_chrome_mode".to_string(),
        },
    ]
}

// ---------------------------------------------------------------------------
// /init: CLAUDE.md 雛形生成
// ---------------------------------------------------------------------------

/// `workspace_root/CLAUDE.md` 雛形を生成する。
///
/// - 既存ファイルがあれば `Err("CLAUDE.md は既に存在します: ...")` で弾く（上書き防止）。
/// - workspace_root が存在しない / ディレクトリでない場合も `Err`。
/// - 雛形にはプロジェクト名（basename）を埋め込み、4 セクションの空欄を用意する。
///
/// 戻り値は生成した CLAUDE.md の絶対パス（toast に出して open しやすくする）。
#[tauri::command]
pub fn builtin_init_claude_md(workspace_root: String) -> Result<String, String> {
    let root = PathBuf::from(&workspace_root);
    if !root.exists() {
        return Err(format!(
            "ワークスペースが存在しません: {}",
            root.display()
        ));
    }
    if !root.is_dir() {
        return Err(format!(
            "ワークスペースがディレクトリではありません: {}",
            root.display()
        ));
    }

    let target = root.join("CLAUDE.md");
    if target.exists() {
        return Err(format!(
            "CLAUDE.md は既に存在します: {}",
            target.display()
        ));
    }

    let project_name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("プロジェクト")
        .to_string();

    let template = render_claude_md_template(&project_name);
    std::fs::write(&target, template)
        .map_err(|e| format!("CLAUDE.md の書き込みに失敗: {e}"))?;

    Ok(target.display().to_string())
}

/// CLAUDE.md 雛形本文（プロジェクト名以外は固定）。
///
/// プロジェクト概要 / 技術スタック / 開発ルール / 関連ドキュメントの
/// 汎用 4 セクション構成。Claude Code の hierarchical memory ルールに従い、
/// 素人でも追記しやすいように日本語コメントなしで簡潔に保つ。
fn render_claude_md_template(project_name: &str) -> String {
    format!(
        "# {project_name}\n\n## プロジェクト概要\n\n## 技術スタック\n\n## 開発ルール\n\n## 関連ドキュメント\n"
    )
}

// ---------------------------------------------------------------------------
// /mcp: MCP サーバ設定の読書
// ---------------------------------------------------------------------------

/// MCP 設定を読み出す。
///
/// - `scope = "global"`: `~/.claude.json` 全体から `"mcpServers"` キーのみを返す。
///   ファイル / キーが無ければ `{}` を返す（初回起動向け）。
/// - `scope = "project"`: `workspace_root/.mcp.json` 全体を返す。
///   ファイルが無ければ `{}`、`workspace_root` が None なら `Err`。
#[tauri::command]
pub fn read_mcp_config(
    scope: String,
    workspace_root: Option<String>,
) -> Result<Value, String> {
    match scope.as_str() {
        "global" => read_global_mcp_servers(),
        "project" => {
            let root = workspace_root.ok_or_else(|| {
                "Project スコープには workspace_root が必要です".to_string()
            })?;
            read_project_mcp(Path::new(&root))
        }
        other => Err(format!("未知の scope: {other}")),
    }
}

/// MCP 設定を書き出す。
///
/// - `scope = "global"`: `~/.claude.json` の `"mcpServers"` キーだけを差し替え、
///   他のキー（`projects`, `userId` 等）は触らない。ファイルが無ければ新規作成。
/// - `scope = "project"`: `workspace_root/.mcp.json` をそのまま上書き。
///
/// `config` には JSON Object を渡す。Object でない場合は `Err`。
#[tauri::command]
pub fn write_mcp_config(
    scope: String,
    workspace_root: Option<String>,
    config: Value,
) -> Result<(), String> {
    if !config.is_object() {
        return Err(
            "config は JSON Object でなければなりません（{ ... } 形式）".to_string(),
        );
    }
    match scope.as_str() {
        "global" => write_global_mcp_servers(config),
        "project" => {
            let root = workspace_root.ok_or_else(|| {
                "Project スコープには workspace_root が必要です".to_string()
            })?;
            write_project_mcp(Path::new(&root), config)
        }
        other => Err(format!("未知の scope: {other}")),
    }
}

/// `~/.claude.json` のフルパスを返す。HOME 解決失敗は Err。
fn global_claude_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "ホームディレクトリ解決失敗".to_string())?;
    Ok(home.join(".claude.json"))
}

fn read_global_mcp_servers() -> Result<Value, String> {
    let path = global_claude_json_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("~/.claude.json 読み込み失敗: {e}"))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("~/.claude.json は JSON として不正: {e}"))?;
    let servers = parsed
        .get("mcpServers")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(servers)
}

fn write_global_mcp_servers(servers: Value) -> Result<(), String> {
    let path = global_claude_json_path()?;
    // 既存 ~/.claude.json を尊重して merge。無ければ新規作成。
    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("~/.claude.json 読み込み失敗: {e}"))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("~/.claude.json は JSON として不正: {e}"))?
    } else {
        serde_json::json!({})
    };
    if !root.is_object() {
        return Err(
            "~/.claude.json のトップが JSON Object ではありません（手動編集が必要）"
                .to_string(),
        );
    }
    root.as_object_mut()
        .expect("checked is_object above")
        .insert("mcpServers".to_string(), servers);
    let pretty = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("JSON 整形失敗: {e}"))?;
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("親ディレクトリ作成失敗: {e}"))?;
        }
    }
    std::fs::write(&path, pretty)
        .map_err(|e| format!("~/.claude.json 書き込み失敗: {e}"))?;
    Ok(())
}

fn project_mcp_path(root: &Path) -> PathBuf {
    root.join(".mcp.json")
}

fn read_project_mcp(root: &Path) -> Result<Value, String> {
    if !root.exists() {
        return Err(format!(
            "ワークスペースが存在しません: {}",
            root.display()
        ));
    }
    let path = project_mcp_path(root);
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!(".mcp.json 読み込み失敗: {e}"))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!(".mcp.json は JSON として不正: {e}"))?;
    Ok(parsed)
}

fn write_project_mcp(root: &Path, config: Value) -> Result<(), String> {
    if !root.exists() {
        return Err(format!(
            "ワークスペースが存在しません: {}",
            root.display()
        ));
    }
    let path = project_mcp_path(root);
    let pretty = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("JSON 整形失敗: {e}"))?;
    std::fs::write(&path, pretty)
        .map_err(|e| format!(".mcp.json 書き込み失敗: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn list_builtin_slashes_returns_eight_items() {
        let v = list_builtin_slashes();
        assert_eq!(v.len(), 8, "組込 8 件を返すこと（DEC-070 で /chrome 追加）");
        let names: Vec<&str> = v.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"/mcp"));
        assert!(names.contains(&"/clear"));
        assert!(names.contains(&"/model"));
        assert!(names.contains(&"/init"));
        assert!(names.contains(&"/help"));
        assert!(names.contains(&"/compact"));
        assert!(names.contains(&"/config"));
        assert!(names.contains(&"/chrome"), "DEC-070 v1.24.0: /chrome");
        // /chrome は frontend で intercept せず passthrough する目印
        let chrome = v.iter().find(|s| s.name == "/chrome").unwrap();
        assert_eq!(chrome.action, "toggle_chrome_mode");
    }

    #[test]
    fn render_claude_md_template_contains_project_name_and_sections() {
        let s = render_claude_md_template("MyApp");
        assert!(s.starts_with("# MyApp\n"), "1 行目が見出し");
        assert!(s.contains("## プロジェクト概要"));
        assert!(s.contains("## 技術スタック"));
        assert!(s.contains("## 開発ルール"));
        assert!(s.contains("## 関連ドキュメント"));
    }

    #[test]
    fn builtin_init_claude_md_creates_file_and_blocks_overwrite() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();

        // 1 回目: 成功
        let out = builtin_init_claude_md(root.clone()).unwrap();
        assert!(out.ends_with("CLAUDE.md"));
        let body = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(body.contains("## プロジェクト概要"));

        // 2 回目: 既存ファイルを上書きしないこと
        let err = builtin_init_claude_md(root).unwrap_err();
        assert!(err.contains("既に存在"), "上書き防止エラー文言: {err}");
    }

    #[test]
    fn builtin_init_claude_md_errors_when_workspace_missing() {
        let err = builtin_init_claude_md("/no/such/dir/__ccmux_ide__".to_string()).unwrap_err();
        assert!(err.contains("存在しません") || err.contains("not found"));
    }

    #[test]
    fn project_mcp_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // 初回 read は空オブジェクト
        let initial = read_project_mcp(root).unwrap();
        assert!(initial.is_object());
        assert_eq!(initial.as_object().unwrap().len(), 0);

        // write して read
        let cfg = serde_json::json!({
            "mcpServers": {
                "test-server": {
                    "command": "node",
                    "args": ["server.js"]
                }
            }
        });
        write_project_mcp(root, cfg.clone()).unwrap();
        let got = read_project_mcp(root).unwrap();
        assert_eq!(got, cfg);

        // ファイルが pretty-print されているか軽く確認
        let raw = std::fs::read_to_string(root.join(".mcp.json")).unwrap();
        assert!(raw.contains("\n"), "pretty-print されているはず");
    }

    #[test]
    fn write_mcp_config_rejects_non_object() {
        let tmp = TempDir::new().unwrap();
        let err = write_mcp_config(
            "project".to_string(),
            Some(tmp.path().to_string_lossy().to_string()),
            serde_json::json!([1, 2, 3]),
        )
        .unwrap_err();
        assert!(err.contains("Object"));
    }

    #[test]
    fn read_mcp_config_rejects_unknown_scope() {
        let err = read_mcp_config("workspace".to_string(), None).unwrap_err();
        assert!(err.contains("未知の scope"));
    }

    #[test]
    fn read_mcp_config_project_requires_workspace_root() {
        let err = read_mcp_config("project".to_string(), None).unwrap_err();
        assert!(err.contains("workspace_root"));
    }
}
