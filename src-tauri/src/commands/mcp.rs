//! MCP server discovery — PM-955 (v1.4 MVP / Phase 1)。
//!
//! Claude Code の MCP (Model Context Protocol) 機能に対応する discovery 実装。
//! Cursor 上の Claude Code と同等の MCP ecosystem (github / playwright / supabase /
//! vercel / pencil / stitch / aidesigner / Gmail 等) を ccmux-ide-gui の
//! SlashPalette 上で可視化することを目標にする。Phase 1 は **disk scan による
//! 一覧表示** のみ。実行・接続管理は Claude Agent SDK (`query.mcpServerStatus()` /
//! `setMcpServers()` / `toggleMcpServer()`) に委譲する（Phase 2 で sidecar 経由の
//! 接続状態 live 表示、Phase 3 で toggle UI 追加）。
//!
//! ## MCP の on-disk 表現（公式仕様まとめ）
//!
//! Claude Code が参照する MCP 設定は **4 つの系統** に分かれる:
//!
//! ```text
//! 1. User-level global (設定画面 Global タブ): ~/.claude/settings.json の `mcpServers`
//!    - 全プロジェクト横断で常に有効
//!    - 例: `{ "stitch": { "command": "cmd", "args": [...] } }`
//!
//! 2. User-level per-project (UI 非公開、~/.claude.json が保持): ~/.claude.json の
//!    `projects["<abs-path>"].mcpServers`
//!    - Claude Code CLI が project trust dialog 承認後に記録する per-project 設定
//!    - 同じファイル内に `disabledMcpServers: ["plugin:vercel:vercel", ...]` があり、
//!      plugin 由来 / .mcp.json 由来を項目単位で無効化できる
//!
//! 3. Project-level local (設定画面 Project タブ): <project>/.mcp.json の `mcpServers`
//!    - git commit 可能、チームで共有する想定
//!    - `enabledMcpjsonServers: [...] / disabledMcpjsonServers: [...]` (~/.claude.json
//!      per-project) で opt-in / opt-out
//!
//! 4. Plugin-bundled: ~/.claude/plugins/cache/<marketplace>/<name>/<version>/.mcp.json
//!    - `enabledPlugins["<name>@<marketplace>"]` (~/.claude/settings.json) で enable 制御
//!    - 更に `disabledMcpServers: ["plugin:<plugin-name>:<server-name>"]` で server 単位に off
//! ```
//!
//! ## 設定 format (全スコープ共通)
//!
//! ```json
//! {
//!   "mcpServers": {
//!     "<server-name>": {
//!       "command": "node",            // stdio transport
//!       "args": ["server.js"],
//!       "env": { "KEY": "VALUE" }
//!     },
//!     "<server-name2>": {
//!       "type": "http",                // or "sse"
//!       "url": "https://mcp.vercel.com"
//!     }
//!   }
//! }
//! ```
//!
//! ## Agent SDK サポート (0.2.x)
//!
//! `@anthropic-ai/claude-agent-sdk/sdk.d.ts` では:
//!   - `Options.mcpServers?: AgentMcpServerSpec[]` で `query()` 起動時に渡せる
//!   - `query.mcpServerStatus(): Promise<McpServerStatus[]>` で接続状態取得
//!     (`{ status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled',
//!        tools: [{ name, description }...] }`)
//!   - `query.toggleMcpServer(name, enabled)` / `reconnectMcpServer(name)` /
//!     `setMcpServers(record)` で dynamic に操作可能
//!
//! ccmux-ide-gui Phase 1 は SDK の自動 load を信頼し、disk 上の定義を **並行して
//! 走査・可視化** するだけに留める (plugins.rs / skills.rs と同じポリシー)。
//!
//! ## Phase 1 スコープ（本 module）
//!
//! - `list_mcp_servers(project_path)` command: 全スコープを統合した `McpServerDef[]` を返す
//! - 各 server の transport 種別 (stdio / sse / http) を判別
//! - disable 状態 (`disabledMcpServers` / `disabledMcpjsonServers` / plugin 無効) を反映
//! - 同名 server は cwd > project > global の override 規則 (slash / skill と同じ)
//!
//! ## Phase 2+ 申し送り (v1.5+)
//!
//! - sidecar 側 `mcpServerStatus()` 呼出、`{status, tools}` を event で frontend に push
//! - tool 総数 / 内訳の live 表示 (StatusBar or MCP Palette detail)
//! - UI で enable/disable toggle → Rust command → `~/.claude.json`
//!   (`disabledMcpServers` / `disabledMcpjsonServers`) or `~/.claude/settings.json`
//!   `enabledPlugins` を rewrite
//! - Add / Remove Server UI (stdio command / sse url / http url + env 編集)

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// フロントエンドへ返す MCP server 1 件。
///
/// plugins.rs `PluginDef` / skills.rs `SkillDef` と並行定義。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDef {
    /// server 名（map key。例: `github` / `vercel` / `stitch`）。
    pub name: String,
    /// 由来スコープ。
    /// - `"global"`   : `~/.claude/settings.json` の `mcpServers`
    /// - `"user"`     : `~/.claude.json` 直下の `mcpServers` (全 project 共通)
    /// - `"project"`  : `<project>/.mcp.json` の `mcpServers`
    /// - `"user-project"`: `~/.claude.json` の `projects["<abs>"].mcpServers`
    /// - `"plugin"`   : `<plugin-install-path>/.mcp.json` の `mcpServers`
    pub scope: String,
    /// transport 種別（"stdio" / "sse" / "http" / "unknown"）。
    /// `type` field が無く `command` がある場合は stdio 扱い。
    pub transport: String,
    /// stdio の実行コマンド（`command` field）。stdio 以外では None。
    pub command: Option<String>,
    /// stdio の引数（`args` field）。stdio 以外では空配列。
    pub args: Vec<String>,
    /// sse / http の endpoint URL（`url` field）。stdio では None。
    pub url: Option<String>,
    /// plugin 由来の場合、plugin ID (`<name>@<marketplace>`)。それ以外 None。
    pub plugin_id: Option<String>,
    /// 設定ファイルの絶対パス（Monaco preview 用）。
    pub config_path: String,
    /// 有効無効。以下のいずれかで false になる:
    /// - `~/.claude.json` の project entry で `disabledMcpServers` に含まれる
    /// - `~/.claude.json` の `disabledMcpjsonServers` に含まれる (project 所属 .mcp.json 由来のみ)
    /// - plugin 由来 かつ `enabledPlugins["<plugin-id>"] === false`
    pub enabled: bool,
    /// env key 一覧（値は返さない。secret 露出防止）。UI のデバッグ情報用。
    pub env_keys: Vec<String>,
}

