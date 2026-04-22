//! ccmux-ide Tauri backend entrypoint.
//!
//! Derived from ccmux-ide (MIT Licensed). See `commands/*.rs` for the modules
//! migrated from `C:\Users\hiron\Desktop\ccmux-ide\src\ide\`.

mod commands;
mod events;

use tauri::Manager;

use commands::{
    // PRJ-012 v3.3 / DEC-033 / Chunk A: Multi-Sidecar Architecture
    // (1 project = 1 sidecar)。v3.2 singleton の `send_agent_prompt` /
    // `start_agent_sidecar` / `stop_agent_sidecar` は signature が変わり、
    // 新規 `send_agent_interrupt` / `list_active_sidecars` を追加登録する。
    agent::{
        list_active_sidecars, send_agent_interrupt, send_agent_prompt, start_agent_sidecar,
        stop_agent_sidecar, AgentState,
    },
    builtin_slash::{
        builtin_init_claude_md, list_builtin_slashes, read_mcp_config, write_mcp_config,
    },
    claude_usage::{get_claude_rate_limits, ClaudeUsageCache},
    config::{get_api_key, set_api_key},
    history::{
        append_message, create_session, delete_session, get_session_messages, init_history_db,
        list_sessions, rename_session, update_session_project, update_session_sdk_id,
        HistoryState,
    },
    image_paste::save_clipboard_image,
    memory_tree::scan_memory_tree,
    oauth_usage::{check_claude_authenticated, get_oauth_usage, OAuthUsageCache},
    search_fts::{reindex_conversations, search_conversations, search_messages},
    slash::list_slash_commands,
    // PRJ-012 v1.3 / PM-953: Claude Code skill discovery（Phase 1 = list 表示のみ）。
    skills::list_skills,
    usage::get_usage_stats,
    // PRJ-012 v3.5 / PM-771 (2026-04-20): v3.5.3 UI 再配置により frontend 呼出 0 と
    // なった `worktree` / `status` / `git` module (計 13 command) を削除。
    // PRJ-012 v3.4 / Chunk B (DEC-034 Must 2): @file / @folder mention picker 用。
    // 末尾 append で他 Chunk と排他。
    file_list::list_project_files,
    // PRJ-012 v3.4.5 hot-fix (2026-04-20): std::fs 版の Tauri command。
    // tauri-plugin-fs の readDir / readFile が Windows 絶対パス + 大量フォルダで
    // hang する事象を回避するため、ProjectTree / FilePreviewDialog の直接呼出に使う。
    fs_util::{list_dir_children, read_file_bytes},
    // PRJ-012 v1.0 / PM-920 / DEC-045 (2026-04-21): 組込ターミナル (xterm.js + Rust PTY)。
    // portable-pty で cmd.exe / bash / vim / python REPL 等の interactive command を起動。
    pty::{list_active_ptys, pty_kill, pty_resize, pty_spawn, pty_write, PtyState},
    // PRJ-012 v1.1 / PM-944 (2026-04-20): Preview window の Rust spawn。
    // PM-943 の JS API 経路は Windows WebView2 user data dir 競合で spawn 直後に
    // process が死ぬ問題が解消せず、`WebviewWindowBuilder::data_directory` を
    // 明示指定する Rust command に切替。
    preview::spawn_preview_window,
};
use events::monitor::{self, MonitorHandle};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        // PM-283: 更新チェック plugin。endpoint は tauri.conf.json の
        // `plugins.updater.endpoints`（GitHub Release の latest.json）を参照。
        // pubkey 空文字のため署名検証は skip される（MVP、M3 で許容）。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AgentState::default())
        .manage(HistoryState::default())
        .manage(ClaudeUsageCache::new())
        // PRJ-012 Round D': OAuth Usage API 5 分 cache。
        .manage(OAuthUsageCache::default())
        // PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル PTY state (HashMap<pty_id, PtyHandle>)。
        .manage(PtyState::default())
        .manage::<MonitorHandle>(monitor::new_handle())
        .setup(|app| {
            // PM-150: `~/.ccmux-ide-gui/history.db` を初期化。失敗してもログを残して
            // 起動は継続する（UI は history 依存機能のみ後から失敗する）。
            let state: tauri::State<HistoryState> = app.state();
            if let Err(e) = init_history_db(&state) {
                eprintln!("[history] init failed (起動継続): {e:#}");
            } else {
                eprintln!("[history] initialized ~/.ccmux-ide-gui/history.db");
            }

            // PRJ-012 v3.3 / DEC-033 / Chunk A:
            // v3.2 までは `app_handle.listen_any("agent:raw", ...)` で sidecar
            // stdout NDJSON を集約し monitor state に反映していたが、v3.3 の
            // multi-sidecar + per-project event prefix 化 (`agent:{projectId}:raw`)
            // に伴い、stdout parser 内で `dispatch_to_monitor` を直接呼ぶ方式
            // に切り替えた (cf. `commands::agent::start_agent_sidecar`)。
            // ここでは listen_any 登録を削除する。MonitorHandle の state 管理
            // 自体は従来通り `.manage(...)` 済。

            Ok(())
        })
        // PRJ-012 v3.3.1 / DEC-033 / Chunk A: orphan process 対策
        // Tauri アプリ終了時 (window close / quit menu / Ctrl+C 等の graceful shutdown)
        // に明示的に sidecar を kill する。Windows では JobObject KILL_ON_JOB_CLOSE が
        // 最終ガードになるが、それでも Drop より早く明示 kill しておくことで
        // 「Tauri exit ↔ Node プロセス残存」の race を最小化する。
        // 強制 kill (タスクマネージャ / panic) はこの hook を経由せず、JobObject に頼る。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<AgentState>() {
                    state.drain_kill_all();
                }
                // PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル PTY も明示 drain。
                if let Some(state) = window.app_handle().try_state::<PtyState>() {
                    state.drain_kill_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Config / keyring
            get_api_key,
            set_api_key,
            // Image paste (arboard + wl-paste fallback)
            save_clipboard_image,
            // CLAUDE.md tree
            scan_memory_tree,
            // PRJ-012 v3.5 / PM-771 (2026-04-20): list_worktrees / add_worktree /
            // remove_worktree / switch_worktree は UI 再配置で frontend 呼出 0 となり削除。
            // FTS5 search (skeleton legacy + PM-230 本実装)
            search_conversations,
            reindex_conversations,
            search_messages,
            // Slash command discovery (PM-200)
            list_slash_commands,
            // PRJ-012 v1.3 / PM-953: Claude Code skill discovery（~/.claude/skills/）
            list_skills,
            // Agent sidecar (Node + Claude Agent SDK TS)
            // PRJ-012 v3.3 / DEC-033: Multi-Sidecar (1 project = 1 sidecar)。
            // API 契約は `commands::agent` モジュール doc を参照。
            start_agent_sidecar,
            send_agent_prompt,
            send_agent_interrupt,
            stop_agent_sidecar,
            list_active_sidecars,
            // Conversation history (PM-150 / PM-151)
            create_session,
            append_message,
            list_sessions,
            get_session_messages,
            delete_session,
            rename_session,
            // PRJ-012 v5 / Chunk B / DEC-032: session の project_id 再割当
            update_session_project,
            // PRJ-012 v3.5.14 / PM-830: SDK 側 session UUID を保存して resume 経由
            // で context 継続するための更新コマンド。sidecar からの sdk_session_ready
            // event を frontend が受けて呼ぶ。
            update_session_sdk_id,
            // Usage stats (PRJ-012 Stage B / Round A)
            get_usage_stats,
            get_claude_rate_limits,
            // PRJ-012 Round D': 公式 OAuth Usage API
            get_oauth_usage,
            // PRJ-012 v1.1 / PM-938 (2026-04-20): Welcome Wizard 撤去後の起動時
            // 認証自動検出。`~/.claude/.credentials.json` の claudeAiOauth.accessToken
            // の有無だけを返す（network I/O なし、token 文字列は戻さない）。
            check_claude_authenticated,
            // PRJ-012 v4 / Chunk C / DEC-028: Claude Code 組込 slash の GUI ネイティブ実装
            list_builtin_slashes,
            builtin_init_claude_md,
            read_mcp_config,
            write_mcp_config,
            // PRJ-012 v3.5 / PM-771 (2026-04-20): detect_status_file /
            // list_status_candidates / read_status_file は UI 再配置で frontend 呼出 0
            // となり削除。
            // PRJ-012 v3.4 / Chunk B / DEC-034 Must 2: @file / @folder mention picker。
            // project_root 配下を .gitignore 尊重で列挙。末尾 append で他 Chunk と排他。
            list_project_files,
            // PRJ-012 v3.5 / PM-771 (2026-04-20): git_status / git_stage_file /
            // git_unstage_file / git_commit / git_diff_file / git_current_branch は
            // UI 再配置で frontend 呼出 0 となり削除。
            // PRJ-012 v3.4.5 hot-fix: std::fs 版の fs util（ProjectTree / 画像プレビュー用）
            list_dir_children,
            read_file_bytes,
            // PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル (xterm.js + Rust PTY)。
            // cmd.exe / bash / vim / python REPL 等の interactive command を portable-pty 経由で起動。
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            list_active_ptys,
            // PRJ-012 v1.1 / PM-944 (2026-04-20): Preview window を Rust 側で
            // `WebviewWindowBuilder::data_directory` 付きで spawn する command。
            // frontend は `invoke("spawn_preview_window", { label, url, title })`。
            spawn_preview_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
