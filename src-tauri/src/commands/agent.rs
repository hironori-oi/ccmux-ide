//! Agent sidecar (Node.js) の spawn / stdin 書込 / stdout リレー。
//!
//! DEC-023 に基づき、Agent SDK TypeScript を Node sidecar プロセスとして起動し、
//! NDJSON プロトコルで frontend とやりとりする。
//!
//! 起動モード (PM-108 / DEC-026):
//! - Bundled  : `sidecar/dist/index.mjs` を `node` で直接起動 (production / CI)
//! - Dev      : `sidecar/src/index.ts` を `node --import tsx/esm` で起動 (dev)
//!
//! ----------------------------------------------------------------------------
//! **DEC-063 / v1.17.0 Session-Level Sidecar**
//!
//! v1.16.x までは `HashMap<project_id, SidecarHandle>` (1 project = 1 sidecar) で、
//! 同一 project 内で複数 session を並列実行すると context が混線していた。
//! v1.17.0 からは **`HashMap<session_id, SidecarHandle>` (1 session = 1 sidecar)** に
//! 変更し、完全に session 単位で context を分離する。
//!
//! ### state 管理
//! - `AgentState.sidecars : Mutex<HashMap<String, SidecarHandle>>`
//! - key = session_id (UUID 文字列)、value = `SidecarHandle { child, session_id, project_id, cwd, started_at, pid }`
//!
//! ### event prefix
//! - v1.16: `agent:{projectId}:raw` / `:stderr` / `:terminated`
//! - v1.17: `agent:{sessionId}:raw` / `:stderr` / `:terminated`
//!
//! ### Lazy spawn
//! - `start_agent_sidecar(sessionId, projectId, cwd)` を session の初回 prompt 直前に invoke
//! - 既に起動済なら idempotent reuse
//! - Max 同時 8 session、超過時 Err 返却 (Frontend で toast)
//!
//! ### Cascade kill
//! - `stop_agent_sidecar(sessionId)` : 該当 sidecar のみ kill
//! - `stop_project_sidecars(projectId)` : 所属 session の sidecar を一括 kill (project 削除時)
//!
//! ### plansDirectory
//! - `{cwd}/.claude/plans/<session_id>` に細分化して session 間の書込競合を回避

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, INVALID_HANDLE_VALUE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

// -----------------------------------------------------------------------------
// 設定定数
// -----------------------------------------------------------------------------

/// DEC-063: 同時起動可能な session sidecar の最大数。
/// 超過時 `start_agent_sidecar` は Err を返し、Frontend が toast でユーザに通知する。
pub const MAX_CONCURRENT_SIDECARS: usize = 8;

// -----------------------------------------------------------------------------
// Windows JobObject wrapper (DEC-033 v3.3.1)
// -----------------------------------------------------------------------------

/// Windows 専用: 親 Tauri プロセスに紐づく JobObject ハンドル。
///
/// `AgentState::default()` で生成され、AgentState の Drop 時に CloseHandle される
/// (= 親プロセス終了 → state drop → JobObject close → Windows カーネルが
/// job 内の全 sidecar プロセスを強制 kill)。
#[cfg(target_os = "windows")]
struct JobObject {
    handle: HANDLE,
}

#[cfg(target_os = "windows")]
unsafe impl Send for JobObject {}
#[cfg(target_os = "windows")]
unsafe impl Sync for JobObject {}

