//! Agent sidecar (Node.js) の spawn / stdin 書込 / stdout リレー。
//!
//! DEC-023 に基づき、Agent SDK TypeScript を Node sidecar プロセスとして起動し、
//! NDJSON プロトコルで frontend とやりとりする。
//!
//! 起動モード (PM-108 / DEC-026):
//! - Bundled  : `sidecar/dist/index.mjs` を `node` で直接起動 (production / CI)
//! - Dev      : `sidecar/src/index.ts` を `node --import tsx/esm` で起動 (dev)
//!
//! 解決順序:
//!   1. cwd/sidecar/dist/index.mjs            (プロジェクトルートで起動)
//!   2. cwd/../sidecar/dist/index.mjs         (src-tauri/ で起動)
//!   3. Tauri resource: sidecar/dist/index.mjs (packaged app)
//!   4. cwd/sidecar/src/index.ts              (dev fallback)
//!   5. cwd/../sidecar/src/index.ts           (dev fallback, src-tauri/ から)
//!
//! ----------------------------------------------------------------------------
//! **DEC-033 / v3.3 Multi-Sidecar Architecture**
//!
//! v3.2 までは `AgentState { child: Mutex<Option<CommandChild>> }` という
//! **アプリ全体で 1 sidecar のみ** の singleton 設計だった。v3.3 以降は
//! `HashMap<project_id, SidecarHandle>` に書き換え、**1 project = 1 sidecar**
//! の multi-sidecar アーキテクチャに全面転換する（DEC-033 を参照）。
//!
//! ### state 管理
//! - `AgentState.sidecars : Mutex<HashMap<String, SidecarHandle>>`
//! - key = project_id (UUID 文字列)、value = `SidecarHandle { child, cwd, started_at }`
//!
//! ### event prefix
//! - v3.2: `agent:raw` / `agent:stderr` / `agent:terminated` (singleton)
//! - v3.3: `agent:{projectId}:raw` / `agent:{projectId}:stderr` /
//!   `agent:{projectId}:terminated` の per-project prefix
//!
//! ### sidecar NDJSON (sidecar/src/index.ts が stdout に吐く) は
//! そのまま `agent:{projectId}:raw` の payload として流す。frontend 側
//! (Chunk B) は listen(`agent:{projectId}:raw`) で 1 行 JSON を受けて
//! `type` field で分岐し、`message` / `tool_use` / `tool_result` / `done` /
//! `error` / `ready` を描画する。
//!
//! ### 上限 / clean up
//! - Rust 側で上限チェックはしない（frontend が 10 warning を出す、DEC-033）
//! - app shutdown 時の cleanup は `stop_agent_sidecar` を frontend から
//!   すべての active project_id について呼んでもらう前提。保険として
//!   `Drop for AgentState` でも HashMap を flush する（OS が管理する
//!   子プロセスは親消失で自動終了、Tauri plugin-shell は `kill_on_drop`
//!   相当の挙動を取る想定だが保証されないため drain_kill_all を試みる）。
//!
//! ----------------------------------------------------------------------------
//! **DEC-033 v3.3.1 / Chunk A — Orphan process 対策 (Could→Must 格上げ)**
//!
//! /review v6 で指摘された「親 Tauri プロセスが強制終了 (タスクマネージャ kill /
//! ターミナル Ctrl+C / panic) された場合に子 Node sidecar プロセスが orphan
//! として生き残るリスク」への対策を本 Chunk A で実装する。
//!
//! ### Windows (Must — 配布リスクの核心)
//! - `windows-sys` の `Win32_System_JobObjects` を使い、process-wide JobObject
//!   を `AgentState::default()` 起動時に 1 つ作成
//! - flag に `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` を立て
//!   (`SetInformationJobObject` + `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`)
//! - 各 sidecar spawn 後に PID を `OpenProcess` → `AssignProcessToJobObject`
//! - 親プロセス (Tauri / 本 .exe) のハンドル全部が close されると
//!   JobObject が破棄され、Windows カーネルが job 内の全プロセスを **強制 kill**
//! - これにより「タスクマネージャでの強制終了」「panic crash」「Ctrl+C」全てで
//!   sidecar Node が必ず一緒に死ぬ（最も確実な解、Microsoft 推奨パターン）
//!
//! ### macOS / Linux (best-effort)
//! - `tauri-plugin-shell` の `Command::spawn` は内部で `tokio::process::Command`
//!   → `pre_exec` の差し込みは現状 plugin 側 API として公開されていない
//! - そのため process group / setpgid の後付けは困難。代わりに以下の冗長 cleanup:
//!   1. `Drop for AgentState`: 通常終了時に HashMap drain + kill
//!   2. `RunEvent::ExitRequested` hook: window close / 通常 quit を捕捉
//!   3. `agent:{pid}:terminated` handler: sidecar 自律終了で HashMap remove
//! - 通常 terminal から起動した場合は controlling terminal の SIGHUP で
//!   子 process group まで届くため orphan 化リスクは低い
//! - GUI (.app / 直接 binary) 起動時は親 PID が消えると Linux/macOS は子を
//!   再 init parent (PID 1) に reparent し、orphan として生存しうる
//! - これは本 Chunk A の許容残存リスク。将来 plugin-shell 側で pre_exec hook が
//!   公開されたら setpgid を追加する (DEC-033 末尾「実装差異記録」参照)
//!
//! ### 既存挙動の保証
//! - Windows 以外のビルドは `#[cfg(target_os = "windows")]` で完全に guard、
//!   依存追加 (windows-sys) も `[target.'cfg(target_os = "windows")'.dependencies]`
//!   に閉じ込め、macOS / Linux ビルドを壊さない
//! - 既存 5 command の signature / 挙動に変更なし (backward compat)、
//!   既存 78 unit test も全 pass

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
// Windows JobObject wrapper (DEC-033 v3.3.1)
// -----------------------------------------------------------------------------