/// Tauri command: 全スコープを走査して MCP server 一覧を返す。
///
/// 走査失敗（ファイル不在 / JSON 不正）は致命的ではなく、該当スコープを空扱いして
/// 他スコープは継続 load する (plugins.rs / skills.rs と同じ fail-open 方針)。
#[tauri::command]
pub fn list_mcp_servers(project_path: Option<String>) -> Result<Vec<McpServerDef>, String> {
    let project = project_path.as_deref().map(Path::new);
    Ok(scan_all(project))
}

/// 全スコープを走査して重複を解決した `Vec<McpServerDef>` を返す。
///
/// スコープ優先度 (後勝ち): global < user < plugin < user-project < project
/// 同名 server は近いスコープで override される。
fn scan_all(project_root: Option<&Path>) -> Vec<McpServerDef> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    // 各種 disable リストを project_root 基準で先に取得（~/.claude.json 走査 1 回で集約）。
    let project_meta = read_project_meta(&home.join(".claude.json"), project_root);

    // スコープ別に `(name, McpServerDef)` を accumulate（BTreeMap で名前順安定化）。
    let mut map: BTreeMap<String, McpServerDef> = BTreeMap::new();

    // 1) Global: ~/.claude/settings.json の mcpServers
    //    settings.json は `{ mcpServers: {...}, permissions: {...}, ... }` 構造で
    //    top-level に mcpServers 以外のキー（permissions / language / enabledPlugins 等）
    //    を多数持つため、top-level fallback は **禁止**（allow_fallback=false）。
    let global_path = home.join(".claude").join("settings.json");
    for s in scan_settings_json(&global_path, "global", false) {
        map.insert(s.name.clone(), s);
    }

    // 2) User (top-level): ~/.claude.json 直下の mcpServers
    let user_path = home.join(".claude.json");
    for s in scan_claude_json_top_level(&user_path) {
        map.insert(s.name.clone(), s);
    }

    // 3) Plugin-bundled: enabled plugin の .mcp.json
    let enabled_plugins = load_enabled_plugins_map(&home.join(".claude").join("settings.json"));
    let installed_index = home
        .join(".claude")
        .join("plugins")
        .join("installed_plugins.json");
    for s in scan_plugin_mcp(&installed_index, &enabled_plugins, &project_meta.disabled_servers) {
        map.insert(s.name.clone(), s);
    }

    // 4) User-project: ~/.claude.json の projects[abs].mcpServers
    if let Some(root) = project_root {
        for s in scan_user_project_mcp(&user_path, root) {
            // disabledMcpServers 反映（~/.claude.json の project entry）
            let mut patched = s;
            if project_meta.disabled_servers.contains(&patched.name) {
                patched.enabled = false;
            }
            map.insert(patched.name.clone(), patched);
        }
    }

    // 5) Project-local: <project>/.mcp.json の mcpServers
    //    .mcp.json は公式 format が `{ mcpServers: {...} }` だが、ユーザーが
    //    手書きで `{ "serverName": {...}, ... }` と直接書いてしまうケースも
    //    散見される（特に Claude Code 0.x 時代の古い example）。互換性のため
    //    top-level fallback を許可（allow_fallback=true）。
    if let Some(root) = project_root {
        let project_mcp_path = root.join(".mcp.json");
        for s in scan_settings_json(&project_mcp_path, "project", true) {
            let mut patched = s;
            // disabledMcpjsonServers に含まれるなら disabled (.mcp.json 由来のみ適用)
            if project_meta.disabled_mcpjson.contains(&patched.name) {
                patched.enabled = false;
            }
            map.insert(patched.name.clone(), patched);
        }
    }

    // 並び順: enabled 優先 → scope rank → name 昇順
    let mut out: Vec<McpServerDef> = map.into_values().collect();
    out.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| scope_rank(&a.scope).cmp(&scope_rank(&b.scope)))
            .then_with(|| a.name.cmp(&b.name))
    });
    out
}

