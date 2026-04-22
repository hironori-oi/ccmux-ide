//! Claude Code plugin discovery — PM-954 (v1.3 MVP / Phase 1)。
//!
//! Claude Code の公式 plugin 機能 (2026-01 公開、2026-04 時点で Agent SDK に
//! `SdkPluginConfig` / `SDKControlReloadPluginsRequest` / `enabledPlugins` が
//! 組み込み済) に対応する discovery 実装。ccmux-ide-gui は **独立にディスクを
//! 走査** して Palette に一覧表示する（Phase 1 = 可視化のみ、実行経路は
//! Agent SDK 側の自動 load に委譲）。
//!
//! ## Plugin の on-disk 表現（公式レイアウト）
//!
//! ```text
//! ~/.claude/plugins/
//!   installed_plugins.json                       # 全 installed plugin の index
//!   known_marketplaces.json                      # 登録済 marketplace 一覧
//!   cache/<marketplace>/<plugin-name>/<version>/ # plugin 本体
//!     .claude-plugin/plugin.json                 # manifest（必須）
//!     .claude-plugin/marketplace.json            # marketplace metadata（任意）
//!     commands/*.md                              # plugin 提供の slash
//!     skills/<name>/SKILL.md                     # plugin 提供の skill
//!     agents/*.md                                # plugin 提供の sub-agent
//!     hooks/hooks.json                           # plugin 提供の hooks
//!     .mcp.json                                  # plugin 提供の MCP servers
//! ```
//!
//! - `~/.claude/settings.json` の `enabledPlugins["<name>@<marketplace>"]`
//!   (bool) で有効無効が切り替わる。無効化された plugin も disk 上には残り
//!   続けるため、一覧では "enabled" フラグとして区別して返す。
//! - `installed_plugins.json` の構造 (Agent SDK `SDKControlReloadPluginsResponse`
//!   と整合):
//!   ```json
//!   {
//!     "version": 2,
//!     "plugins": {
//!       "<name>@<marketplace>": [
//!         { "scope": "user", "installPath": "...", "version": "...", ... }
//!       ]
//!     }
//!   }
//!   ```
//!
//! ## Phase 1 スコープ（本 module）
//!
//! - `list_plugins()` command: user-level plugin 全件を返す（project-level は
//!   まだ Agent SDK でも実験的なため Phase 2 送り）
//! - 各 plugin 内の commands / skills / agents / MCP / hooks 件数をカウントして
//!   metadata として同梱（ドリルダウン UI は v1.4+）
//! - manifest parse 失敗は当該 plugin のみ skip し、他 plugin は継続 load
//!
//! ## slash.rs / skills.rs との違い
//!
//! - plugin は slash + skill + agent + MCP + hooks をバンドルした **上位概念**
//! - 走査対象は `~/.claude/plugins/installed_plugins.json` という「既に解決済」
//!   の index であり、file system を recursive に glob する必要はない
//! - 同名 override のロジックなし（plugin ID は `<name>@<marketplace>` で
//!   衝突回避されている）
//!
//! ## Phase 2 以降（v1.4+）
//!
//! - Plugin install / uninstall UI（`claude plugin install` を spawn）
//! - enable / disable toggle（`~/.claude/settings.json` を rewrite）
//! - plugin 内部 commands / skills のドリルダウン表示（本 module で件数のみ
//!   返しているので、file path list に拡張するだけ）
//! - Agent SDK の `reloadPlugins()` を sidecar 経由で呼んで UI を即同期

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// フロントエンドへ返す plugin 1 件。
///
/// slash.rs の `SlashCmd` / skills.rs の `SkillDef` と同列の並行定義。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDef {
    /// plugin ID (`<name>@<marketplace>` 形式、例: `vercel@claude-plugins-official`)。
    /// `installed_plugins.json` の map key と一致。
    pub id: String,
    /// plugin 名（`plugin.json` の `name`、例: `vercel`）。
    pub name: String,
    /// marketplace 名（ID から derive。例: `claude-plugins-official`）。
    pub marketplace: String,
    /// version 文字列（`installed_plugins.json` の `version`、例: `0.40.0` or `unknown`）。
    pub version: String,
    /// 1 行要約（`plugin.json` の `description`）。無ければ空文字。
    pub description: String,
    /// author 名（`plugin.json` の `author.name`）。無ければ None。
    pub author: Option<String>,
    /// repository URL（`plugin.json` の `repository`）。無ければ None。
    pub repository: Option<String>,
    /// license（`plugin.json` の `license`）。無ければ None。
    pub license: Option<String>,
    /// keywords（`plugin.json` の `keywords`）。無ければ空配列。
    pub keywords: Vec<String>,
    /// `~/.claude/settings.json` の `enabledPlugins[id]` の真偽。
    /// key 自体が無い場合は true（Claude Code の default 挙動に揃える）。
    pub enabled: bool,
    /// plugin 本体ディレクトリの絶対パス（`installed_plugins.json` の `installPath`）。
    pub install_path: String,
    /// `plugin.json` の絶対パス（Monaco preview / フロントの click handler 用）。
    pub manifest_path: String,
    /// plugin 内部に含まれる slash commands の件数 (`commands/*.md`)。
    pub command_count: usize,
    /// plugin 内部に含まれる skills の件数 (`skills/*/SKILL.md`)。
    pub skill_count: usize,
    /// plugin 内部に含まれる sub-agents の件数 (`agents/*.md`)。
    pub agent_count: usize,
    /// MCP server 定義を持つかどうか (`.mcp.json` の有無)。
    pub has_mcp: bool,
    /// hook 定義を持つかどうか (`hooks/hooks.json` の有無)。
    pub has_hooks: bool,
}