#[cfg(target_os = "windows")]
impl JobObject {
    /// プロセス全体で 1 つ持つ JobObject を作成し、KILL_ON_JOB_CLOSE flag を立てる。
    fn create() -> Option<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            eprintln!("[agent/jobobject] CreateJobObjectW failed (orphan-kill 保護なしで起動継続)");
            return None;
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
            unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;

        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            eprintln!(
                "[agent/jobobject] SetInformationJobObject failed (KILL_ON_JOB_CLOSE 設定不可、CloseHandle してフォールバック)"
            );
            unsafe {
                let _ = CloseHandle(handle);
            }
            return None;
        }

        eprintln!(
            "[agent/jobobject] created JobObject (KILL_ON_JOB_CLOSE), handle=0x{:x}",
            handle as usize
        );
        Some(Self { handle })
    }

    fn assign(&self, pid: u32) {
        let proc_handle: HANDLE = unsafe {
            OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid)
        };
        if proc_handle.is_null() {
            eprintln!(
                "[agent/jobobject] OpenProcess(pid={pid}) failed (権限不足 or プロセス既に終了)"
            );
            return;
        }

        let ok = unsafe { AssignProcessToJobObject(self.handle, proc_handle) };
        if ok == 0 {
            eprintln!(
                "[agent/jobobject] AssignProcessToJobObject(pid={pid}) failed (既に別 job 所属の可能性、orphan kill 保護なし)"
            );
        } else {
            eprintln!("[agent/jobobject] assigned pid={pid} to JobObject");
        }

        unsafe {
            let _ = CloseHandle(proc_handle);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
        eprintln!("[agent/jobobject] JobObject dropped → KILL_ON_JOB_CLOSE が発動");
    }
}

/// 単一 session に紐づく sidecar プロセスの handle。
///
/// DEC-063 (v1.17.0): key は session_id に変更、project_id は参照情報として保持。
pub struct SidecarHandle {
    /// 子プロセスの書込口 + kill 用 handle。
    pub child: CommandChild,
    /// 所属 session ID (key と同値、デバッグ便宜上保持)。
    pub session_id: String,
    /// 所属 project ID (project 削除時の cascade kill 用)。
    pub project_id: String,
    /// 起動時の cwd (Agent SDK の cwd / project のルート)。
    pub cwd: String,
    /// 起動時刻 (UNIX epoch milliseconds)。
    pub started_at: i64,
    /// sidecar プロセスの PID (debug 用)。
    pub pid: u32,
}

/// Session-level sidecar (DEC-063) の状態を管理する Tauri state。
///
/// key = session_id (UUID 文字列)、value = `SidecarHandle`。
pub struct AgentState {
    pub sidecars: Mutex<HashMap<String, SidecarHandle>>,
    #[cfg(target_os = "windows")]
    job_object: Option<JobObject>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            sidecars: Mutex::new(HashMap::new()),
            #[cfg(target_os = "windows")]
            job_object: JobObject::create(),
        }
    }
}

impl AgentState {
    /// 全 sidecar を kill し、HashMap を drain する。app shutdown 時の保険。
    pub fn drain_kill_all(&self) {
        if let Ok(mut map) = self.sidecars.lock() {
            let drained: Vec<(String, SidecarHandle)> = map.drain().collect();
            let n = drained.len();
            for (_sid, handle) in drained {
                let _ = handle.child.kill();
            }
            if n > 0 {
                eprintln!("[agent] drain_kill_all: killed {n} sidecar(s)");
            }
        }
    }
}

impl Drop for AgentState {
    fn drop(&mut self) {
        if let Ok(mut map) = self.sidecars.lock() {
            let drained: Vec<(String, SidecarHandle)> = map.drain().collect();
            for (_sid, handle) in drained {
                let _ = handle.child.kill();
            }
        }
    }
}

/// `list_active_sidecars` command の戻り値。
///
/// DEC-063: session_id / project_id / cwd / started_at / pid を含む。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInfo {
    pub session_id: String,
    pub project_id: String,
    pub cwd: String,
    pub started_at: i64,
    pub pid: u32,
}

/// sidecar の起動モード。
#[derive(Debug, Clone, Copy)]
enum SidecarMode {
    Bundled,
    Dev,
}

/// DEC-063: sidecar 起動用の argv を組み立てる (テスト可能な pure fn)。
///
/// - `--session-id=<uuid>` : 必須、session-level routing 用
/// - `--project-id=<uuid>` : 必須、debug / permission_request payload 用
/// - `--model=<id>`        : 省略可
/// - `--thinking-tokens=<n>` : 省略可
fn build_sidecar_args(
    mode: SidecarMode,
    session_id: &str,
    project_id: &str,
    model: Option<&str>,
    thinking_tokens: Option<u32>,
) -> Vec<String> {
    let mut args: Vec<String> = match mode {
        SidecarMode::Bundled => vec!["dist/index.mjs".to_string()],
        SidecarMode::Dev => vec![
            "--import".to_string(),
            "node_modules/tsx/dist/esm/index.mjs".to_string(),
            "src/index.ts".to_string(),
        ],
    };
    args.push(format!("--session-id={session_id}"));
    args.push(format!("--project-id={project_id}"));
    if let Some(m) = model {
        if !m.is_empty() {
            args.push(format!("--model={m}"));
        }
    }
    if let Some(t) = thinking_tokens {
        args.push(format!("--thinking-tokens={t}"));
    }
    args
}