/// ~/.claude.json の project entry から disable 系リストを集約した構造体。
#[derive(Debug, Default)]
struct ProjectMeta {
    /// `disabledMcpServers`: 対象 project で個別に無効化された server 名 or
    /// `plugin:<plugin-name>:<server-name>` 形式の plugin server 識別子。
    disabled_servers: HashSet<String>,
    /// `disabledMcpjsonServers`: 対象 project で `<project>/.mcp.json` 由来の
    /// server を opt-out する名前一覧。
    disabled_mcpjson: HashSet<String>,
}

fn read_project_meta(claude_json_path: &Path, project_root: Option<&Path>) -> ProjectMeta {
    let Some(root) = project_root else {
        return ProjectMeta::default();
    };
    let Ok(text) = std::fs::read_to_string(claude_json_path) else {
        return ProjectMeta::default();
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&text) else {
        return ProjectMeta::default();
    };

    // ~/.claude.json の projects key には path を forward slash / backslash の両方で
    // 格納されうる (Windows は `C:\\...\\`, WSL は `/...`)。ここでは両方で lookup。
    let lookup_keys = normalize_project_lookup_keys(root);
    let mut meta = ProjectMeta::default();
    let Some(projects) = json.get("projects").and_then(Value::as_object) else {
        return meta;
    };

    let mut entry: Option<&Value> = None;
    for key in &lookup_keys {
        if let Some(v) = projects.get(key) {
            entry = Some(v);
            break;
        }
    }
    let Some(entry) = entry else {
        return meta;
    };

    if let Some(arr) = entry.get("disabledMcpServers").and_then(Value::as_array) {
        for v in arr {
            if let Some(s) = v.as_str() {
                meta.disabled_servers.insert(s.to_string());
            }
        }
    }
    if let Some(arr) = entry.get("disabledMcpjsonServers").and_then(Value::as_array) {
        for v in arr {
            if let Some(s) = v.as_str() {
                meta.disabled_mcpjson.insert(s.to_string());
            }
        }
    }
    meta
}

/// project_root の絶対パスを ~/.claude.json の projects key として lookup するときの
/// 文字列候補を返す。Windows (backslash + forward slash) / Unix (forward slash) の差を吸収。
fn normalize_project_lookup_keys(root: &Path) -> Vec<String> {
    let canonical = root.to_string_lossy().into_owned();
    let mut out = vec![canonical.clone()];
    if canonical.contains('\\') {
        out.push(canonical.replace('\\', "/"));
    }
    if canonical.contains('/') {
        out.push(canonical.replace('/', "\\"));
    }
    out
}