/// Tauri command: `~/.claude/plugins/installed_plugins.json` を index として
/// user-level plugin を全件列挙する。
///
/// 引数は将来 project-level plugin（`<project>/.claude/plugins/`）対応の
/// ために用意した placeholder。現 Phase では使わない。走査失敗（index が
/// 存在しない / 壊れている等）は致命的ではなく **空リストを返す** のみ
/// （slash.rs / skills.rs と同じ error 耐性ポリシー）。
#[tauri::command]
pub fn list_plugins(_project_path: Option<String>) -> Result<Vec<PluginDef>, String> {
    Ok(scan_all())
}

/// `~/.claude/` を起点に全 user-level plugin を走査する。
///
/// 手順:
/// 1. `~/.claude/settings.json` の `enabledPlugins` を読む（無ければ空 map）
/// 2. `~/.claude/plugins/installed_plugins.json` を index として load
/// 3. 各 plugin ID に対して `installPath` 配下の `.claude-plugin/plugin.json`
///    を parse、内部 directory を count する
/// 4. manifest 欠損 or parse 失敗した plugin は eprintln + skip（他は継続）
fn scan_all() -> Vec<PluginDef> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let claude_dir = home.join(".claude");

    let enabled_map = load_enabled_plugins(&claude_dir.join("settings.json"));
    let installed_index_path = claude_dir.join("plugins").join("installed_plugins.json");

    let Ok(index_text) = std::fs::read_to_string(&installed_index_path) else {
        return Vec::new();
    };
    let Ok(index_json): Result<Value, _> = serde_json::from_str(&index_text) else {
        eprintln!(
            "[plugins] installed_plugins.json is not valid JSON: {}",
            installed_index_path.display()
        );
        return Vec::new();
    };

    let Some(plugins_obj) = index_json.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut out: Vec<PluginDef> = Vec::new();
    for (plugin_id, entries) in plugins_obj {
        // `entries` は配列（同一 ID で scope 違いの複数 install を想定した形）。
        // 現仕様では user scope が筆頭。最初の element を代表として採用する。
        let Some(entry) = entries.as_array().and_then(|a| a.first()) else {
            continue;
        };
        let Some(install_path_str) = entry.get("installPath").and_then(Value::as_str) else {
            continue;
        };
        let install_path = PathBuf::from(install_path_str);

        let version = entry
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();

        match parse_plugin(plugin_id, &install_path, &version, &enabled_map) {
            Ok(p) => out.push(p),
            Err(e) => eprintln!("[plugins] parse failed for {plugin_id}: {e}"),
        }
    }

    // 並び順: enabled > disabled → alphabetical(id)。Palette で目的の plugin を
    // 見つけやすくするための安定化。
    out.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

