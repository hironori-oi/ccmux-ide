//! ccmux-ide Tauri backend entrypoint.
//!
//! Derived from ccmux-ide (MIT Licensed). See `commands/*.rs` for the modules
//! migrated from `C:\Users\hiron\Desktop\ccmux-ide\src\ide\`.

mod commands;

use commands::{
    agent::{send_agent_prompt, start_agent_sidecar, stop_agent_sidecar, AgentState},
    config::{get_api_key, set_api_key},
    image_paste::save_clipboard_image,
    memory_tree::scan_memory_tree,
    search_fts::{reindex_conversations, search_conversations},
    worktree::{add_worktree, list_worktrees, remove_worktree},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AgentState::default())
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
            // Agent sidecar (Node + Claude Agent SDK TS)
            start_agent_sidecar,
            send_agent_prompt,
            stop_agent_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
