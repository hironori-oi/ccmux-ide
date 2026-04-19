//! Claude セッションの状態モニター（PM-163）。
//!
//! Out-of-process Node sidecar（`commands::agent`）が emit する `agent:raw`
//! NDJSON イベントを Rust 側でさらに parse し、UI が欲しい単位
//! （tokens / context / model / sub-agents / todos / git branch / stop_reason）に
//! 集約して `monitor:tick` として frontend に push する。
//!
//! v2 ccmux-ide の `src/claude_monitor.rs`（JSONL ファイルを tail していた版）を
//! 95% 流用。以下を Tauri 版に書き換え:
//! - `broadcast::Sender<ClaudeState>` → `AppHandle::emit("monitor:tick", &state)`
//! - Per-pane HashMap → single `Arc<RwLock<MonitorState>>`（Tauri State で共有）
//! - JSONL 直接読込 → sidecar が既に 1 行ずつ parse 済の `agent:raw` JSON 文字列を
//!   `update_from_sidecar_event` 経由で受け取る
//! - 3-phase lock / requestId 重複排除 / 500ms throttle を Tauri 文脈で再実装
//!
//! sidecar プロトコル（`sidecar/src/index.ts` 準拠）:
//!   { "type": "ready"|"message"|"tool_use"|"tool_result"|"system"|"result"|"error"|"done",
//!     "id": "<uuid>", "payload": <任意 JSON> }
//! このうち以下を `MonitorState` 更新に使う:
//!   - type=message, payload=SDKAssistantMessage  → model / usage / tool_use / gitBranch
//!   - type=tool_use                              → sub-agent スポーン / TodoWrite
//!   - type=tool_result                           → sub-agent 完了
//!   - type=result                                → stop_reason / 最終 usage
//!
//! Emit のトリガ（500ms throttle）:
//!   - tokens 増加 / sub_agents 件数変化 / todos 変化 / stop_reason 付与 /
//!     model 変化 / git branch 変化 のいずれか ＆
//!   - 前回 emit から 500ms 経過 or 重要変化（stop_reason != None）

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::RwLock;

use tauri::{AppHandle, Emitter};

/// Claude モデルごとのコンテキスト上限（トークン）。
///
/// Opus 4.6 以降は Pro/Max で 1M 既定。明示 `[1m]` / `-1m` suffix があれば優先。
/// 未知モデルは Opus 4.7 相当の 200K を fallback（M3 Full MVP で可変化）。
fn context_limit_for(model: &str) -> u64 {
    if model.contains("[1m]") || model.contains("-1m") {
        return 1_000_000;
    }
    if model.contains("opus-4-6") || model.contains("opus-4-7") {
        return 1_000_000;
    }
    if model.contains("haiku") || model.contains("sonnet") || model.contains("opus") {
        return 200_000;
    }
    200_000
}

/// Todo 1 件（TodoWrite ツール経由で Claude が管理）。
#[derive(Serialize, Clone, Debug)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    /// "pending" | "in_progress" | "completed"
    pub status: String,
}

/// サブエージェント 1 件（Agent / Task ツール経由）。
#[derive(Serialize, Clone, Debug)]
pub struct SubAgentInfo {
    /// tool_use の id（ユニーク）
    pub id: String,
    /// subagent_type（`input.subagent_type`）、無指定なら "general-purpose"
    pub name: String,
    /// "running" | "done" | "error"
    pub status: String,
}

/// UI に push する state（`monitor:tick` のペイロード）。
#[derive(Serialize, Clone, Default, Debug)]
pub struct MonitorState {
    /// 直近 request の input+cache（＝次回送信時の context サイズ）。
    pub tokens_used: u64,
    /// モデルの context 上限。
    pub tokens_max: u64,
    /// 累計入力トークン（humanize 表示用）。
    pub total_input: u64,
    /// 累計出力トークン。
    pub total_output: u64,
    /// 累計 cache read（hit 率表示用）。
    pub total_cache_read: u64,
    /// 累計 cache creation。
    pub total_cache_creation: u64,
    /// モデル名（例: "claude-opus-4-7"）。
    pub model: String,
    /// git branch（取得できた場合）。
    pub git_branch: Option<String>,
    /// 現在走っているサブエージェント。
    pub sub_agents: Vec<SubAgentInfo>,
    /// TodoWrite で管理中の todo 一覧。
    pub todos: Vec<TodoItem>,
    /// 最後の result イベントの stop_reason。
    pub stop_reason: Option<String>,
    /// 直近実行中のツール名（任意）。
    pub current_tool: Option<String>,
}