/// `~/.claude/settings.json` の `enabledPlugins` を読み出す。
///
/// ファイルが無い / JSON 不正な場合は空 map を返す（fail-open、settings が
/// 欠けていても plugin 一覧は返す）。`enabledPlugins` に key が無い plugin
/// は **default 有効** として扱う（Claude Code CLI の挙動に揃える）。
fn load_enabled_plugins(settings_path: &Path) -> std::collections::HashMap<String, bool> {
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

/// 1 件の plugin を parse する。manifest 必須。
///
/// - `plugin.json` が無ければ Err（呼び元で skip）
/// - frontend 側の最小要件（`id` / `name` / `install_path`）が揃うように
///   fallback を用意する
fn parse_plugin(
    plugin_id: &str,
    install_path: &Path,
    version: &str,
    enabled_map: &std::collections::HashMap<String, bool>,
) -> Result<PluginDef, String> {
    let manifest_path = install_path.join(".claude-plugin").join("plugin.json");
    if !manifest_path.is_file() {
        return Err(format!("manifest missing: {}", manifest_path.display()));
    }
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest: {e}"))?;
    let json: Value =
        serde_json::from_str(&text).map_err(|e| format!("parse manifest: {e}"))?;

    // `name` は manifest → ID の左側 → install_path dirname の順で fallback。
    let name = json
        .get("name")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| plugin_id.split('@').next().map(|s| s.to_string()))
        .or_else(|| {
            install_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown".to_string());

    // marketplace は ID の `@` 以降。無ければ `local` と表示。
    let marketplace = plugin_id
        .split_once('@')
        .map(|(_, m)| m.to_string())
        .unwrap_or_else(|| "local".to_string());

    let description = json
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let author = json
        .get("author")
        .and_then(|a| a.get("name").and_then(Value::as_str))
        .map(str::to_string);

    let repository = json
        .get("repository")
        .and_then(Value::as_str)
        .map(str::to_string);

    let license = json
        .get("license")
        .and_then(Value::as_str)
        .map(str::to_string);

    let keywords: Vec<String> = json
        .get("keywords")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    // 内部件数のカウント（存在しないディレクトリは 0）。
    let command_count = count_files_with_ext(&install_path.join("commands"), "md");
    let skill_count = count_skill_dirs(&install_path.join("skills"));
    let agent_count = count_files_with_ext(&install_path.join("agents"), "md");
    let has_mcp = install_path.join(".mcp.json").is_file();
    let has_hooks = install_path.join("hooks").join("hooks.json").is_file();

    // enabledPlugins に key が無い場合は default true（Claude Code 仕様）。
    let enabled = enabled_map.get(plugin_id).copied().unwrap_or(true);

    Ok(PluginDef {
        id: plugin_id.to_string(),
        name,
        marketplace,
        version: version.to_string(),
        description,
        author,
        repository,
        license,
        keywords,
        enabled,
        install_path: install_path.to_string_lossy().into_owned(),
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        command_count,
        skill_count,
        agent_count,
        has_mcp,
        has_hooks,
    })
}

/// `dir` 直下の `*.<ext>` ファイル数を数える（再帰しない）。
fn count_files_with_ext(dir: &Path, ext: &str) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            let p = e.path();
            p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case(ext))
                    .unwrap_or(false)
        })
        .count()
}