/// sidecar のエントリポイントを解決し、(path, mode) を返す。
fn resolve_sidecar_entry(app: &AppHandle) -> Result<(std::path::PathBuf, SidecarMode), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("cwd 解決失敗: {e}"))?;

    let dist_bundle = cwd.join("sidecar/dist/index.mjs");
    if dist_bundle.exists() {
        return Ok((dist_bundle, SidecarMode::Bundled));
    }

    let dist_bundle2 = cwd.join("../sidecar/dist/index.mjs");
    if dist_bundle2.exists() {
        return Ok((dist_bundle2, SidecarMode::Bundled));
    }

    for rel in &[
        "_up_/sidecar/dist/index.mjs",
        "sidecar/dist/index.mjs",
    ] {
        if let Ok(p) = app
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        {
            if p.exists() {
                return Ok((p, SidecarMode::Bundled));
            }
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                "_up_/sidecar/dist/index.mjs",
                "_up_\\sidecar\\dist\\index.mjs",
                "resources/_up_/sidecar/dist/index.mjs",
                "resources/sidecar/dist/index.mjs",
                "sidecar/dist/index.mjs",
            ];
            for rel in &candidates {
                let p = exe_dir.join(rel);
                if p.exists() {
                    return Ok((p, SidecarMode::Bundled));
                }
            }
        }
    }

    let src_entry = cwd.join("sidecar/src/index.ts");
    if src_entry.exists() {
        return Ok((src_entry, SidecarMode::Dev));
    }

    let src_entry2 = cwd.join("../sidecar/src/index.ts");
    if src_entry2.exists() {
        return Ok((src_entry2, SidecarMode::Dev));
    }

    for rel in &[
        "_up_/sidecar/src/index.ts",
        "sidecar/src/index.ts",
    ] {
        if let Ok(p) = app
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        {
            if p.exists() {
                return Ok((p, SidecarMode::Dev));
            }
        }
    }

    Err(format!(
        "sidecar entry not found. cwd={}, exe={:?}",
        cwd.display(),
        std::env::current_exe().ok().map(|p| p.display().to_string())
    ))
}

/// 現在時刻 (UNIX epoch milliseconds)。
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// DEC-063: DB の `sessions.sidecar_pid` / `sidecar_started_at` を書き換える
/// 補助関数。history state を try_state で引くだけで、失敗してもログのみ。
fn update_session_sidecar_meta_in_db(
    app: &AppHandle,
    session_id: &str,
    pid: Option<u32>,
    started_at: Option<i64>,
) {
    use crate::commands::history::HistoryState;
    let Some(state) = app.try_state::<HistoryState>() else {
        return;
    };
    let Ok(guard) = state.conn.lock() else {
        return;
    };
    let Some(conn) = guard.as_ref() else {
        return;
    };
    let now = now_unix_ms();
    let pid_value: Option<i64> = pid.map(|p| p as i64);
    let _ = conn.execute(
        "UPDATE sessions SET sidecar_pid = ?1, sidecar_started_at = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![pid_value, started_at, now, session_id],
    );
}

