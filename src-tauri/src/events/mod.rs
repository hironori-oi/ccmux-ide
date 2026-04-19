//! Tauri events モジュール。
//!
//! frontend 向けの Rust 側イベント emitter。`commands/` と異なり、`invoke` ではなく
//! `AppHandle::emit` 経由でサイドバー系 UI（ContextGauge / SubAgents / Todos）に
//! push 情報を流す。
//!
//! - `monitor` : sidecar の `agent:raw` NDJSON を parse して 500ms throttle で
//!   `monitor:tick` イベントを emit する（PM-163）。

pub mod monitor;