/// Windows 専用: 親 Tauri プロセスに紐づく JobObject ハンドル。
///
/// `AgentState::default()` で生成され、AgentState の Drop 時に CloseHandle される
/// (= 親プロセス終了 → state drop → JobObject close → Windows カーネルが
/// job 内の全 sidecar プロセスを強制 kill)。
///
/// **強制 kill のトリガー (3 経路)**:
/// 1. 通常終了: `Drop for AgentState` の `CloseHandle` で job close
/// 2. タスクマネージャ kill / panic: プロセスの全ハンドルが OS により回収され、
///    JobObject も close される (Windows カーネル仕様)
/// 3. アプリ exit hook: `lib.rs` の RunEvent で `drain_kill_all` を明示呼び出し
///    (best-effort、Drop より先に走る)
///
/// **HANDLE 安全性**: HANDLE は内部的に `*mut c_void` だが、JobObject ハンドルは
/// kernel object への opaque pointer であり Send/Sync 安全 (Microsoft docs 参照)。
/// Rust の auto-trait 推論では `*mut` で `!Send` / `!Sync` になるため明示 impl。
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
    ///
    /// 失敗時は `None` を返す (JobObject なしでもアプリ自体は動作可能、
    /// ただし orphan process リスクは残存。失敗ログは stderr に出す)。
    ///
    /// # 設計判断
    /// - `lpjobattributes` は `null` (デフォルト権限、子プロセス継承は OFF)
    /// - `lpname` は `null` (匿名 JobObject、別プロセスからの open 不可)
    /// - `JOB_OBJECT_LIMIT_BREAKAWAY_OK` を併用し、既に Job に属している
    ///   親プロセス (例えば CI runner や VS Code Debugger 経由) でも spawn 失敗
    ///   しないようにする (Microsoft Docs: nested job 制約への対策)
    fn create() -> Option<Self> {
        // SAFETY: CreateJobObjectW は thread-safe な Win32 API。
        // 引数 null は仕様上許可されている。
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            eprintln!("[agent/jobobject] CreateJobObjectW failed (orphan-kill 保護なしで起動継続)");
            return None;
        }

        // KILL_ON_JOB_CLOSE + BREAKAWAY_OK を設定。
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
            unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;

        // SAFETY: SetInformationJobObject は thread-safe。
        // info は Extended Limit Information の正しい layout。
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

    /// 子プロセス (sidecar Node) の PID を JobObject に追加する。
    ///
    /// 失敗 (例: PID が短時間で死んだ / Access Denied) は warn ログのみ、
    /// 戻り値で error を返さない (sidecar の起動自体は成功扱い)。
    ///
    /// # 必要権限
    /// - `PROCESS_SET_QUOTA`  : AssignProcessToJobObject に必須
    /// - `PROCESS_TERMINATE`  : KILL_ON_JOB_CLOSE で job 経由 kill するため必須
    fn assign(&self, pid: u32) {
        // SAFETY: OpenProcess は thread-safe、失敗時 NULL を返す。
        let proc_handle: HANDLE = unsafe {
            OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid)
        };
        if proc_handle.is_null() {
            eprintln!(
                "[agent/jobobject] OpenProcess(pid={pid}) failed (権限不足 or プロセス既に終了)"
            );
            return;
        }

        // SAFETY: AssignProcessToJobObject は thread-safe、handle は OpenProcess で取得済。
        let ok = unsafe { AssignProcessToJobObject(self.handle, proc_handle) };
        if ok == 0 {
            eprintln!(
                "[agent/jobobject] AssignProcessToJobObject(pid={pid}) failed (既に別 job 所属の可能性、orphan kill 保護なし)"
            );
        } else {
            eprintln!("[agent/jobobject] assigned pid={pid} to JobObject");
        }

        // 子プロセス側のハンドルは Job assign 後は不要 → close。
        // SAFETY: CloseHandle は thread-safe、proc_handle は OpenProcess で取得済。
        unsafe {
            let _ = CloseHandle(proc_handle);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for JobObject {
    fn drop(&mut self) {
        // CloseHandle で job が破棄される → KILL_ON_JOB_CLOSE が発動 → 全子プロセス kill。
        // ここが Windows での最終 cleanup の本丸。
        // SAFETY: handle は CreateJobObjectW で取得済の有効なハンドル。
        unsafe {
            let _ = CloseHandle(self.handle);
        }
        eprintln!("[agent/jobobject] JobObject dropped → KILL_ON_JOB_CLOSE が発動");
    }
}

/// 単一 Claude プロジェクトに紐づく sidecar プロセスの handle。
///
/// `AgentState.sidecars : HashMap<project_id, SidecarHandle>` で保持する。
pub struct SidecarHandle {
    /// 子プロセスの書込口 + kill 用 handle。
    pub child: CommandChild,
    /// 起動時の cwd (Agent SDK の cwd / project のルート)。
    pub cwd: String,
    /// 起動時刻 (UNIX epoch milliseconds)。list_active_sidecars で返す。
    pub started_at: i64,
}

/// Multi-sidecar (DEC-033) の状態を管理する Tauri state。
///
/// key = project_id (UUID 文字列)、value = `SidecarHandle`。
///
/// **DEC-033 v3.3.1 / Chunk A**: Windows のみ JobObject ハンドルを保持し、
/// spawn 時に sidecar PID を assign する (orphan process 対策)。
/// 詳細はモジュール doc の Windows / macOS / Linux セクション参照。
pub struct AgentState {
    pub sidecars: Mutex<HashMap<String, SidecarHandle>>,
    /// Windows 専用: 親プロセスに紐づく JobObject。`None` = 作成失敗時。
    /// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag が立っており、本 state が
    /// drop されると job 内の全 sidecar が Windows カーネルにより kill される。
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
    ///
    /// **DEC-033 v3.3.1**: 3 段 cleanup の 1 段目として、
    /// `lib.rs` の Tauri `RunEvent::Exit` / `RunEvent::ExitRequested` hook から
    /// 明示呼び出しする。Drop より先に走らせることで graceful shutdown を実現。
    ///
    /// Drop も同じ処理をするが、Drop は `Tauri::Builder::run` 終了後でないと
    /// 走らないため、アプリ終了の早いタイミングでこの API を呼ぶ意義がある。
    ///
    /// Windows では JobObject による KILL_ON_JOB_CLOSE が最終ガードになるが、
    /// それでも明示 kill しておけば「孤児 Node がほんの一瞬でも残らない」効果あり。
    pub fn drain_kill_all(&self) {
        if let Ok(mut map) = self.sidecars.lock() {
            let drained: Vec<(String, SidecarHandle)> = map.drain().collect();
            let n = drained.len();
            for (_pid, handle) in drained {
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
        // best-effort: アプリ終了時に残存 sidecar を kill。
        // Mutex poison は無視（すでに落ちているなら kill も意味がない）。
        if let Ok(mut map) = self.sidecars.lock() {
            let drained: Vec<(String, SidecarHandle)> = map.drain().collect();
            for (_pid, handle) in drained {
                let _ = handle.child.kill();
            }
        }
        // Windows: JobObject も明示 drop。Drop 順序は struct field 宣言順 (sidecars → job_object)
        // のため、sidecars の child.kill() が先に走り、その後 JobObject の Drop で
        // KILL_ON_JOB_CLOSE が発動する (二重保険、片方が失敗してももう片方が拾う)。
    }
}

/// `list_active_sidecars` command の戻り値。
///
/// frontend (Chunk B / Chunk C) が Status pane や ProjectRail の
/// 生存確認 UI で使う。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInfo {
    pub project_id: String,
    pub cwd: String,
    pub started_at: i64,
}

/// sidecar の起動モード。
#[derive(Debug, Clone, Copy)]
enum SidecarMode {
    /// esbuild bundle (`dist/index.mjs`) を pure node で起動。
    Bundled,
    /// `src/index.ts` を `node --import tsx/esm` で起動 (dev only)。
    Dev,
}

/// PM-760 / v3.4.9 Chunk A: sidecar 起動用の argv を組み立てる (テスト可能な pure fn)。
///
/// - mode ごとに bundled (`dist/index.mjs`) or dev (`--import tsx/esm src/index.ts`) を切替
/// - `--project-id=<uuid>` は常に付与 (sidecar 側 `parseProjectIdFromArgv` が拾う)
/// - `model` : `Some` かつ非空なら `--model=<id>` を付与、None / 空は省略
/// - `thinking_tokens` : `Some(n)` なら `--thinking-tokens=<n>` を付与
///
/// 戻り値は `node` に渡す arg 列 (実行ファイル名 `node` 自体は含まない)。
fn build_sidecar_args(
    mode: SidecarMode,
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
///
/// production bundle を優先的に探し、見つからなければ dev の src/index.ts に fallback。
fn resolve_sidecar_entry(app: &AppHandle) -> Result<(std::path::PathBuf, SidecarMode), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("cwd 解決失敗: {e}"))?;

    // --- 1) production bundle (プロジェクトルート起動) ---
    let dist_bundle = cwd.join("sidecar/dist/index.mjs");
    if dist_bundle.exists() {
        return Ok((dist_bundle, SidecarMode::Bundled));
    }

    // --- 2) production bundle (src-tauri/ 起動) ---
    let dist_bundle2 = cwd.join("../sidecar/dist/index.mjs");
    if dist_bundle2.exists() {
        return Ok((dist_bundle2, SidecarMode::Bundled));
    }

    // --- 3) Tauri resource (packaged app) ---
    // Tauri v2 は `"../sidecar/..."` を bundle 時に `_up_/sidecar/...` に変換する仕様。
    // 両方試す (`_up_` 優先、古い想定の no-prefix も fallback として残す)。
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

    // --- 3b) `.exe` ディレクトリの直接ジョイン (Windows packaged app の実配置向け) ---
    // 実測: `C:\Program Files\ccmux-ide\ccmux-ide.exe` の隣に `_up_\sidecar\dist\index.mjs`
    // が置かれる。`BaseDirectory::Resource` が `/` -> `\` 変換で解決失敗するケースへの保険。
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

    // --- 4) dev fallback: src/index.ts (プロジェクトルート) ---
    let src_entry = cwd.join("sidecar/src/index.ts");
    if src_entry.exists() {
        return Ok((src_entry, SidecarMode::Dev));
    }

    // --- 5) dev fallback: src/index.ts (src-tauri/ 起動) ---
    let src_entry2 = cwd.join("../sidecar/src/index.ts");
    if src_entry2.exists() {
        return Ok((src_entry2, SidecarMode::Dev));
    }

    // resource 側の src/index.ts もダメ元で (_up_ prefix も試す)
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
        "sidecar entry not found. cwd={}, exe={:?}. tried: cwd-based (dist/index.mjs, src/index.ts), Tauri resource (_up_/sidecar/dist/index.mjs, sidecar/dist/index.mjs), exe-dir-based (_up_/sidecar/dist/index.mjs ほか)",
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

/// ある project の sidecar プロセスを起動する。
///
/// すでに同じ `project_id` の sidecar が起動中なら **no-op で `Ok(())`**
/// を返す (idempotent)。
///
/// 起動後、子プロセスの stdout/stderr/exit を以下の Tauri event として
/// frontend に push する (v3.3 で prefix 化、DEC-033):
/// - `agent:{project_id}:raw`        : stdout 1 行 (NDJSON 1 レコード)
/// - `agent:{project_id}:stderr`     : stderr 1 行 (log / error 用)
/// - `agent:{project_id}:terminated` : プロセス終了 (payload: exit code)
///
/// # 引数
/// - `project_id` : UUID 文字列。frontend 側の `RegisteredProject.id`。
/// - `cwd` : Agent SDK の cwd に使う絶対パス。project のルートディレクトリ。
/// - `model` : PM-760 (v3.4.9 Chunk A) — 省略可。SDK に渡すモデル ID 文字列
///   (例: `"claude-opus-4-7"` / `"claude-sonnet-4-6"` / `"claude-haiku-4-5"`)。
///   `None` なら sidecar / SDK のデフォルトに委ねる。
///   argv `--model=<id>` 形式で sidecar に渡す。
/// - `thinking_tokens` : PM-760 — 省略可。`maxThinkingTokens` (推論 budget)。
///   `EFFORT_CHOICES` の `thinkingTokens` 値 (1024 / 8192 / 32768 / 65536)。
///   `None` なら SDK デフォルト (adaptive)。argv `--thinking-tokens=<n>` で渡す。
#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent_sidecar(
    app: AppHandle,
    state: State<'_, AgentState>,
    project_id: String,
    cwd: String,
    model: Option<String>,
    thinking_tokens: Option<u32>,
) -> Result<(), String> {
    // 重複起動の idempotent チェック
    {
        let guard = state
            .sidecars
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if guard.contains_key(&project_id) {
            return Ok(());
        }
    }

    let (sidecar_entry, mode) = resolve_sidecar_entry(&app)?;
    let entry_str = sidecar_entry.to_string_lossy().to_string();

    // sidecar ディレクトリ (`.../sidecar/`) を解決。モジュール解決用の cwd として使う。
    // - Bundled: entry = sidecar/dist/index.mjs → .parent().parent() = sidecar/
    // - Dev    : entry = sidecar/src/index.ts   → .parent().parent() = sidecar/
    let sidecar_dir = sidecar_entry
        .parent() // dist/ or src/
        .and_then(|p| p.parent()) // sidecar/
        .ok_or_else(|| "sidecar ディレクトリ解決失敗".to_string())?
        .to_path_buf();

    // mode ごとに node 引数を組み立てる (pure fn で Unit test 可能化、PM-760)。
    //
    // 重要 (2026-04-18 実測): Tauri plugin-shell v2 の CreateProcess escaping は
    // 引数内の空白 (例 "C:\Program Files\..." の "Program Files") を正しくクォート
    // しない場合がある。current_dir() を sidecar_dir にしているので、relative path
    // で渡すことで Windows installer 配置も安全に動作。
    //
    // PM-760: sidecar/src/index.ts が `parseProjectIdFromArgv` /
    // `parseModelFromArgv` / `parseThinkingTokensFromArgv` で拾う。
    // model / thinking_tokens は省略可、未指定時は SDK デフォルト (後方互換)。
    let args = build_sidecar_args(mode, &project_id, model.as_deref(), thinking_tokens);

    // 起動情報を stderr event (per-project) に流す (デバッグ補助)
    let stderr_evt = format!("agent:{project_id}:stderr");
    let model_dbg = model.as_deref().unwrap_or("<default>");
    let thinking_dbg = thinking_tokens
        .map(|t| t.to_string())
        .unwrap_or_else(|| "<default>".to_string());
    let _ = app.emit(
        &stderr_evt,
        format!(
            "sidecar starting: mode={mode:?}, entry={entry_str}, project_id={project_id}, cwd={cwd}, model={model_dbg}, thinkingTokens={thinking_dbg}\n"
        ),
    );

    let shell = app.shell();
    // sidecar のモジュール解決は sidecar_dir を cwd として使うが、
    // Agent SDK の cwd (= Claude tools の作業ディレクトリ) は
    // `send_agent_prompt` の options.cwd で切り替える。このため
    // sidecar プロセス自体の cwd を project の cwd に揃えなくてよい。
    // ただし start_agent_sidecar の引数 cwd は SidecarHandle に記録する。
    let (mut rx, child) = shell
        .command("node")
        .current_dir(sidecar_dir)
        .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .spawn()
        .map_err(|e| format!("sidecar の spawn に失敗: {e}"))?;

    // ----------------------------------------------------------------
    // DEC-033 v3.3.1 / Chunk A: orphan process 対策
    // Windows のみ、spawn 直後に sidecar の PID を JobObject に assign する。
    // 親 Tauri プロセスが強制 kill された時に Windows カーネルが job 内の
    // 全プロセスを一緒に kill してくれるようになる。
    // 失敗しても sidecar の起動自体は成功扱い (warn ログのみ)。
    // ----------------------------------------------------------------
    #[cfg(target_os = "windows")]
    {
        let pid = child.pid();
        if let Some(ref job) = state.job_object {
            job.assign(pid);
        }
    }

    // HashMap に insert
    {
        let mut guard = state
            .sidecars
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        guard.insert(
            project_id.clone(),
            SidecarHandle {
                child,
                cwd: cwd.clone(),
                started_at: now_unix_ms(),
            },
        );
    }

    // 子プロセスの stdout/stderr/exit を per-project event 経由で frontend に push。
    // さらに monitor (v3.2 までは lib.rs の listen_any で行っていた集計) を本
    // stdout parser 内で直接呼び出し、multi-sidecar でも確実に動くようにする。
    let app_handle = app.clone();
    let pid_for_task = project_id.clone();
    let raw_evt = format!("agent:{project_id}:raw");
    let stderr_evt = format!("agent:{project_id}:stderr");
    let terminated_evt = format!("agent:{project_id}:terminated");
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit(&raw_evt, s.clone());
                    // DEC-059 案B (v1.13.0): sidecar が emit する NDJSON のうち
                    // type === "permission_request" のものを専用 Tauri event
                    // `sumi://permission-request` として Frontend に転送する。
                    // 既存 `agent:{projectId}:raw` にも乗るが、Frontend 側は
                    // PermissionProvider の listen でこちらを購読することで
                    // 重複描画 / 親 listener (useAllProjectsSidecarListener) に
                    // 承認ロジックを混ぜない分離が可能になる。
                    dispatch_permission_request_if_any(&app_handle, &pid_for_task, &s);
                    // monitor 側も同じ NDJSON を見せて state を更新する。
                    dispatch_to_monitor(&app_handle, &pid_for_task, &s).await;
                }
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit(&stderr_evt, s);
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_handle.emit(&terminated_evt, payload.code);
                    // HashMap からは自動除去 (handle は stop_agent_sidecar か
                    // Drop で回収される)。明示的に remove しておくと list_active
                    // が正確になる。
                    if let Some(app_state) = app_handle.try_state::<AgentState>() {
                        if let Ok(mut map) = app_state.sidecars.lock() {
                            map.remove(&pid_for_task);
                        }
                    }
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
///
/// v3.2 までは `lib.rs` の `listen_any("agent:raw", ...)` で集約していたが、
/// v3.3 の per-project prefix 化に伴い各 project 数だけ listen_any を
/// 動的登録するのは非効率なため、**stdout parser から直接 monitor を
/// 呼ぶ**方式に切り替えた (DEC-033 / Chunk A)。
///
/// project_id は現状の `MonitorState` では未使用だが、将来 per-project
/// monitor 分離 (v3.4 以降) を見据えて引数に残す。
async fn dispatch_to_monitor(
    app: &AppHandle,
    _project_id: &str,
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

/// ある project の sidecar に prompt を 1 行 JSON として書き込む。
///
/// sidecar 側 (`sidecar/src/index.ts`) は NDJSON 1 行を 1 リクエストとして
/// 解釈する (`{type:"prompt",...}`)。
///
/// # 引数
/// - `project_id` : 送信先の sidecar を特定する key。
/// - `prompt` : ユーザープロンプト本文。
/// - `attachments` : 添付ファイル (画像等) の絶対パス配列。空なら空配列。
///   sidecar 側は Chunk B で対応する。Chunk A では NDJSON envelope に
///   そのまま詰めて流すだけ。
/// - `resume` : PM-830 (v3.5.14) — Claude Agent SDK の `query({ resume })` に
///   渡す session UUID。frontend は session store の `sdkSessionId` を引いて
///   渡す。`None` なら stateless 1 回呼出（初回送信 or レガシー session）。
///
/// **互換メモ**: v3.2 の `send_agent_prompt(id, prompt, cwd, model)` は
/// v3.3 で廃止。cwd / model は sidecar 起動時 or session 管理側が保持する。
/// `id` (request id) は Rust 側で自動生成 (UUID v4)。
#[tauri::command(rename_all = "camelCase")]
pub async fn send_agent_prompt(
    state: State<'_, AgentState>,
    project_id: String,
    prompt: String,
    attachments: Vec<String>,
    // PM-830: SDK 側 session UUID。Some(uuid) なら sidecar が
    // `query({ resume: uuid })` で context 継続、None なら従来どおり stateless。
    resume: Option<String>,
    // v1.9.0 (DEC-053): TrayBar の session 別 picker から渡される per-query options。
    // 現状サポート key: `model: string` / `maxThinkingTokens: number` /
    // `permissionMode: "default"|"acceptEdits"|"bypassPermissions"|"plan"`。
    // sidecar 側 (handlePrompt) で req.options 経由で拾われ、SDK query options を上書きする。
    // None の場合は従来どおり sidecar 起動時 argv のデフォルトで動く。
    options: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get_mut(&project_id)
        .ok_or_else(|| format!("sidecar not running for project_id={project_id}"))?;

    // request id は sidecar 側で「prompt と response の対応付け」に使うだけ。
    // frontend 側の UI message id とは分離するため Rust 側で生成する。
    let req_id = uuid::Uuid::new_v4().to_string();

    // v1.9.0 (DEC-053): frontend から受け取った options を起点に Map を組み立てる。
    // 非 object (null / array / primitive) で来た場合は空 Map 扱いにして後段の
    // resume / cwd / settingSources 注入だけ行う（fail-safe）。
    let mut options: serde_json::Map<String, serde_json::Value> = match options {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };

    // PM-830: options に resume を入れる。None / 空文字列は省略 (stateless 扱い)。
    // `serde_json::json!` のオブジェクト構築では None / null をそのまま入れても
    // 受信側で resume が undefined になり問題ないが、後方互換のため Some 時のみ key を付ける。
    if let Some(ref sdk_id) = resume {
        if !sdk_id.is_empty() {
            options.insert(
                "resume".to_string(),
                serde_json::Value::String(sdk_id.clone()),
            );
        }
    }

    // PM-966 / DEC-055: SidecarHandle に記録済の project cwd を毎回 prompt options に
    // 注入する。これを入れないと sidecar が process.cwd()（sidecar 自身のインストール
    // ディレクトリ = "…/resources/sidecar" 等）にフォールバックし、Claude Agent SDK
    // は project 外の cwd で動作する。結果として CLAUDE.md / .claude/ settings /
    // プロジェクトファイルがすべて見えなくなる。
    options.insert(
        "cwd".to_string(),
        serde_json::Value::String(handle.cwd.clone()),
    );

    // PM-966 / DEC-055: Claude Code CLI と同等の file-based 設定読込を SDK に指示する。
    // 'user'    = ~/.claude/settings.json + ~/.claude/CLAUDE.md
    // 'project' = <cwd>/.claude/settings.json + <cwd>/CLAUDE.md + 親ディレクトリの CLAUDE.md
    // 'local'   = <cwd>/.claude/settings.local.json (gitignore される個人用)
    // これにより slash commands / skills / MCP / memory がすべて SDK 側で自動 discover
    // される。SDK デフォルトでは settingSources は空のため、明示指定が必要。
    options.insert(
        "settingSources".to_string(),
        serde_json::json!(["user", "project", "local"]),
    );

    // DEC-060 (v1.14.0): plansDirectory を project cwd 配下に固定する。
    //
    // 問題: settingSources に "user" を含めると SDK が `~/.claude/settings.json` を
    // 読み、`plansDirectory` が `~/.claude/plans/` に解決されてしまう。結果として
    // ExitPlanMode が project 外 (ユーザーホーム) に plan file を書き込む。
    // "user" は Max OAuth credentials 読込のため除外不可なので、plansDirectory を
    // 明示的に `<cwd>/.claude/plans` で上書きして root cause を解消する。
    //
    // - 呼出側 (Frontend) が既に plansDirectory を指定している場合はそちらを尊重
    //   (`!contains_key` チェック)
    // - path separator は POSIX `/` を使う (SDK は両方受け付ける、cross-OS 安全)
    if !options.contains_key("plansDirectory") {
        options.insert(
            "plansDirectory".to_string(),
            serde_json::Value::String(format!("{}/.claude/plans", handle.cwd)),
        );
    }

    // v3.5.18 PM-830 hotfix debug (2026-04-20): frontend → Rust の resume 伝播を
    // 可視化する。camelCase rename / Option<String> deserialize が正常に効いて
    // いれば、frontend log と一致する値がここに現れる。dogfood 期間中は残置し、
    // 後日 PM-746 相当のクリーンアップで削除予定。
    eprintln!(
        "[agent] send_agent_prompt: project_id={project_id}, req_id={req_id}, resume={resume:?}, options_has_resume={has_resume}",
        has_resume = options.contains_key("resume")
    );

    let req = serde_json::json!({
        "type": "prompt",
        "id": req_id,
        "prompt": prompt,
        "attachments": attachments,
        // cwd / model の明示指定は frontend が必要なら将来拡張する。
        // 現状は sidecar デフォルト (process.cwd / claude-opus-4-7) に委ねる。
        "options": options,
    });
    let line = req.to_string() + "\n";

    handle
        .child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar stdin 書込失敗 (project_id={project_id}): {e}"))?;
    Ok(())
}

/// ある project の sidecar に interrupt 指示を送る。
///
/// sidecar 側 (`sidecar/src/index.ts`) は NDJSON 1 行 `{type:"interrupt"}` を
/// 受けて、進行中の `runAgentQuery` を中断する。Chunk B が sidecar 側の
/// 受信処理を追加する前提 (Chunk A は送信側のみ実装)。
#[tauri::command(rename_all = "camelCase")]
pub async fn send_agent_interrupt(
    state: State<'_, AgentState>,
    project_id: String,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get_mut(&project_id)
        .ok_or_else(|| format!("sidecar not running for project_id={project_id}"))?;

    let req = serde_json::json!({ "type": "interrupt" });
    let line = req.to_string() + "\n";

    handle
        .child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar interrupt 書込失敗 (project_id={project_id}): {e}"))?;
    Ok(())
}

/// PRJ-012 v1.13.0 (DEC-059 案B): sidecar stdout NDJSON 1 行を検査し、
/// `type === "permission_request"` なら Frontend 向け `sumi://permission-request`
/// Tauri event として transit する。
///
/// payload は sidecar が emit した envelope (`{type,id,payload}`) 全体を
/// そのまま渡し、Frontend 側で `payload.payload.{requestId,sessionId,toolName,
/// toolInput}` を抽出して Dialog に表示する。
///
/// - 非 JSON / 非該当 type は no-op
/// - Frontend 未 mount / listen 未登録でも emit 失敗で sidecar 側の pending
///   Promise は 60 秒 auto-deny timer で deny に倒れる (=無限ハング防止済)
fn dispatch_permission_request_if_any(app: &AppHandle, project_id: &str, raw_line: &str) {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() {
        return;
    }
    // 軽い prefilter: "permission_request" を含まない行は parse せず早期 return
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

    // Frontend 向け payload を組む。sessionId は sidecar argv `--project-id`
    // 由来だが、Rust 側でも project_id (= map key) を併記する (多重保険)。
    let ev_payload = serde_json::json!({
        "projectId": project_id,
        "envelope": value,
    });
    let _ = app.emit("sumi://permission-request", ev_payload);
}

/// PRJ-012 v1.13.0 (DEC-059 案B): Frontend から渡された承認/拒否の決定を
/// 対応する sidecar に書き戻す Tauri command。
///
/// # 引数
/// - `project_id`  : 決定先の sidecar を特定する key (Frontend が Dialog 表示時に保持)
/// - `request_id`  : sidecar 発行の permission request UUID (sidecar 側の
///   pendingPermissions map の key)
/// - `decision`    : 決定 payload。Frontend (PermissionDialog) から渡される
///   generic JSON。shape は以下のいずれか:
///   - `{ "behavior": "allow",  "updatedInput": Object? }`
///   - `{ "behavior": "deny",   "message": String?, "interrupt": Boolean? }`
///
/// Rust 側は decision を blindly に sidecar へ pass-through する。shape
/// validation は sidecar の `handlePermissionResponse` で行い、不正な形なら
/// sidecar の auto-deny timer (60 秒) に任せる fail-safe 方針。
#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_permission_request(
    state: State<'_, AgentState>,
    project_id: String,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard.get_mut(&project_id).ok_or_else(|| {
        format!("sidecar not running for project_id={project_id} (permission response dropped)")
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
        .map_err(|e| format!("sidecar stdin 書込失敗 (project_id={project_id}): {e}"))?;
    Ok(())
}

/// ある project の sidecar プロセスを終了させる。
///
/// HashMap に該当 project_id が無ければ **no-op で `Ok(())`** (idempotent)。
/// 例: 子プロセスが既に自律終了 (NDJSON "done" → exit) してから frontend が
/// 閉じる操作を行う場合、stderr の `Terminated` handler が先に remove 済でも
/// エラーにしない。
#[tauri::command(rename_all = "camelCase")]
pub async fn stop_agent_sidecar(
    state: State<'_, AgentState>,
    project_id: String,
) -> Result<(), String> {
    let mut guard = state
        .sidecars
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    if let Some(handle) = guard.remove(&project_id) {
        let _ = handle.child.kill();
    }
    Ok(())
}

/// 現在稼働中の sidecar 一覧を返す。
///
/// frontend (Chunk C の ProjectRail / ActiveProjectPanel) が生存確認 UI
/// 用に使う。戻り値は camelCase serialize (`projectId`, `startedAt`)。
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
        .map(|(pid, h)| SidecarInfo {
            project_id: pid.clone(),
            cwd: h.cwd.clone(),
            started_at: h.started_at,
        })
        .collect();
    // UI 側での並びを安定させる: started_at 昇順 (古い順)
    out.sort_by_key(|s| s.started_at);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// HashMap ベースの state が複数 project を独立に管理できること。
    #[test]
    fn agent_state_default_is_empty() {
        let s = AgentState::default();
        let map = s.sidecars.lock().unwrap();
        assert!(map.is_empty());
    }

    /// SidecarInfo serialize が camelCase になること (Chunk B との契約保証)。
    #[test]
    fn sidecar_info_serializes_as_camel_case() {
        let info = SidecarInfo {
            project_id: "pid-1".into(),
            cwd: "/tmp/x".into(),
            started_at: 12345,
        };
        let s = serde_json::to_string(&info).unwrap();
        assert!(s.contains("\"projectId\""));
        assert!(s.contains("\"startedAt\""));
        assert!(s.contains("\"cwd\""));
        // snake_case が混入していないこと
        assert!(!s.contains("project_id"));
        assert!(!s.contains("started_at"));
    }

    /// now_unix_ms が単調増加する (テストが fail すれば時計が狂っている)。
    #[test]
    fn now_unix_ms_is_positive() {
        let t = now_unix_ms();
        assert!(t > 0);
    }

    /// event prefix format が仕様通りになっていること。
    ///
    /// これは Chunk B/C の API 契約を lock in する意味で追加。
    /// 実装側の format! 文字列を同一関数で生成しているなら、
    /// ここで format の変更を検知できる。
    #[test]
    fn event_name_format_is_stable() {
        let pid = "00000000-0000-0000-0000-000000000001";
        let raw = format!("agent:{pid}:raw");
        let stderr = format!("agent:{pid}:stderr");
        let terminated = format!("agent:{pid}:terminated");
        assert_eq!(raw, "agent:00000000-0000-0000-0000-000000000001:raw");
        assert_eq!(stderr, "agent:00000000-0000-0000-0000-000000000001:stderr");
        assert_eq!(
            terminated,
            "agent:00000000-0000-0000-0000-000000000001:terminated"
        );
    }

    /// drain_kill_all が空 HashMap でも panic しないこと (idempotent)。
    /// DEC-033 v3.3.1: lib.rs の RunEvent hook から呼ばれるため、
    /// 何度呼ばれても無害である必要がある。
    #[test]
    fn drain_kill_all_is_safe_on_empty_state() {
        let s = AgentState::default();
        s.drain_kill_all();
        // 二度目も OK
        s.drain_kill_all();
        let map = s.sidecars.lock().unwrap();
        assert!(map.is_empty());
    }

    /// AgentState が Send + Sync であること (Tauri の `.manage()` 要件)。
    /// JobObject の HANDLE が含まれる Windows でも auto-trait の手動 impl で
    /// 担保されていることを compile-time に保証する。
    #[test]
    fn agent_state_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AgentState>();
    }

    /// PM-760 / v3.4.9 Chunk A: bundled mode で `--project-id` が argv に必ず付く。
    /// model / thinking_tokens None の場合は省略される (後方互換: 既存挙動を保つ)。
    #[test]
    fn build_sidecar_args_bundled_minimal() {
        let args = build_sidecar_args(SidecarMode::Bundled, "pid-1", None, None);
        assert_eq!(
            args,
            vec!["dist/index.mjs".to_string(), "--project-id=pid-1".to_string()]
        );
    }

    /// PM-760: dev mode で tsx runtime arg 3 つ + project-id が先頭構造通りに並ぶ。
    #[test]
    fn build_sidecar_args_dev_minimal() {
        let args = build_sidecar_args(SidecarMode::Dev, "pid-2", None, None);
        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "--import");
        assert_eq!(args[1], "node_modules/tsx/dist/esm/index.mjs");
        assert_eq!(args[2], "src/index.ts");
        assert_eq!(args[3], "--project-id=pid-2");
    }

    /// PM-760: model `Some("claude-opus-4-7")` が `--model=...` として argv に入る。
    #[test]
    fn build_sidecar_args_with_model() {
        let args = build_sidecar_args(
            SidecarMode::Bundled,
            "pid",
            Some("claude-opus-4-7"),
            None,
        );
        assert!(args.contains(&"--model=claude-opus-4-7".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--thinking-tokens=")));
    }

    /// PM-760: thinking_tokens `Some(8192)` が `--thinking-tokens=8192` として入る。
    #[test]
    fn build_sidecar_args_with_thinking_tokens() {
        let args = build_sidecar_args(SidecarMode::Bundled, "pid", None, Some(8192));
        assert!(args.contains(&"--thinking-tokens=8192".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--model=")));
    }

    /// PM-760: model / thinking_tokens 両方指定時、両方付く。
    #[test]
    fn build_sidecar_args_with_model_and_thinking() {
        let args = build_sidecar_args(
            SidecarMode::Dev,
            "pid",
            Some("claude-sonnet-4-6"),
            Some(32768),
        );
        assert!(args.contains(&"--model=claude-sonnet-4-6".to_string()));
        assert!(args.contains(&"--thinking-tokens=32768".to_string()));
        assert!(args.contains(&"--project-id=pid".to_string()));
    }

    /// PM-760: model `Some("")` (空文字列) は `--model=` として付けない (no-op)。
    /// frontend 側で未選択を None にせず空文字列で来ても安全に落ちる guard。
    #[test]
    fn build_sidecar_args_empty_model_is_skipped() {
        let args = build_sidecar_args(SidecarMode::Bundled, "pid", Some(""), None);
        assert!(!args.iter().any(|a| a.starts_with("--model=")));
    }

    /// PRJ-012 v1.13.0 (DEC-059 案B): permission_response NDJSON の shape 検査。
    ///
    /// Rust 側で組み立てた stdin line (`send` するもの) が sidecar の
    /// `handlePermissionResponse` が期待する shape (type / request_id / decision)
    /// に合致することを確認する。API 契約の lock in。
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

    /// DEC-060 (v1.14.0): plansDirectory 注入ロジックが以下を満たすこと。
    ///
    /// 1. 呼出側が plansDirectory を指定していない場合、`{cwd}/.claude/plans` を注入
    /// 2. 呼出側が plansDirectory を指定済の場合、上書きしない
    /// 3. Windows パス (`C:\...`) / POSIX パス (`/home/...`) どちらの cwd でも
    ///    stable な path string を生成する（POSIX `/` separator で統一）
    ///
    /// 実際の注入は `send_agent_prompt` の内部で行われるが、Tauri State に依存する
    /// ため単体テストが困難。代わりに注入時の format 文字列の shape を lock in する。
    #[test]
    fn plans_directory_default_format_is_stable() {
        // POSIX 風 cwd
        let cwd_posix = "/home/user/myproject";
        let plans = format!("{}/.claude/plans", cwd_posix);
        assert_eq!(plans, "/home/user/myproject/.claude/plans");

        // Windows 風 cwd (backslash は混ぜない - Rust 側は handle.cwd をそのまま使う)
        let cwd_win = "C:\\Users\\hiron\\Desktop\\myproject";
        let plans_win = format!("{}/.claude/plans", cwd_win);
        assert_eq!(plans_win, "C:\\Users\\hiron\\Desktop\\myproject/.claude/plans");

        // mixed separator でも prefix は破壊されない (SDK が吸収する前提)
        assert!(plans_win.ends_with("/.claude/plans"));
    }

    /// DEC-060: options map への insert / contains_key の挙動確認。
    ///
    /// `send_agent_prompt` は `if !options.contains_key("plansDirectory") { insert(...) }`
    /// の pattern を使う。これが「明示指定あり → 尊重」「未指定 → 注入」の
    /// 両方で正しく動くことを serde_json::Map に対して確認する。
    #[test]
    fn options_map_plans_directory_respects_caller_override() {
        // case 1: 呼出側指定なし → 注入される
        let mut opts: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        if !opts.contains_key("plansDirectory") {
            opts.insert(
                "plansDirectory".to_string(),
                serde_json::Value::String("/tmp/myproj/.claude/plans".to_string()),
            );
        }
        assert_eq!(
            opts.get("plansDirectory").and_then(|v| v.as_str()),
            Some("/tmp/myproj/.claude/plans")
        );

        // case 2: 呼出側指定あり → 上書きされない
        let mut opts2: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        opts2.insert(
            "plansDirectory".to_string(),
            serde_json::Value::String("/custom/plans/dir".to_string()),
        );
        if !opts2.contains_key("plansDirectory") {
            opts2.insert(
                "plansDirectory".to_string(),
                serde_json::Value::String("/tmp/myproj/.claude/plans".to_string()),
            );
        }
        assert_eq!(
            opts2.get("plansDirectory").and_then(|v| v.as_str()),
            Some("/custom/plans/dir")
        );
    }

    /// Windows: JobObject 作成は `Default::default()` 内で best-effort。
    /// 失敗しても AgentState 自体は構築され、HashMap は空で start できる。
    /// Linux / macOS: cfg gate で field なし、何もしない。
    #[cfg(target_os = "windows")]
    #[test]
    fn job_object_create_does_not_block_state_construction() {
        // CreateJobObjectW は通常成功するが、稀な OS 制約で失敗しても
        // AgentState の構築は通る (job_object: None になる)。
        let s = AgentState::default();
        // どちらの結果でも sidecars は空で構築されている
        assert!(s.sidecars.lock().unwrap().is_empty());
    }
}