/// `~/.claude/settings.json` or `<project>/.mcp.json` のような **直接 mcpServers
/// を持つ JSON ファイル**を走査する。
///
/// `allow_top_level_fallback`:
///   - `true`  : `{ "mcpServers": {...} }` が無ければ top-level を mcpServers と
///               みなす。手書き `.mcp.json` の互換性のため project スコープで有効化。
///   - `false` : `{ "mcpServers": {...} }` のキーが無ければ空を返す。settings.json
///               のように `permissions` / `enabledPlugins` 等の top-level 他キーを
///               mcpServers と誤認しないためにこちらを使う。
fn scan_settings_json(
    path: &Path,
    scope: &str,
    allow_top_level_fallback: bool,
) -> Vec<McpServerDef> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&text) else {
        eprintln!("[mcp] invalid JSON: {}", path.display());
        return Vec::new();
    };
    let mcp_section = match json.get("mcpServers") {
        Some(v) => v.clone(),
        None if allow_top_level_fallback => json.clone(),
        None => return Vec::new(),
    };
    parse_mcp_section(&mcp_section, scope, path, None)
}

/// `~/.claude.json` の **top-level** `mcpServers` キー (全 project 共通の user
/// scope) を走査する。per-project の `projects["<abs>"].mcpServers` は別関数で扱う。
fn scan_claude_json_top_level(path: &Path) -> Vec<McpServerDef> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&text) else {
        return Vec::new();
    };
    let Some(mcp) = json.get("mcpServers") else {
        return Vec::new();
    };
    parse_mcp_section(mcp, "user", path, None)
}

/// `~/.claude.json` の `projects["<abs-path>"].mcpServers` を走査する。
fn scan_user_project_mcp(path: &Path, project_root: &Path) -> Vec<McpServerDef> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&text) else {
        return Vec::new();
    };
    let Some(projects) = json.get("projects").and_then(Value::as_object) else {
        return Vec::new();
    };
    let lookup_keys = normalize_project_lookup_keys(project_root);
    let mut entry: Option<&Value> = None;
    for key in &lookup_keys {
        if let Some(v) = projects.get(key) {
            entry = Some(v);
            break;
        }
    }
    let Some(entry) = entry else {
        return Vec::new();
    };
    let Some(mcp) = entry.get("mcpServers") else {
        return Vec::new();
    };
    parse_mcp_section(mcp, "user-project", path, None)
}

/// plugin 由来の `.mcp.json` を全 installed plugin 分走査する。
fn scan_plugin_mcp(
    installed_index_path: &Path,
    enabled_plugins: &std::collections::HashMap<String, bool>,
    disabled_servers_from_project: &HashSet<String>,
) -> Vec<McpServerDef> {
    let Ok(text) = std::fs::read_to_string(installed_index_path) else {
        return Vec::new();
    };
    let Ok(index): Result<Value, _> = serde_json::from_str(&text) else {
        return Vec::new();
    };
    let Some(plugins_obj) = index.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut out: Vec<McpServerDef> = Vec::new();
    for (plugin_id, entries) in plugins_obj {
        let Some(entry) = entries.as_array().and_then(|a| a.first()) else {
            continue;
        };
        let Some(install_path_str) = entry.get("installPath").and_then(Value::as_str) else {
            continue;
        };
        let install_path = PathBuf::from(install_path_str);
        let mcp_json = install_path.join(".mcp.json");
        if !mcp_json.is_file() {
            continue;
        }

        let plugin_enabled = enabled_plugins.get(plugin_id).copied().unwrap_or(true);
        // plugin の short name (ID の `@` 以前) を `plugin:<short>:<server>` 形式の
        // disable 識別子照合に使う。例: `plugin:vercel:vercel` のような形で
        // ~/.claude.json の disabledMcpServers に入る。
        let plugin_short = plugin_id.split('@').next().unwrap_or(plugin_id).to_string();

        let Ok(body) = std::fs::read_to_string(&mcp_json) else {
            continue;
        };
        let Ok(body_json): Result<Value, _> = serde_json::from_str(&body) else {
            eprintln!("[mcp] plugin invalid JSON: {}", mcp_json.display());
            continue;
        };
        // plugin 由来の `.mcp.json` は公式仕様で `{ mcpServers: { ... } }` 形式。
        let Some(mcp_section) = body_json.get("mcpServers") else {
            continue;
        };
        let mut defs = parse_mcp_section(mcp_section, "plugin", &mcp_json, Some(plugin_id));
        for d in &mut defs {
            // plugin 無効 → 全 server 無効
            if !plugin_enabled {
                d.enabled = false;
            }
            // project entry の disabledMcpServers に `plugin:<short>:<name>` があれば無効
            let marker = format!("plugin:{}:{}", plugin_short, d.name);
            if disabled_servers_from_project.contains(&marker) {
                d.enabled = false;
            }
        }
        out.extend(defs);
    }
    out
}