/// DEC-063 (v1.17.0): 指定 session の sidecar プロセスを起動する。
///
/// すでに同じ `session_id` の sidecar が起動中なら **no-op で `Ok(())`** (idempotent)。
///
/// 起動後、子プロセスの stdout/stderr/exit を以下の Tauri event として push する:
/// - `agent:{session_id}:raw`        : stdout 1 行 (NDJSON 1 レコード)
/// - `agent:{session_id}:stderr`     : stderr 1 行
/// - `agent:{session_id}:terminated` : プロセス終了 (payload: exit code)
///
/// # Max 同時制限
/// `MAX_CONCURRENT_SIDECARS` 超過時は Err を返す。Frontend で toast 表示する。
///
/// # 引数
/// - `session_id` : UUID 文字列。sessions table の id。
/// - `project_id` : 所属 project の UUID (cascade kill / debug 用)。
/// - `cwd` : Agent SDK の cwd に使う絶対パス。project のルートディレクトリ。
/// - `model` / `thinking_tokens` : 省略可。
#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent_sidecar(
    app: AppHandle,
    state: State<'_, AgentState>,
    session_id: String,
    project_id: String,
    cwd: String,
    model: Option<String>,
    thinking_tokens: Option<u32>,
) -> Result<(), String> {
    // 重複起動の idempotent チェック + Max 同時チェック
    {
        let guard = state
            .sidecars
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if guard.contains_key(&session_id) {
            return Ok(());
        }
        if guard.len() >= MAX_CONCURRENT_SIDECARS {
            return Err(format!(
                "同時起動可能なエージェント上限（{MAX_CONCURRENT_SIDECARS}）に達しました。不要なセッションを閉じてください"
            ));
        }
    }

    let (sidecar_entry, mode) = resolve_sidecar_entry(&app)?;
    let entry_str = sidecar_entry.to_string_lossy().to_string();

    let sidecar_dir = sidecar_entry
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "sidecar ディレクトリ解決失敗".to_string())?
        .to_path_buf();

    let args = build_sidecar_args(mode, &session_id, &project_id, model.as_deref(), thinking_tokens);

    let stderr_evt = format!("agent:{session_id}:stderr");
    let model_dbg = model.as_deref().unwrap_or("<default>");
    let thinking_dbg = thinking_tokens
        .map(|t| t.to_string())
        .unwrap_or_else(|| "<default>".to_string());
    let _ = app.emit(
        &stderr_evt,
        format!(
            "sidecar starting: mode={mode:?}, entry={entry_str}, session_id={session_id}, project_id={project_id}, cwd={cwd}, model={model_dbg}, thinkingTokens={thinking_dbg}\n"
        ),
    );

    let shell = app.shell();
    let (mut rx, child) = shell
        .command("node")
        .current_dir(sidecar_dir)
        .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .spawn()
        .map_err(|e| format!("sidecar の spawn に失敗: {e}"))?;

    let pid = child.pid();

    // Windows: JobObject に PID を assign (orphan kill 保護)
    #[cfg(target_os = "windows")]
    {
        if let Some(ref job) = state.job_object {
            job.assign(pid);
        }
    }

    let started_at = now_unix_ms();

    // HashMap に insert
    {
        let mut guard = state
            .sidecars
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        guard.insert(
            session_id.clone(),
            SidecarHandle {
                child,
                session_id: session_id.clone(),
                project_id: project_id.clone(),
                cwd: cwd.clone(),
                started_at,
                pid,
            },
        );
    }

    // DB: sessions.sidecar_pid / sidecar_started_at を更新 (debug / 監視用)
    update_session_sidecar_meta_in_db(&app, &session_id, Some(pid), Some(started_at));

    // 子プロセスの stdout/stderr/exit を session 単位 event で frontend に push。
    let app_handle = app.clone();
    let sid_for_task = session_id.clone();
    let pid_for_task = project_id.clone();
    let raw_evt = format!("agent:{session_id}:raw");
    let stderr_evt = format!("agent:{session_id}:stderr");
    let terminated_evt = format!("agent:{session_id}:terminated");
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit(&raw_evt, s.clone());
                    dispatch_permission_request_if_any(&app_handle, &sid_for_task, &pid_for_task, &s);
                    dispatch_to_monitor(&app_handle, &sid_for_task, &s).await;
                }
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit(&stderr_evt, s);
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_handle.emit(&terminated_evt, payload.code);
                    if let Some(app_state) = app_handle.try_state::<AgentState>() {
                        if let Ok(mut map) = app_state.sidecars.lock() {
                            map.remove(&sid_for_task);
                        }
                    }
                    // DB の pid を null に戻す
                    update_session_sidecar_meta_in_db(&app_handle, &sid_for_task, None, None);
                    break;
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle.emit(&stderr_evt, format!("error: {err}"));
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// sidecar stdout の 1 行 NDJSON を monitor state に反映する。
async fn dispatch_to_monitor(
    app: &AppHandle,
    _session_id: &str,
    raw_line: &str,
) {
    use crate::events::monitor::{self, MonitorHandle};

    let trimmed = raw_line.trim();
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

    let state = match app.try_state::<MonitorHandle>() {
        Some(s) => s,
        None => return,
    };
    let mut inner = state.write().await;
    let changed = monitor::update_from_sidecar_event(&mut inner, &envelope);
    if !changed {
        return;
    }
    let force = inner.state.stop_reason.is_some();
    monitor::emit_if_due(app, &mut inner, force);
}

