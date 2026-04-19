//! ccmux-ide Tauri backend entrypoint.
//!
//! Derived from ccmux-ide (MIT Licensed). See `commands/*.rs` for the modules
//! migrated from `C:\Users\hiron\Desktop\ccmux-ide\src\ide\`.

mod commands;
mod events;

use tauri::{Listener, Manager};

use commands::{
    agent::{send_agent_prompt, start_agent_sidecar, stop_agent_sidecar, AgentState},
    config::{get_api_key, set_api_key},
    history::{
        append_message, create_session, delete_session, get_session_messages, init_history_db,
        list_sessions, rename_session, HistoryState,
    },
    image_paste::save_clipboard_image,
    memory_tree::scan_memory_tree,
    search_fts::{reindex_conversations, search_conversations},
    slash::list_slash_commands,
    worktree::{add_worktree, list_worktrees, remove_worktree},
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
        .manage(AgentState::default())
        .manage(HistoryState::default())
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

            // PM-163: sidecar の `agent:raw` NDJSON を Rust 側でさらに parse し、
            // MonitorState を更新 → 500ms throttle で `monitor:tick` として emit。
            //
            // 実装メモ（Tauri 2）:
            // - `AppHandle::listen_any` は同一プロセス内で emit されたイベントを
            //   受け取れる。`agent:raw` は commands::agent が emit しているため、
            //   こちらの listener がループ購読する。
            // - listener コールバック内は非同期不可 (`Fn` trait) なので、tokio task
            //   に情報を投げて update する（Tauri の tokio runtime を block_on で使用）。
            let app_handle = app.handle().clone();
            let handle_for_listener = app_handle.clone();
            app_handle.listen_any("agent:raw", move |event| {
                // sidecar 側が 1 行の JSON を文字列として emit しているため、
                // 二重 decode（外側: Tauri Event payload → JSON 文字列 ／
                // 内側: その文字列 → NDJSON の JSON Value）が必要。
                let raw = event.payload().to_string();
                let line: String = match serde_json::from_str::<String>(&raw) {
                    Ok(s) => s,
                    Err(_) => raw, // payload がすでに plain 文字列の場合の fallback
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return;
                }
                let envelope: serde_json::Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[monitor] JSON parse error: {e}; line={trimmed:.200}");
                        return;
                    }
                };

                let app_for_task = handle_for_listener.clone();
                tauri::async_runtime::spawn(async move {
                    let state: tauri::State<MonitorHandle> = app_for_task.state();
                    let mut inner = state.write().await;
                    let changed = monitor::update_from_sidecar_event(&mut inner, &envelope);
                    if !changed {
                        return;
                    }
                    let force = inner.state.stop_reason.is_some();
                    monitor::emit_if_due(&app_for_task, &mut inner, force);
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Config / keyring
            get_api_key,
            set_api_key,
            // Image paste (arboard + wl-paste fallback)
            save_clipboard_image,
            // CLAUDE.md tree
            scan_memory_tree,
            // git worktree
            list_worktrees,
            add_worktree,
            remove_worktree,
            // FTS5 search (skeleton)
            search_conversations,
            reindex_conversations,
            // Slash command discovery (PM-200)
            list_slash_commands,
            // Agent sidecar (Node + Claude Agent SDK TS)
            start_agent_sidecar,
            send_agent_prompt,
            stop_agent_sidecar,
            // Conversation history (PM-150 / PM-151)
            create_session,
            append_message,
            list_sessions,
            get_session_messages,
            delete_session,
            rename_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