/// `skills_root` 直下で `SKILL.md` を持つサブディレクトリの数を返す。
/// skills.rs の scan_skills_dir と判定ロジックを揃える（大文字違い許容）。
fn count_skill_dirs(skills_root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(skills_root) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            let dir_path = e.path();
            if !dir_path.is_dir() {
                return false;
            }
            let candidates = ["SKILL.md", "Skill.md", "skill.md"];
            candidates.iter().any(|n| dir_path.join(n).is_file())
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn parse_plugin_reads_manifest_fields() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("vercel");
        write_file(
            &install.join(".claude-plugin").join("plugin.json"),
            r#"{
                "name": "vercel",
                "version": "0.40.0",
                "description": "Build and deploy web apps",
                "author": { "name": "Vercel" },
                "repository": "https://github.com/vercel/vercel-plugin",
                "license": "Apache-2.0",
                "keywords": ["vercel", "nextjs"]
            }"#,
        );
        let enabled = std::collections::HashMap::new();
        let p = parse_plugin("vercel@official", &install, "0.40.0", &enabled).unwrap();

        assert_eq!(p.id, "vercel@official");
        assert_eq!(p.name, "vercel");
        assert_eq!(p.marketplace, "official");
        assert_eq!(p.version, "0.40.0");
        assert_eq!(p.description, "Build and deploy web apps");
        assert_eq!(p.author.as_deref(), Some("Vercel"));
        assert_eq!(p.repository.as_deref(), Some("https://github.com/vercel/vercel-plugin"));
        assert_eq!(p.license.as_deref(), Some("Apache-2.0"));
        assert_eq!(p.keywords, vec!["vercel".to_string(), "nextjs".to_string()]);
        // enabledPlugins に key が無い → default true
        assert!(p.enabled);
    }

    #[test]
    fn parse_plugin_missing_manifest_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("no-manifest");
        fs::create_dir_all(&install).unwrap();
        let enabled = std::collections::HashMap::new();
        assert!(parse_plugin("x@y", &install, "1.0.0", &enabled).is_err());
    }

    #[test]
    fn parse_plugin_counts_internal_content() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("full");
        // manifest
        write_file(
            &install.join(".claude-plugin").join("plugin.json"),
            r#"{"name":"full"}"#,
        );
        // 2 commands
        write_file(&install.join("commands").join("a.md"), "# a");
        write_file(&install.join("commands").join("b.md"), "# b");
        // 1 non-md file in commands should not count
        write_file(&install.join("commands").join("README.txt"), "readme");
        // 2 skills (one with Skill.md alt casing)
        write_file(
            &install.join("skills").join("s1").join("SKILL.md"),
            "---\nname: s1\n---",
        );
        write_file(
            &install.join("skills").join("s2").join("Skill.md"),
            "---\nname: s2\n---",
        );
        // empty skills dir should not count
        fs::create_dir_all(&install.join("skills").join("empty")).unwrap();
        // 1 agent
        write_file(&install.join("agents").join("aa.md"), "agent");
        // mcp + hooks
        write_file(&install.join(".mcp.json"), "{}");
        write_file(&install.join("hooks").join("hooks.json"), "{}");

        let enabled = std::collections::HashMap::new();
        let p = parse_plugin("full@market", &install, "1.0.0", &enabled).unwrap();
        assert_eq!(p.command_count, 2);
        assert_eq!(p.skill_count, 2);
        assert_eq!(p.agent_count, 1);
        assert!(p.has_mcp);
        assert!(p.has_hooks);
    }

    #[test]
    fn parse_plugin_respects_enabled_map() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("p");
        write_file(
            &install.join(".claude-plugin").join("plugin.json"),
            r#"{"name":"p"}"#,
        );
        let mut enabled = std::collections::HashMap::new();
        enabled.insert("p@m".to_string(), false);
        let p = parse_plugin("p@m", &install, "1.0.0", &enabled).unwrap();
        assert!(!p.enabled);
    }

    #[test]
    fn parse_plugin_falls_back_name_when_manifest_missing_name() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("fallback-dir");
        write_file(
            &install.join(".claude-plugin").join("plugin.json"),
            r#"{}"#,
        );
        let enabled = std::collections::HashMap::new();
        let p = parse_plugin("myplug@mkt", &install, "1.0.0", &enabled).unwrap();
        // ID 左側が fallback の第一候補
        assert_eq!(p.name, "myplug");
        assert_eq!(p.marketplace, "mkt");
    }

    #[test]
    fn parse_plugin_id_without_at_has_local_marketplace() {
        let dir = tempfile::tempdir().unwrap();
        let install = dir.path().join("local");
        write_file(
            &install.join(".claude-plugin").join("plugin.json"),
            r#"{"name":"local"}"#,
        );
        let enabled = std::collections::HashMap::new();
        let p = parse_plugin("local", &install, "dev", &enabled).unwrap();
        assert_eq!(p.marketplace, "local");
    }

    #[test]
    fn load_enabled_plugins_handles_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let nope = dir.path().join("settings.json");
        let map = load_enabled_plugins(&nope);
        assert!(map.is_empty());
    }

    #[test]
    fn load_enabled_plugins_parses_bool_values_only() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        write_file(
            &settings,
            r#"{ "enabledPlugins": { "a@m": true, "b@m": false, "c@m": "not-bool" } }"#,
        );
        let map = load_enabled_plugins(&settings);
        assert_eq!(map.get("a@m"), Some(&true));
        assert_eq!(map.get("b@m"), Some(&false));
        // 非 bool は無視する
        assert!(!map.contains_key("c@m"));
    }

    #[test]
    fn count_files_with_ext_is_non_recursive() {
        let dir = tempfile::tempdir().unwrap();
        write_file(&dir.path().join("a.md"), "1");
        write_file(&dir.path().join("b.md"), "2");
        write_file(&dir.path().join("sub").join("c.md"), "3");
        write_file(&dir.path().join("ignore.txt"), "x");
        assert_eq!(count_files_with_ext(dir.path(), "md"), 2);
    }

    #[test]
    fn count_files_returns_zero_when_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert_eq!(count_files_with_ext(&missing, "md"), 0);
    }

    #[test]
    fn count_skill_dirs_accepts_alt_casing() {
        let dir = tempfile::tempdir().unwrap();
        write_file(&dir.path().join("s1").join("SKILL.md"), "a");
        write_file(&dir.path().join("s2").join("Skill.md"), "b");
        write_file(&dir.path().join("s3").join("skill.md"), "c");
        fs::create_dir_all(dir.path().join("empty")).unwrap();
        assert_eq!(count_skill_dirs(dir.path()), 3);
    }
}