impl MonitorState {
    /// コンテキスト使用率（0.0〜1.0）。
    pub fn context_ratio(&self) -> f64 {
        if self.tokens_max == 0 {
            0.0
        } else {
            (self.tokens_used as f64 / self.tokens_max as f64).min(1.0)
        }
    }
}

/// 内部可変 state。Tauri State で `Arc<RwLock<MonitorStateInner>>` として共有。
#[derive(Default)]
pub struct MonitorStateInner {
    pub state: MonitorState,
    /// tokens double-count 防止用（requestId set）。
    counted_request_ids: HashSet<String>,
    /// 走行中サブエージェント: tool_use_id → subagent_type
    active_task_ids: std::collections::HashMap<String, String>,
    /// 最後に emit した時刻（500ms throttle 用）。
    last_emit: Option<Instant>,
}

/// Tauri `manage()` で登録するハンドル型。
pub type MonitorHandle = Arc<RwLock<MonitorStateInner>>;

/// 新規ハンドルを生成（`tauri::Builder::manage` に渡す用）。
pub fn new_handle() -> MonitorHandle {
    Arc::new(RwLock::new(MonitorStateInner::default()))
}

/// requestId キャッシュが肥大化するのを防ぐしきい値。
/// 越えたら全クリアする（NDJSON は一方向に流れるので古い id の再出現は非常に稀）。
const MAX_REQUEST_ID_CACHE: usize = 10_000;

/// emit throttle 間隔。
const EMIT_THROTTLE: Duration = Duration::from_millis(500);

/// `git branch --show-current` を cwd で実行して現在のブランチを取得。
///
/// 失敗時（非 git / git 不在 / .git 不存在）は None。assistant event に
/// `gitBranch` が含まれていないケース（sidecar 経由だと殆ど無い）で fallback として
/// 呼ぶ想定。現状は call site なし（assistant.gitBranch を優先）。
#[allow(dead_code)]
pub fn detect_git_branch(cwd: &std::path::Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("branch")
        .arg("--show-current")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() || s == "HEAD" {
        None
    } else {
        Some(s)
    }
}

/// sidecar の 1 NDJSON 行（`{type,id,payload}`）を state に反映する。
///
/// 戻り値: state が変化して UI 更新の候補になったか。
/// ※ throttle 判定は呼出側（`emit_if_changed`）で行う。
pub fn update_from_sidecar_event(inner: &mut MonitorStateInner, envelope: &Value) -> bool {
    let kind = envelope
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let payload = envelope.get("payload").unwrap_or(&Value::Null);

    match kind {
        // SDKAssistantMessage。message.content / message.usage / message.model / gitBranch 等を持つ。
        "message" => apply_assistant(inner, payload),
        // Rust 側で先に展開済の tool_use ブロック（`{tool_use_id, name, input}`）。
        "tool_use" => apply_tool_use(inner, payload),
        // SDKUserMessage（tool_result を含むことが多い）。
        "tool_result" => apply_tool_result(inner, payload),
        // SDKResultMessage（1 turn 終端、stop_reason と最終 usage を持つ）。
        "result" => apply_result(inner, payload),
        // その他（system / ready / done / error）は現段階で state 更新なし。
        _ => false,
    }
}

