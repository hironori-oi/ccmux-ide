//! Tauri commands (ccmux-ide から移植された Rust 資産群)。
//!
//! - `image_paste` : arboard + wl-paste fallback でクリップボード画像を PNG 保存
//! - `memory_tree` : `~/.claude/CLAUDE.md` + `<repo>/.claude/memory/**/*.md` 走査
//! - `worktree`    : git worktree CRUD（std::process::Command）
//! - `config`      : keyring 経由の API Key 保存 / 読出
//! - `search_fts`  : rusqlite FTS5 会話検索（skeleton、M3 で完全実装）
//! - `history`     : `~/.ccmux-ide-gui/history.db` に sessions / messages /
//!                   attachments + FTS5 messages_fts を永続化（PM-150〜152）
//!
//! すべての command は `Result<T, String>` を返す（`anyhow::Error` は上位で
//! `.map_err(|e| e.to_string())` して変換する）。

pub mod agent;
pub mod claude_usage;
pub mod config;
pub mod history;
pub mod image_paste;
pub mod memory_tree;
pub mod oauth_usage;
pub mod search_fts;
pub mod slash;
pub mod usage;
// PRJ-012 v3.5 / PM-771 (2026-04-20): `worktree` / `status` / `git` module は
// v3.5.3 UI 再配置で frontend 呼出 0 となり PM-770 で列挙、本 round で物理削除。

// PRJ-012 v4 / Chunk C: Claude Code 組込 slash コマンドの GUI ネイティブ実装。
// （Chunk B との衝突回避のため末尾に append している。順序は意味を持たない。）
pub mod builtin_slash;

// PRJ-012 v3.4 / Chunk B (DEC-034 Must 2): @file / @folder mention picker 用。
// project_root 配下を .gitignore 尊重で列挙する汎用 file lister。
// 他 Chunk（A / C）との衝突回避のため末尾に append。
pub mod file_list;

// PRJ-012 v3.4.5 (2026-04-20 hot-fix): tauri-plugin-fs の readDir / readFile が
// Windows 絶対パス + 大量フォルダで hang する事象を回避する std::fs 版ユーティリティ。
// ProjectTree の汎用化と FilePreviewDialog の画像プレビューで invoke される。
pub mod fs_util;

// PRJ-012 v1.0 / PM-920 / DEC-045 (2026-04-21): 組込ターミナル (xterm.js + Rust PTY)。
// portable-pty 経由で cmd.exe / bash / zsh / python REPL / vim 等の interactive
// command を native pseudo-terminal で起動する。末尾 append で他 module と排他。
pub mod pty;

// PRJ-012 v1.1 / PM-944 (2026-04-20): Preview window を Rust 側で spawn する module。
// PM-943 の JS API 経路 (`new WebviewWindow()`) では Windows で user data dir 共有
// 起因の WebView2 即死が解消せず、`WebviewWindowBuilder::data_directory` を
// 明示指定する Rust 側 command に切替。末尾 append で他 module と排他。
pub mod preview;

// PRJ-012 v1.3 / PM-953 (2026-04-20): Claude Code skill 機能の discovery。
// `~/.claude/skills/<name>/SKILL.md` + project `.claude/skills/` を走査し、
// SlashPalette に skill section を描画するための metadata を返す（Phase 1 = list
// 表示のみ、skill 実行は Phase 2 送り）。Agent SDK には skill 機能が native 存在
// するため、本 module は UI 可視化の並行実装に徹する。
pub mod skills;

// PRJ-012 v1.3 / PM-954 (2026-04-20): Claude Code plugin 機能の discovery。
// `~/.claude/plugins/installed_plugins.json` を index に user-level plugin を
// 列挙し、各 plugin 内の commands / skills / agents / MCP / hooks 件数を count
// して返す（Phase 1 = list 表示のみ）。Agent SDK は `SdkPluginConfig` +
// `reloadPlugins()` で plugin を first-class support するため、本 module は
// PM-953 skills.rs と同じく UI 可視化の並行実装に徹する。Phase 2 以降で
// install / enable / disable toggle UI を追加。
pub mod plugins;

// PRJ-012 v1.23.0 / DEC-069 (2026-04-25): localhost サーバー管理機能 (Phase 1 MVP)。
// netstat2 で LISTEN 状態の TCP socket → pid を取得し、sysinfo で pid → process
// metadata (name / cmd / start_time / cpu / memory) を解決して frontend に返す。
// kill 操作は SIGTERM → 3 秒待機 → SIGKILL (Unix) / `taskkill /F /T` (Windows)
// に escalate する。Sumi 自身の pid は kill 候補から除外。
pub mod local_servers;

// PRJ-012 v1.4 / PM-955 (2026-04-20): Claude Code MCP (Model Context Protocol)
// server discovery。Cursor 上の Claude Code と同等に github / playwright /
// supabase / vercel / pencil / stitch 等の MCP server を ccmux-ide-gui の
// SlashPalette 上で可視化する。走査対象は
//   1. ~/.claude/settings.json  (global)
//   2. ~/.claude.json top-level mcpServers  (user)
//   3. ~/.claude.json projects[abs].mcpServers  (user-project)
//   4. enabled plugin の <install-path>/.mcp.json  (plugin)
//   5. <project>/.mcp.json  (project-local)
// disabledMcpServers / disabledMcpjsonServers / enabledPlugins を反映。
// Phase 1 = list 表示のみ、Agent SDK の `mcpServerStatus()` / `setMcpServers()`
// による live 接続状態 / toggle UI は v1.5+ (Phase 2/3) 申し送り。
pub mod mcp;

// PRJ-012 v1.24.0 / DEC-070 (2026-04-25): Claude Code CLI のバージョン検出。
// Settings の「ブラウザ操作」section で `--chrome` 機能の前提条件 (CLI 2.0.73+)
// を確認するために `claude --version` を spawn して semver を抽出する。末尾
// append で他 module と排他。
pub mod cli_version;
