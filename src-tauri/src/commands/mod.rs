//! Tauri commands (ccmux-ide から移植された Rust 資産群)。
//!
//! - `image_paste` : arboard + wl-paste fallback でクリップボード画像を PNG 保存
//! - `memory_tree` : `~/.claude/CLAUDE.md` + `<repo>/.claude/memory/**/*.md` 走査
//! - `worktree`    : git worktree CRUD（std::process::Command）
//! - `config`      : keyring 経由の API Key 保存 / 読出
//! - `search_fts`  : rusqlite FTS5 会話検索（skeleton、M3 で完全実装）
//!
//! すべての command は `Result<T, String>` を返す（`anyhow::Error` は上位で
//! `.map_err(|e| e.to_string())` して変換する）。

pub mod agent;
pub mod config;
pub mod image_paste;
pub mod memory_tree;
pub mod search_fts;
pub mod worktree;