/// SDK の assistant payload を適用。`payload` は SDKAssistantMessage 全体。
fn apply_assistant(inner: &mut MonitorStateInner, payload: &Value) -> bool {
    let mut changed = false;

    // payload.message（Anthropic Message 本体）があればそれを、無ければ payload を直接。
    let msg = payload.get("message").unwrap_or(payload);

    // --- model ---
    if let Some(model) = msg.get("model").and_then(|v| v.as_str()) {
        if inner.state.model != model {
            inner.state.model = model.to_string();
            inner.state.tokens_max = context_limit_for(model);
            changed = true;
        }
    }

    // --- git branch（SDKAssistantMessage は `gitBranch` を top-level に持つことがある）---
    let git_branch = payload
        .get("gitBranch")
        .and_then(|v| v.as_str())
        .or_else(|| msg.get("gitBranch").and_then(|v| v.as_str()));
    if let Some(br) = git_branch {
        if !br.is_empty() && br != "HEAD" && inner.state.git_branch.as_deref() != Some(br) {
            inner.state.git_branch = Some(br.to_string());
            changed = true;
        }
    }

    // --- usage（requestId で dedup） ---
    let request_id = payload
        .get("requestId")
        .or_else(|| msg.get("requestId"))
        .or_else(|| payload.get("uuid"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let should_count = match &request_id {
        Some(id) => {
            if inner.counted_request_ids.len() >= MAX_REQUEST_ID_CACHE {
                inner.counted_request_ids.clear();
            }
            inner.counted_request_ids.insert(id.clone())
        }
        None => false,
    };

    if should_count {
        if let Some(usage) = msg.get("usage") {
            let input = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let output = usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_read = usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_create = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            inner.state.total_input += input;
            inner.state.total_output += output;
            inner.state.total_cache_read += cache_read;
            inner.state.total_cache_creation += cache_create;
            // 次ターン送信時の実効 context サイズ。
            inner.state.tokens_used = input + cache_read + cache_create;
            changed = true;
        }
    }

    // --- stop_reason（tool_use / end_turn 以外はターン終了）---
    if let Some(sr) = msg.get("stop_reason").and_then(|v| v.as_str()) {
        // "tool_use" は連鎖中、それ以外は最終。stop_reason を持てば全て記録。
        if inner.state.stop_reason.as_deref() != Some(sr) {
            inner.state.stop_reason = Some(sr.to_string());
            changed = true;
        }
    }

    // --- content[] の tool_use を走査（model が自身で呼ぶツール）---
    if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
        for block in content {
            let btype = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if btype != "tool_use" {
                continue;
            }
            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if !name.is_empty() {
                inner.state.current_tool = Some(name.to_string());
                changed = true;
            }

            // サブエージェント（"Agent" は SDK の新名、"Task" は旧名）
            if (name == "Agent" || name == "Task") && !id.is_empty() {
                let subagent_type = block
                    .get("input")
                    .and_then(|i| i.get("subagent_type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("general-purpose")
                    .to_string();
                inner
                    .active_task_ids
                    .insert(id.to_string(), subagent_type.clone());
                inner.state.sub_agents = inner
                    .active_task_ids
                    .iter()
                    .map(|(k, v)| SubAgentInfo {
                        id: k.clone(),
                        name: v.clone(),
                        status: "running".to_string(),
                    })
                    .collect();
                changed = true;
            }

            // TodoWrite 経由の todos 更新
            if name == "TodoWrite" {
                if let Some(todos) = block
                    .get("input")
                    .and_then(|v| v.get("todos"))
                    .and_then(|v| v.as_array())
                {
                    let new_todos: Vec<TodoItem> = todos
                        .iter()
                        .enumerate()
                        .filter_map(|(i, t)| {
                            let content = t.get("content")?.as_str()?.to_string();
                            let status = t.get("status")?.as_str()?.to_string();
                            // id は Claude 側から付与されない場合があるので index fallback。
                            let id = t
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("todo-{i}"));
                            Some(TodoItem {
                                id,
                                content,
                                status,
                            })
                        })
                        .collect();
                    inner.state.todos = new_todos;
                    changed = true;
                }
            }
        }
    }

    changed
}

/// sidecar が pre-parse した tool_use ブロック 1 個を適用。
/// payload 形: `{tool_use_id, name, input}`
fn apply_tool_use(inner: &mut MonitorStateInner, payload: &Value) -> bool {
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let id = payload
        .get("tool_use_id")
        .or_else(|| payload.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mut changed = false;

    if !name.is_empty() && inner.state.current_tool.as_deref() != Some(name) {
        inner.state.current_tool = Some(name.to_string());
        changed = true;
    }

    if (name == "Agent" || name == "Task") && !id.is_empty() {
        let subagent_type = payload
            .get("input")
            .and_then(|i| i.get("subagent_type"))
            .and_then(|v| v.as_str())
            .unwrap_or("general-purpose")
            .to_string();
        if inner
            .active_task_ids
            .insert(id.to_string(), subagent_type.clone())
            .is_none()
        {
            inner.state.sub_agents = inner
                .active_task_ids
                .iter()
                .map(|(k, v)| SubAgentInfo {
                    id: k.clone(),
                    name: v.clone(),
                    status: "running".to_string(),
                })
                .collect();
            changed = true;
        }
    }

    if name == "TodoWrite" {
        if let Some(todos) = payload
            .get("input")
            .and_then(|v| v.get("todos"))
            .and_then(|v| v.as_array())
        {
            inner.state.todos = todos
                .iter()
                .enumerate()
                .filter_map(|(i, t)| {
                    let content = t.get("content")?.as_str()?.to_string();
                    let status = t.get("status")?.as_str()?.to_string();
                    let id = t
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("todo-{i}"));
                    Some(TodoItem {
                        id,
                        content,
                        status,
                    })
                })
                .collect();
            changed = true;
        }
    }

    changed
}

/// tool_result（user role message）。走っていた sub-agent を閉じる。
fn apply_tool_result(inner: &mut MonitorStateInner, payload: &Value) -> bool {
    let msg = payload.get("message").unwrap_or(payload);
    let content = match msg.get("content").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return false,
    };
    let mut changed = false;

    for block in content {
        if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
            continue;
        }
        let tool_use_id = block
            .get("tool_use_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if tool_use_id.is_empty() {
            continue;
        }
        if inner.active_task_ids.remove(tool_use_id).is_some() {
            inner.state.sub_agents = inner
                .active_task_ids
                .iter()
                .map(|(k, v)| SubAgentInfo {
                    id: k.clone(),
                    name: v.clone(),
                    status: "running".to_string(),
                })
                .collect();
            changed = true;
        }
    }

    changed
}