/// 1 つの `mcpServers` JSON セクション (Object of name → config) を `McpServerDef[]`
/// に変換する共通関数。
fn parse_mcp_section(
    section: &Value,
    scope: &str,
    config_path: &Path,
    plugin_id: Option<&str>,
) -> Vec<McpServerDef> {
    let Some(obj) = section.as_object() else {
        return Vec::new();
    };
    let mut out: Vec<McpServerDef> = Vec::with_capacity(obj.len());
    for (name, cfg) in obj {
        let (transport, command, args, url) = classify_server(cfg);
        let env_keys = cfg
            .get("env")
            .and_then(Value::as_object)
            .map(|e| e.keys().cloned().collect::<Vec<String>>())
            .unwrap_or_default();
        out.push(McpServerDef {
            name: name.clone(),
            scope: scope.to_string(),
            transport,
            command,
            args,
            url,
            plugin_id: plugin_id.map(str::to_string),
            config_path: config_path.to_string_lossy().into_owned(),
            enabled: true,
            env_keys,
        });
    }
    out
}

/// server 1 件の config JSON を transport 種別と代表 field に分解する。
///
/// 優先度:
///   1. `type: "http"`  → transport=http, url 採用
///   2. `type: "sse"`   → transport=sse,  url 採用
///   3. `command` あり  → transport=stdio, command/args 採用
///   4. それ以外         → transport=unknown
fn classify_server(cfg: &Value) -> (String, Option<String>, Vec<String>, Option<String>) {
    let type_str = cfg.get("type").and_then(Value::as_str);
    match type_str {
        Some("http") => {
            let url = cfg.get("url").and_then(Value::as_str).map(str::to_string);
            ("http".to_string(), None, Vec::new(), url)
        }
        Some("sse") => {
            let url = cfg.get("url").and_then(Value::as_str).map(str::to_string);
            ("sse".to_string(), None, Vec::new(), url)
        }
        _ => {
            if let Some(command) = cfg.get("command").and_then(Value::as_str) {
                let args = cfg
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                ("stdio".to_string(), Some(command.to_string()), args, None)
            } else {
                ("unknown".to_string(), None, Vec::new(), None)
            }
        }
    }
}

/// `~/.claude/settings.json` の `enabledPlugins` を読む（plugins.rs と同じロジック）。
fn load_enabled_plugins_map(settings_path: &Path) -> std::collections::HashMap<String, bool> {
    let mut map = std::collections::HashMap::new();
    let Ok(text) = std::fs::read_to_string(settings_path) else {
        return map;
    };
    let Ok(json): Result<Value, _> = serde_json::from_str(&text) else {
        return map;
    };
    let Some(obj) = json.get("enabledPlugins").and_then(Value::as_object) else {
        return map;
    };
    for (k, v) in obj {
        if let Some(b) = v.as_bool() {
            map.insert(k.clone(), b);
        }
    }
    map
}