/// DEC-063: 指定 session の sidecar に prompt を送信する。
///
/// 既存の互換 / 呼出簡易化のため、`project_id` を options 内で明示してもよいが、
/// 内部的には session_id のみで sidecar を特定する。
#[tauri::command(rename_all = "camelCase")]
pub async fn send_agent_prompt(
    state: State<'_, AgentState>,
    session_id: String,
    prompt: String,
    attachments: Vec<String>,
    resume: Option<String>,
    options: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get_mut(&session_id)
        .ok_or_else(|| format!("sidecar not running for session_id={session_id}"))?;

    let req_id = uuid::Uuid::new_v4().to_string();

    let mut options: serde_json::Map<String, serde_json::Value> = match options {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };

    if let Some(ref sdk_id) = resume {
        if !sdk_id.is_empty() {
            options.insert(
                "resume".to_string(),
                serde_json::Value::String(sdk_id.clone()),
            );
        }
    }

    options.insert(
        "cwd".to_string(),
        serde_json::Value::String(handle.cwd.clone()),
    );

    options.insert(
        "settingSources".to_string(),
        serde_json::json!(["user", "project", "local"]),
    );

    // DEC-063 (v1.17.0): plansDirectory を session 単位に細分化する。
    // 従来 {cwd}/.claude/plans/ の単一ディレクトリだと複数 session 同時の
    // ExitPlanMode 書込で race が発生する恐れがあるため、session UUID を付ける。
    if !options.contains_key("plansDirectory") {
        options.insert(
            "plansDirectory".to_string(),
            serde_json::Value::String(format!("{}/.claude/plans/{}", handle.cwd, session_id)),
        );
    }

    eprintln!(
        "[agent] send_agent_prompt: session_id={session_id}, project_id={project_id}, req_id={req_id}, resume={resume:?}",
        project_id = handle.project_id
    );

    let req = serde_json::json!({
        "type": "prompt",
        "id": req_id,
        "prompt": prompt,
        "attachments": attachments,
        "options": options,
    });
    let line = req.to_string() + "\n";

    handle
        .child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar stdin 書込失敗 (session_id={session_id}): {e}"))?;
    Ok(())
}

/// DEC-063: 指定 session の sidecar に interrupt 指示を送る。
#[tauri::command(rename_all = "camelCase")]
pub async fn send_agent_interrupt(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get_mut(&session_id)
        .ok_or_else(|| format!("sidecar not running for session_id={session_id}"))?;

    let req = serde_json::json!({ "type": "interrupt" });
    let line = req.to_string() + "\n";

    handle
        .child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar interrupt 書込失敗 (session_id={session_id}): {e}"))?;
    Ok(())
}

/// DEC-063: permission_request NDJSON を `sumi://permission-request` event として転送。
fn dispatch_permission_request_if_any(
    app: &AppHandle,
    session_id: &str,
    project_id: &str,
    raw_line: &str,
) {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() {
        return;
    }
    if !trimmed.contains("permission_request") {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };
    if value.get("type").and_then(|v| v.as_str()) != Some("permission_request") {
        return;
    }

    let ev_payload = serde_json::json!({
        "sessionId": session_id,
        "projectId": project_id,
        "envelope": value,
    });
    let _ = app.emit("sumi://permission-request", ev_payload);
}