/// SDKResultMessage（ターン終端）。stop_reason / usage を確定保存。
fn apply_result(inner: &mut MonitorStateInner, payload: &Value) -> bool {
    let mut changed = false;

    // SDKResultMessage の形は SDK 版ごとに微妙に差があるため、複数の場所を探す。
    let stop_reason = payload
        .get("stop_reason")
        .or_else(|| payload.get("result").and_then(|r| r.get("stop_reason")))
        .and_then(|v| v.as_str());
    if let Some(sr) = stop_reason {
        if inner.state.stop_reason.as_deref() != Some(sr) {
            inner.state.stop_reason = Some(sr.to_string());
            changed = true;
        }
    }
    // result 到達 ＝ current_tool は終わっているのでクリア。
    if inner.state.current_tool.is_some() {
        inner.state.current_tool = None;
        changed = true;
    }
    changed
}

/// throttle 判定 + emit。`changed=true` 時のみ呼ぶ想定。
///
/// stop_reason が出た瞬間は即時 emit（ユーザー体感最優先）。それ以外は
/// 500ms 以上空いていれば emit、直近 emit から 500ms 未満なら skip。
pub fn emit_if_due(
    app: &AppHandle,
    inner: &mut MonitorStateInner,
    force: bool,
) {
    let now = Instant::now();
    let due = match inner.last_emit {
        Some(prev) => now.duration_since(prev) >= EMIT_THROTTLE,
        None => true,
    };
    if !force && !due {
        return;
    }
    inner.last_emit = Some(now);
    // 失敗しても UI は古い値を描き続けるのでログだけ残す。
    if let Err(e) = app.emit("monitor:tick", &inner.state) {
        eprintln!("[monitor] emit failed: {e}");
    }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inner() -> MonitorStateInner {
        MonitorStateInner::default()
    }

    #[test]
    fn test_context_limit() {
        assert_eq!(context_limit_for("claude-opus-4-7"), 1_000_000);
        assert_eq!(context_limit_for("claude-opus-4-6"), 1_000_000);
        assert_eq!(context_limit_for("claude-opus-4-7[1m]"), 1_000_000);
        assert_eq!(context_limit_for("claude-sonnet-4-5"), 200_000);
        assert_eq!(context_limit_for("claude-haiku-4-5"), 200_000);
        assert_eq!(context_limit_for("unknown"), 200_000);
    }

    #[test]
    fn test_apply_assistant_usage_dedup() {
        let mut i = inner();
        // 同一 requestId を 3 回流しても 1 回分しかカウントされない
        let env = json!({
            "type": "message",
            "id": "r1",
            "payload": {
                "requestId": "req_1",
                "message": {
                    "model": "claude-opus-4-7",
                    "content": [],
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 50,
                        "cache_read_input_tokens": 1000,
                        "cache_creation_input_tokens": 0
                    }
                }
            }
        });
        let c1 = update_from_sidecar_event(&mut i, &env);
        let c2 = update_from_sidecar_event(&mut i, &env);
        let c3 = update_from_sidecar_event(&mut i, &env);
        assert!(c1);
        // 2 回目以降は state 変化なし（model / branch も不変）
        assert!(!c2);
        assert!(!c3);
        assert_eq!(i.state.total_input, 100);
        assert_eq!(i.state.total_output, 50);
        assert_eq!(i.state.total_cache_read, 1000);
        assert_eq!(i.state.tokens_used, 1100);
        assert_eq!(i.state.tokens_max, 1_000_000);
        assert_eq!(i.state.model, "claude-opus-4-7");
    }

    #[test]
    fn test_sub_agent_spawn_and_complete() {
        let mut i = inner();
        let spawn = json!({
            "type": "tool_use",
            "id": "m1",
            "payload": {
                "tool_use_id": "toolu_1",
                "name": "Agent",
                "input": {"subagent_type": "generator"}
            }
        });
        assert!(update_from_sidecar_event(&mut i, &spawn));
        assert_eq!(i.state.sub_agents.len(), 1);
        assert_eq!(i.state.sub_agents[0].name, "generator");

        let done = json!({
            "type": "tool_result",
            "id": "m2",
            "payload": {
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_1", "content": "ok"}
                    ]
                }
            }
        });
        assert!(update_from_sidecar_event(&mut i, &done));
        assert_eq!(i.state.sub_agents.len(), 0);
    }

    #[test]
    fn test_todo_parsing() {
        let mut i = inner();
        let env = json!({
            "type": "tool_use",
            "id": "m1",
            "payload": {
                "tool_use_id": "toolu_todo",
                "name": "TodoWrite",
                "input": {
                    "todos": [
                        {"content": "A", "status": "completed"},
                        {"content": "B", "status": "in_progress"},
                        {"content": "C", "status": "pending"}
                    ]
                }
            }
        });
        assert!(update_from_sidecar_event(&mut i, &env));
        assert_eq!(i.state.todos.len(), 3);
        assert_eq!(i.state.todos[0].status, "completed");
        assert_eq!(i.state.todos[1].content, "B");
    }

    #[test]
    fn test_stop_reason_from_result() {
        let mut i = inner();
        let env = json!({
            "type": "result",
            "id": "r1",
            "payload": {
                "stop_reason": "end_turn"
            }
        });
        assert!(update_from_sidecar_event(&mut i, &env));
        assert_eq!(i.state.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn test_context_ratio() {
        let mut s = MonitorState::default();
        s.tokens_used = 50_000;
        s.tokens_max = 200_000;
        assert!((s.context_ratio() - 0.25).abs() < 1e-6);
        s.tokens_used = 250_000;
        assert!((s.context_ratio() - 1.0).abs() < 1e-6); // clamp
    }
}