/// UI 並び替え用の scope rank（若い = 上に表示）。
///
/// project > user-project > plugin > user > global > その他
/// slash / skill の `cwd > project > global` と方向性を揃える。
fn scope_rank(scope: &str) -> u8 {
    match scope {
        "project" => 0,
        "user-project" => 1,
        "plugin" => 2,
        "user" => 3,
        "global" => 4,
        _ => 99,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::tempdir;

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn classify_server_detects_stdio_http_sse_unknown() {
        let stdio = serde_json::json!({ "command": "node", "args": ["a.js"] });
        let (t, c, a, u) = classify_server(&stdio);
        assert_eq!(t, "stdio");
        assert_eq!(c.as_deref(), Some("node"));
        assert_eq!(a, vec!["a.js"]);
        assert!(u.is_none());

        let http = serde_json::json!({ "type": "http", "url": "https://x.example" });
        let (t, c, a, u) = classify_server(&http);
        assert_eq!(t, "http");
        assert!(c.is_none());
        assert!(a.is_empty());
        assert_eq!(u.as_deref(), Some("https://x.example"));

        let sse = serde_json::json!({ "type": "sse", "url": "https://sse.example" });
        assert_eq!(classify_server(&sse).0, "sse");

        let unknown = serde_json::json!({});
        assert_eq!(classify_server(&unknown).0, "unknown");
    }

    #[test]
    fn parse_mcp_section_returns_env_keys_but_not_values() {
        let section = serde_json::json!({
            "stitch": {
                "command": "cmd",
                "args": ["/c", "npx", "stitch-mcp"],
                "env": { "STITCH_API_KEY": "secret", "OTHER": "v" }
            }
        });
        let path = PathBuf::from("/fake/settings.json");
        let list = parse_mcp_section(&section, "global", &path, None);
        assert_eq!(list.len(), 1);
        let s = &list[0];
        assert_eq!(s.name, "stitch");
        assert_eq!(s.scope, "global");
        assert_eq!(s.transport, "stdio");
        assert_eq!(s.command.as_deref(), Some("cmd"));
        assert_eq!(s.env_keys.len(), 2);
        // secret 値自体は含まれない
        for k in &s.env_keys {
            assert!(k == "STITCH_API_KEY" || k == "OTHER");
        }
    }

    #[test]
    fn scan_settings_json_reads_nested_format() {
        let dir = tempdir().unwrap();
        // `{ mcpServers: { ... } }` は fallback 無しでも読める
        let nested = dir.path().join("nested.json");
        write_file(
            &nested,
            r#"{ "mcpServers": { "foo": { "command": "node" } } }"#,
        );
        let a = scan_settings_json(&nested, "project", false);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].name, "foo");
        assert_eq!(a[0].scope, "project");
    }

    #[test]
    fn scan_settings_json_fallback_only_with_flag() {
        let dir = tempdir().unwrap();
        // `{ "bar": {...} }` のように mcpServers キー無しで直接 server を並べた
        // 古い style の .mcp.json は allow_top_level_fallback=true のときだけ拾う
        let direct = dir.path().join("direct.json");
        write_file(
            &direct,
            r#"{ "bar": { "type": "http", "url": "https://x" } }"#,
        );

        let without_fallback = scan_settings_json(&direct, "global", false);
        assert!(
            without_fallback.is_empty(),
            "settings.json の他 top-level key を誤認しないこと"
        );

        let with_fallback = scan_settings_json(&direct, "project", true);
        assert_eq!(with_fallback.len(), 1);
        assert_eq!(with_fallback[0].name, "bar");
        assert_eq!(with_fallback[0].transport, "http");
    }

    #[test]
    fn scan_settings_json_ignores_non_mcp_keys_without_fallback() {
        // 実 ~/.claude/settings.json を模した mock（`permissions` / `enabledPlugins` /
        // `language` 等の top-level キーを mcpServers と誤認しないこと）
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write_file(
            &path,
            r#"{
                "permissions": { "allow": ["mcp__pencil"] },
                "enabledPlugins": { "vercel@offl": true },
                "language": "日本語",
                "alwaysThinkingEnabled": true
            }"#,
        );
        let out = scan_settings_json(&path, "global", false);
        assert!(out.is_empty(), "非 mcpServers キーを拾わないこと: {:?}", out);
    }

    #[test]
    fn scan_claude_json_top_level_picks_user_scope() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        write_file(
            &path,
            r#"{
                "mcpServers": { "top": { "command": "node" } },
                "projects": { "/foo": { "mcpServers": { "proj": { "command": "node" } } } }
            }"#,
        );
        let out = scan_claude_json_top_level(&path);
        // top-level だけを拾い、projects 側は拾わないこと
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "top");
        assert_eq!(out[0].scope, "user");
    }

    #[test]
    fn scan_user_project_mcp_looks_up_project_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        let project_root = dir.path().join("ws");
        fs::create_dir_all(&project_root).unwrap();
        // Windows / Unix 両方の key 表記に備えて forward slash で register
        let key = project_root.to_string_lossy().replace('\\', "/");
        write_file(
            &path,
            &format!(
                r#"{{
                    "projects": {{
                        "{key}": {{
                            "mcpServers": {{ "vercel": {{ "type": "http", "url": "https://mcp.vercel.com" }} }}
                        }}
                    }}
                }}"#,
                key = key
            ),
        );
        let out = scan_user_project_mcp(&path, &project_root);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "vercel");
        assert_eq!(out[0].scope, "user-project");
        assert_eq!(out[0].transport, "http");
    }

    #[test]
    fn read_project_meta_returns_disable_sets() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        let project_root = dir.path().join("ws");
        fs::create_dir_all(&project_root).unwrap();
        let key = project_root.to_string_lossy().replace('\\', "/");
        write_file(
            &path,
            &format!(
                r#"{{
                    "projects": {{
                        "{key}": {{
                            "disabledMcpServers": ["plugin:vercel:vercel", "foo"],
                            "disabledMcpjsonServers": ["bar"]
                        }}
                    }}
                }}"#,
                key = key
            ),
        );
        let meta = read_project_meta(&path, Some(&project_root));
        assert!(meta.disabled_servers.contains("plugin:vercel:vercel"));
        assert!(meta.disabled_servers.contains("foo"));
        assert!(meta.disabled_mcpjson.contains("bar"));
    }

    #[test]
    fn scan_plugin_mcp_respects_plugin_enabled_and_disabled_marker() {
        let dir = tempdir().unwrap();
        let home_plugins = dir.path().join(".claude").join("plugins");
        let plugin_install = home_plugins.join("cache").join("offl").join("vercel").join("0.1");
        let mcp = plugin_install.join(".mcp.json");
        write_file(
            &mcp,
            r#"{ "mcpServers": { "vercel": { "type": "http", "url": "https://mcp.vercel.com" } } }"#,
        );
        let installed_index = home_plugins.join("installed_plugins.json");
        write_file(
            &installed_index,
            &format!(
                r#"{{
                    "version": 2,
                    "plugins": {{
                        "vercel@offl": [ {{ "installPath": "{}", "version": "0.1" }} ]
                    }}
                }}"#,
                plugin_install.to_string_lossy().replace('\\', "/")
            ),
        );

        // Case 1: plugin enabled + no disable marker → enabled=true
        let mut enabled_map = std::collections::HashMap::new();
        enabled_map.insert("vercel@offl".to_string(), true);
        let out = scan_plugin_mcp(&installed_index, &enabled_map, &HashSet::new());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "vercel");
        assert_eq!(out[0].scope, "plugin");
        assert_eq!(out[0].plugin_id.as_deref(), Some("vercel@offl"));
        assert!(out[0].enabled);

        // Case 2: plugin disabled → enabled=false
        let mut enabled_map = std::collections::HashMap::new();
        enabled_map.insert("vercel@offl".to_string(), false);
        let out = scan_plugin_mcp(&installed_index, &enabled_map, &HashSet::new());
        assert!(!out[0].enabled);

        // Case 3: project disable marker → enabled=false
        let mut enabled_map = std::collections::HashMap::new();
        enabled_map.insert("vercel@offl".to_string(), true);
        let mut disable = HashSet::new();
        disable.insert("plugin:vercel:vercel".to_string());
        let out = scan_plugin_mcp(&installed_index, &enabled_map, &disable);
        assert!(!out[0].enabled);
    }

    /// 5 スコープの scan helper を個別に呼んで統合結果を検証する integration test。
    ///
    /// `scan_all()` 直呼びは `dirs::home_dir()` が Windows では `SHGetFolderPathW`
    /// 経由で resolve するため `HOME` env 書き換えでは override できない。テスト
    /// では一段下の helper (scan_settings_json / scan_claude_json_top_level /
    /// scan_user_project_mcp / scan_plugin_mcp) を直接呼ぶことで、実 HOME に
    /// 依存せず決定論的に検証する。
    #[test]
    fn all_scope_helpers_integrate_consistently() {
        let dir = tempdir().unwrap();
        let project_root = dir.path().join("workspace");
        fs::create_dir_all(&project_root).unwrap();

        // --- Global: ~/.claude/settings.json ---
        let global = dir.path().join("fake_claude_dir").join("settings.json");
        write_file(
            &global,
            r#"{
                "mcpServers": { "stitch": { "command": "cmd", "args": ["/c", "npx"] } },
                "enabledPlugins": { "vercel@offl": true }
            }"#,
        );
        let globals = scan_settings_json(&global, "global", false);
        assert_eq!(globals.len(), 1);
        assert_eq!(globals[0].name, "stitch");

        // --- User top-level + user-project (~/.claude.json) ---
        let claude_json = dir.path().join(".claude.json");
        let project_key = project_root.to_string_lossy().replace('\\', "/");
        write_file(
            &claude_json,
            &format!(
                r#"{{
                    "mcpServers": {{ "user-top": {{ "command": "node" }} }},
                    "projects": {{
                        "{key}": {{
                            "mcpServers": {{ "user-proj": {{ "type": "http", "url": "https://x" }} }},
                            "disabledMcpjsonServers": ["off-in-proj"],
                            "disabledMcpServers": ["plugin:vercel:vercel"]
                        }}
                    }}
                }}"#,
                key = project_key
            ),
        );
        let user_top = scan_claude_json_top_level(&claude_json);
        assert_eq!(user_top.len(), 1);
        assert_eq!(user_top[0].name, "user-top");
        assert_eq!(user_top[0].scope, "user");

        let user_proj = scan_user_project_mcp(&claude_json, &project_root);
        assert_eq!(user_proj.len(), 1);
        assert_eq!(user_proj[0].name, "user-proj");
        assert_eq!(user_proj[0].scope, "user-project");

        let meta = read_project_meta(&claude_json, Some(&project_root));
        assert!(meta.disabled_servers.contains("plugin:vercel:vercel"));
        assert!(meta.disabled_mcpjson.contains("off-in-proj"));

        // --- Plugin-bundled ---
        let plugin_install = dir.path().join("plugins").join("vercel");
        write_file(
            &plugin_install.join(".mcp.json"),
            r#"{ "mcpServers": { "vercel": { "type": "http", "url": "https://mcp.vercel.com" } } }"#,
        );
        let installed_index = dir.path().join("plugins").join("installed_plugins.json");
        write_file(
            &installed_index,
            &format!(
                r#"{{
                    "version": 2,
                    "plugins": {{
                        "vercel@offl": [ {{ "installPath": "{}", "version": "0.1" }} ]
                    }}
                }}"#,
                plugin_install.to_string_lossy().replace('\\', "/")
            ),
        );
        let mut enabled_map = std::collections::HashMap::new();
        enabled_map.insert("vercel@offl".to_string(), true);
        let plugins = scan_plugin_mcp(&installed_index, &enabled_map, &meta.disabled_servers);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].name, "vercel");
        assert_eq!(plugins[0].plugin_id.as_deref(), Some("vercel@offl"));
        // disabledMcpServers に `plugin:vercel:vercel` が含まれるので無効化される
        assert!(!plugins[0].enabled);

        // --- Project-local ---
        let project_mcp = project_root.join(".mcp.json");
        write_file(
            &project_mcp,
            r#"{ "mcpServers": {
                "proj-local": { "command": "node", "args": ["p.js"] },
                "off-in-proj": { "command": "node" }
            } }"#,
        );
        let project_local = scan_settings_json(&project_mcp, "project", true);
        assert_eq!(project_local.len(), 2);
        // 本 helper は disabledMcpjsonServers を反映しないので scan_all() 側でパッチ
        // する。ここでは全件 enabled=true の前提で件数だけ確認。
        assert!(project_local.iter().all(|s| s.enabled));
    }

    #[test]
    fn scope_rank_orders_project_first() {
        assert!(scope_rank("project") < scope_rank("user-project"));
        assert!(scope_rank("user-project") < scope_rank("plugin"));
        assert!(scope_rank("plugin") < scope_rank("user"));
        assert!(scope_rank("user") < scope_rank("global"));
        assert!(scope_rank("global") < scope_rank("unknown"));
    }

    #[test]
    fn list_mcp_servers_fails_open_on_missing_home() {
        // 引数 None + 実 HOME をそのまま使うケース（失敗しないこと）
        let _ = list_mcp_servers(None);
    }

    #[test]
    fn normalize_project_lookup_keys_includes_both_separators() {
        let p = PathBuf::from("C:/Users/x/ws");
        let keys = normalize_project_lookup_keys(&p);
        assert!(keys.iter().any(|k| k.contains('/')));
        assert!(keys.iter().any(|k| k.contains('\\')));
    }
}