/// DEC-063: Frontend から渡された承認/拒否の決定を対応 session の sidecar に書き戻す。
#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_permission_request(
    state: State<'_, AgentState>,
    session_id: String,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard.get_mut(&session_id).ok_or_else(|| {
        format!("sidecar not running for session_id={session_id} (permission response dropped)")
    })?;

    let req = serde_json::json!({
        "type": "permission_response",
        "request_id": request_id,
        "decision": decision,
    });
    let line = req.to_string() + "\n";

    handle
        .child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar stdin 書込失敗 (session_id={session_id}): {e}"))?;
    Ok(())
}

/// DEC-063: 指定 session の sidecar プロセスを終了させる。
///
/// HashMap に該当 session_id が無ければ **no-op で `Ok(())`** (idempotent)。
#[tauri::command(rename_all = "camelCase")]
pub async fn stop_agent_sidecar(
    app: AppHandle,
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    if let Some(handle) = guard.remove(&session_id) {
        let _ = handle.child.kill();
    }
    drop(guard);
    update_session_sidecar_meta_in_db(&app, &session_id, None, None);
    Ok(())
}

/// DEC-063: 指定 project に所属する全 sidecar を一括 kill する。
///
/// project 削除時の cascade cleanup 用。該当 sidecar が 0 件でも Ok を返す。
#[tauri::command(rename_all = "camelCase")]
pub async fn stop_project_sidecars(
    app: AppHandle,
    state: State<'_, AgentState>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let mut killed_session_ids: Vec<String> = Vec::new();
    {
        let mut guard = state
            .sidecars
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        let matching: Vec<String> = guard
            .iter()
            .filter(|(_, h)| h.project_id == project_id)
            .map(|(sid, _)| sid.clone())
            .collect();
        for sid in &matching {
            if let Some(handle) = guard.remove(sid) {
                let _ = handle.child.kill();
                killed_session_ids.push(sid.clone());
            }
        }
    }
    for sid in &killed_session_ids {
        update_session_sidecar_meta_in_db(&app, sid, None, None);
    }
    Ok(killed_session_ids)
}

/// DEC-063: 現在稼働中の sidecar 一覧を返す (session 単位)。
#[tauri::command(rename_all = "camelCase")]
pub async fn list_active_sidecars(
    state: State<'_, AgentState>,
) -> Result<Vec<SidecarInfo>, String> {
    let guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let mut out: Vec<SidecarInfo> = guard
        .iter()
        .map(|(sid, h)| SidecarInfo {
            session_id: sid.clone(),
            project_id: h.project_id.clone(),
            cwd: h.cwd.clone(),
            started_at: h.started_at,
            pid: h.pid,
        })
        .collect();
    out.sort_by_key(|s| s.started_at);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_state_default_is_empty() {
        let s = AgentState::default();
        let map = s.sidecars.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn sidecar_info_serializes_as_camel_case() {
        let info = SidecarInfo {
            session_id: "sid-1".into(),
            project_id: "pid-1".into(),
            cwd: "/tmp/x".into(),
            started_at: 12345,
            pid: 4242,
        };
        let s = serde_json::to_string(&info).unwrap();
        assert!(s.contains("\"sessionId\""));
        assert!(s.contains("\"projectId\""));
        assert!(s.contains("\"startedAt\""));
        assert!(s.contains("\"pid\""));
        assert!(!s.contains("session_id"));
        assert!(!s.contains("started_at"));
    }

    #[test]
    fn now_unix_ms_is_positive() {
        let t = now_unix_ms();
        assert!(t > 0);
    }

    /// DEC-063: event prefix が session_id 単位になっていることを契約として固定。
    #[test]
    fn event_name_format_is_session_keyed() {
        let sid = "00000000-0000-0000-0000-000000000001";
        let raw = format!("agent:{sid}:raw");
        let stderr = format!("agent:{sid}:stderr");
        let terminated = format!("agent:{sid}:terminated");
        assert_eq!(raw, "agent:00000000-0000-0000-0000-000000000001:raw");
        assert_eq!(stderr, "agent:00000000-0000-0000-0000-000000000001:stderr");
        assert_eq!(
            terminated,
            "agent:00000000-0000-0000-0000-000000000001:terminated"
        );
    }

    #[test]
    fn drain_kill_all_is_safe_on_empty_state() {
        let s = AgentState::default();
        s.drain_kill_all();
        s.drain_kill_all();
        let map = s.sidecars.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn agent_state_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AgentState>();
    }

    /// DEC-063: bundled mode で `--session-id` と `--project-id` が argv に必ず付く。
    #[test]
    fn build_sidecar_args_bundled_minimal() {
        let args = build_sidecar_args(SidecarMode::Bundled, "sid-1", "pid-1", None, None);
        assert_eq!(
            args,
            vec![
                "dist/index.mjs".to_string(),
                "--session-id=sid-1".to_string(),
                "--project-id=pid-1".to_string()
            ]
        );
    }

    /// DEC-063: dev mode で tsx runtime arg 3 つ + session-id / project-id が並ぶ。
    #[test]
    fn build_sidecar_args_dev_minimal() {
        let args = build_sidecar_args(SidecarMode::Dev, "sid-2", "pid-2", None, None);
        assert_eq!(args.len(), 5);
        assert_eq!(args[0], "--import");
        assert_eq!(args[1], "node_modules/tsx/dist/esm/index.mjs");
        assert_eq!(args[2], "src/index.ts");
        assert_eq!(args[3], "--session-id=sid-2");
        assert_eq!(args[4], "--project-id=pid-2");
    }

    #[test]
    fn build_sidecar_args_with_model() {
        let args = build_sidecar_args(
            SidecarMode::Bundled,
            "sid",
            "pid",
            Some("claude-opus-4-7"),
            None,
        );
        assert!(args.contains(&"--model=claude-opus-4-7".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--thinking-tokens=")));
    }

    #[test]
    fn build_sidecar_args_with_thinking_tokens() {
        let args = build_sidecar_args(SidecarMode::Bundled, "sid", "pid", None, Some(8192));
        assert!(args.contains(&"--thinking-tokens=8192".to_string()));
    }

    #[test]
    fn build_sidecar_args_with_model_and_thinking() {
        let args = build_sidecar_args(
            SidecarMode::Dev,
            "sid",
            "pid",
            Some("claude-sonnet-4-6"),
            Some(32768),
        );
        assert!(args.contains(&"--model=claude-sonnet-4-6".to_string()));
        assert!(args.contains(&"--thinking-tokens=32768".to_string()));
        assert!(args.contains(&"--session-id=sid".to_string()));
        assert!(args.contains(&"--project-id=pid".to_string()));
    }

    #[test]
    fn build_sidecar_args_empty_model_is_skipped() {
        let args = build_sidecar_args(SidecarMode::Bundled, "sid", "pid", Some(""), None);
        assert!(!args.iter().any(|a| a.starts_with("--model=")));
    }

    /// DEC-063: plansDirectory が session 単位 (/.claude/plans/<session_id>) に細分化される。
    #[test]
    fn plans_directory_is_session_scoped() {
        let cwd = "/home/user/myproject";
        let sid = "11111111-2222-3333-4444-555555555555";
        let expected = format!("{cwd}/.claude/plans/{sid}");
        assert_eq!(expected, "/home/user/myproject/.claude/plans/11111111-2222-3333-4444-555555555555");
        assert!(expected.ends_with(sid));
        assert!(expected.contains("/.claude/plans/"));
    }

    /// DEC-063: MAX_CONCURRENT_SIDECARS が 8 であることを契約として固定。
    #[test]
    fn max_concurrent_sidecars_is_eight() {
        assert_eq!(MAX_CONCURRENT_SIDECARS, 8);
    }

    /// permission_response NDJSON shape (不変、互換保持)。
    #[test]
    fn permission_response_ndjson_shape_is_stable() {
        let decision = serde_json::json!({
            "behavior": "allow",
            "updatedInput": { "query": "anthropic news" }
        });
        let req = serde_json::json!({
            "type": "permission_response",
            "request_id": "abc-123",
            "decision": decision,
        });
        let s = req.to_string();
        assert!(s.contains("\"type\":\"permission_response\""));
        assert!(s.contains("\"request_id\":\"abc-123\""));
        assert!(s.contains("\"behavior\":\"allow\""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn job_object_create_does_not_block_state_construction() {
        let s = AgentState::default();
        assert!(s.sidecars.lock().unwrap().is_empty());
    }
}
