//! PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル (xterm.js + Rust PTY)。
//!
//! frontend (`TerminalPane.tsx`) が xterm.js canvas を mount し、keystroke を
//! `pty_write` で Rust へ流す。Rust は portable-pty (ConPTY on Windows,
//! openpty on unix) で spawn した shell の stdout/stderr を tokio task で読み、
//! `pty:{pty_id}:data` event として emit し返す。
//!
//! ## Command API
//! - `pty_spawn(shell, cwd)` → 新規 pty を立ち上げて pty_id (UUID) を返す
//! - `pty_write(pty_id, data)` : xterm からの keystroke を pty master に書く
//! - `pty_resize(pty_id, cols, rows)` : window resize を pty に反映
//! - `pty_kill(pty_id)` : pty を明示終了
//! - `list_active_ptys()` : 稼働中の pty_id 一覧
//!
//! ## Event
//! - `pty:{pty_id}:data` : stdout/stderr の 1 chunk (UTF-8 lossy 文字列)
//! - `pty:{pty_id}:exit` : プロセス終了 (payload: { code: i32 | null })
//!
//! ## Shell 既定値
//! - Windows : env `COMSPEC` → 無ければ `cmd.exe`
//! - unix    : env `SHELL`   → 無ければ `bash`
//!
//! ## 生存ライフサイクル
//! - PtyState::Drop で全 pty に kill() を呼ぶ (Mutex Drop 時 best-effort)
//! - Windows の agent sidecar とは別 Job 管理。pty は親 Tauri が異常終了しても
//!   portable-pty が ConPTY ハンドルを close した時点で子プロセスも終了する
//!   (ConPTY の仕様: master handle が全て close されると自動 kill)。
//! - unix では forkpty した子プロセスは controlling terminal (slave fd) が
//!   close されると SIGHUP を受ける。orphan 化のリスクは sidecar と同等だが、
//!   interactive shell 想定なのでユーザが明示的に exit するケースが大半。
//!
//! ## multi-pty
//! HashMap<pty_id, PtyHandle> で複数同時保持。frontend UI は sub-tab 切替で
//! 同じ project 内で複数 terminal を並べる。project 跨ぎの terminal も
//! pty_id UUID で分離されるので backend 側は project を意識しない (frontend の
//! store 側で projectId を紐付ける)。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

/// 1 つの pseudo-terminal のハンドル。
///
/// `master` は write / resize 用、`writer` は stdin 書込専用 handle、
/// `child` は exit watcher 用 (`wait()` を保持する)、`killer` は `kill()` 専用の
/// 独立 handle (portable-pty::Child::clone_killer で複製、child mutex と競合しない)。
/// reader task は spawn 時に tokio blocking thread に move されるため本 struct には載せない。
///
/// # Bug 2 (PM-921) 背景
/// v1.0 (PM-920) では `kill()` も `wait()` も `child: Arc<Mutex<Box<dyn Child>>>` 1 本を
/// 共有していたため、exit watcher が `child.lock()` を保持したまま blocking な
/// `child.wait()` を呼んでおり、`pty_kill` はその child mutex が解放されるまで
/// 実質永久に待たされていた (= close ボタン押下で UI が固まって見える)。
/// `ChildKiller` (portable-pty 0.8 の別 trait) を `clone_killer()` で取得すれば、
/// kill は child mutex と独立に発行できる (Windows では CreateProcess HANDLE の複製、
/// unix では pid の複製) ため、close 側は mutex 競合なしに kill 可能になる。
pub struct PtyHandle {
    /// resize 用の master 参照。Send + Sync を保つため Mutex<Box<dyn MasterPty + Send>>。
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// stdin 書込用 writer (take_writer から取得)。Mutex で排他 write。
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// exit watcher が `wait()` のために保持する子プロセス handle。
    /// ※ `kill()` 目的では使わない (kill は下の `killer` を使う)。
    /// field 自体は exit watcher task が `Arc::clone` を握って `wait()` するため
    /// 直接 read されないが、HashMap に残すことで drop 順序 (kill → drop) を制御する。
    #[allow(dead_code)]
    pub child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    /// kill 専用の独立 handle。`child.clone_killer()` の結果を保持する。
    /// `wait()` を保持中の child mutex とは独立に `kill()` 発行可能。
    pub killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    /// 起動時に生成された pty_id (UUID 文字列)。
    pub pty_id: String,
    /// 起動時刻 (UNIX epoch milliseconds)。
    pub started_at: i64,
}

/// Tauri state: 全 pty の HashMap。
///
/// `AgentState` とは独立 manage。`PtyState::default()` は空 map。
pub struct PtyState {
    pub ptys: Mutex<HashMap<String, PtyHandle>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
        }
    }
}

impl PtyState {
    /// 全 pty に kill を発行し、HashMap を drain する。
    ///
    /// PM-921: `handle.child` (wait 中で blocking mutex を占有する可能性あり) ではなく
    /// 独立 handle の `handle.killer` 経由で kill する。child mutex と競合しないため
    /// shutdown 時に hang しない。
    pub fn drain_kill_all(&self) {
        if let Ok(mut map) = self.ptys.lock() {
            let drained: Vec<(String, PtyHandle)> = map.drain().collect();
            let n = drained.len();
            for (_id, handle) in drained {
                if let Ok(mut killer) = handle.killer.lock() {
                    let _ = killer.kill();
                }
            }
            if n > 0 {
                eprintln!("[pty] drain_kill_all: killed {n} pty(s)");
            }
        }
    }
}

impl Drop for PtyState {
    fn drop(&mut self) {
        if let Ok(mut map) = self.ptys.lock() {
            for (_id, handle) in map.drain() {
                // PM-921: child ではなく独立 killer を使う (wait/kill の mutex 競合回避)
                if let Ok(mut killer) = handle.killer.lock() {
                    let _ = killer.kill();
                }
            }
        }
    }
}

/// `list_active_ptys` の 1 要素。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyInfo {
    pub pty_id: String,
    pub started_at: i64,
}

/// 現在時刻 (UNIX epoch ms)。
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// OS ごとの default shell を解決する。
///
/// - Windows : `COMSPEC` → `cmd.exe`
/// - unix    : `SHELL` → `bash`
fn resolve_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    }
}

/// 新規 pty を spawn し、pty_id を返す。
///
/// # 引数
/// - `shell` : 省略時は OS default (Windows: cmd.exe / unix: bash)
/// - `cwd`   : 起動時の作業ディレクトリ。空なら portable-pty が親 cwd を継承
#[tauri::command(rename_all = "camelCase")]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    shell: Option<String>,
    cwd: String,
) -> Result<String, String> {
    let pty_id = Uuid::new_v4().to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失敗: {e}"))?;

    let shell_cmd = shell.unwrap_or_else(resolve_default_shell);
    let mut cmd = CommandBuilder::new(&shell_cmd);
    if !cwd.is_empty() {
        cmd.cwd(&cwd);
    }
    // 端末系アプリが ANSI/色を出せるように TERM を設定 (vim / python REPL 等が期待)。
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("pty spawn 失敗 (shell={shell_cmd}): {e}"))?;

    // slave 側 fd は spawn 後は親プロセスで保持しても意味がないので drop。
    // drop しないと子終了後に reader が EOF 到達せず task が抜けられない。
    drop(pair.slave);

    // PM-921: kill 専用の独立 handle を取得 (child mutex と競合しない)。
    // ここで boxing する前に clone_killer() を呼ぶのがポイント。
    let killer = child.clone_killer();

    let master = pair.master;
    // reader は master.try_clone_reader() で取得 (blocking thread で move する)。
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("pty reader clone 失敗: {e}"))?;
    // writer は xterm keystroke の書込用 (xterm onData → pty master)。
    let writer = master
        .take_writer()
        .map_err(|e| format!("pty writer 取得失敗: {e}"))?;

    let master_arc: Arc<Mutex<Box<dyn MasterPty + Send>>> =
        Arc::new(Mutex::new(master));
    let writer_arc: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(writer));
    let child_arc: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>> =
        Arc::new(Mutex::new(child));
    let killer_arc: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>> =
        Arc::new(Mutex::new(killer));

    // HashMap に insert。
    {
        let mut guard = state
            .ptys
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        guard.insert(
            pty_id.clone(),
            PtyHandle {
                master: master_arc.clone(),
                writer: writer_arc,
                child: child_arc.clone(),
                killer: killer_arc.clone(),
                pty_id: pty_id.clone(),
                started_at: now_unix_ms(),
            },
        );
    }

    // stdout reader task (tokio blocking thread, portable-pty の reader は blocking std::io::Read)。
    let app_for_reader = app.clone();
    let data_evt = format!("pty:{pty_id}:data");
    let pty_id_for_reader = pty_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF (子プロセスが終了し slave fd が close された)。
                    break;
                }
                Ok(n) => {
                    // xterm.js は raw byte (UTF-8) をそのまま write() で受けるが、
                    // Tauri event payload は serde_json 経由で文字列化されるため
                    // UTF-8 不正 byte を lossy 変換する。ANSI sequence は unaffected。
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_for_reader.emit(&data_evt, s);
                }
                Err(e) => {
                    eprintln!("[pty/{pty_id_for_reader}] reader error: {e}");
                    break;
                }
            }
        }
        eprintln!("[pty/{pty_id_for_reader}] reader task exit");
    });

    // exit watcher task (child.wait は blocking なので spawn_blocking で走らせる)。
    let app_for_exit = app.clone();
    let exit_evt = format!("pty:{pty_id}:exit");
    let pty_id_for_exit = pty_id.clone();
    let child_for_exit = child_arc.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // wait() は &mut self。Mutex 越しに 1 回だけ呼ぶ。
        let exit_status = match child_for_exit.lock() {
            Ok(mut child) => child.wait(),
            Err(e) => {
                eprintln!("[pty/{pty_id_for_exit}] lock poisoned: {e}");
                return;
            }
        };
        let code: Option<i32> = match exit_status {
            Ok(status) => {
                // portable_pty::ExitStatus::exit_code() は u32 を返す。
                // 失敗時の代替 code は None に倒し、frontend で「異常終了」として表示する。
                Some(status.exit_code() as i32)
            }
            Err(e) => {
                eprintln!("[pty/{pty_id_for_exit}] wait error: {e}");
                None
            }
        };
        let _ = app_for_exit.emit(&exit_evt, serde_json::json!({ "code": code }));
        // HashMap から remove (pty_kill / drop が先に走っていれば no-op)。
        if let Some(app_state) = app_for_exit.try_state::<PtyState>() {
            if let Ok(mut map) = app_state.ptys.lock() {
                map.remove(&pty_id_for_exit);
            }
        }
    });

    Ok(pty_id)
}

/// xterm からの keystroke を pty master に書き込む。
#[tauri::command(rename_all = "camelCase")]
pub fn pty_write(
    state: State<'_, PtyState>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let guard = state
        .ptys
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get(&pty_id)
        .ok_or_else(|| format!("pty not found: {pty_id}"))?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|e| format!("writer lock poisoned: {e}"))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("pty write 失敗 ({pty_id}): {e}"))?;
    // interactive shell は line buffer 済だが、flush を明示しておく。
    writer
        .flush()
        .map_err(|e| format!("pty flush 失敗 ({pty_id}): {e}"))?;
    Ok(())
}

/// pty のサイズを変更する (xterm の ResizeObserver → FitAddon fit() で呼ぶ)。
#[tauri::command(rename_all = "camelCase")]
pub fn pty_resize(
    state: State<'_, PtyState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Ok(());
    }
    let guard = state
        .ptys
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let handle = guard
        .get(&pty_id)
        .ok_or_else(|| format!("pty not found: {pty_id}"))?;
    let master = handle
        .master
        .lock()
        .map_err(|e| format!("master lock poisoned: {e}"))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize 失敗 ({pty_id}): {e}"))?;
    Ok(())
}

/// pty を明示的に kill する (frontend の close ボタン)。
///
/// 該当 pty_id が無ければ no-op (idempotent)。
///
/// # PM-921 Bug 2 修正
/// v1.0 は `handle.child.lock()` を取って `child.kill()` を呼んでいたが、
/// exit watcher task が `child.wait()` を **blocking のまま** mutex 占有しているため
/// kill 側が child mutex 解放を永久に待ち、frontend 側で `await invoke("pty_kill")`
/// している間 UI が固まって見える現象が発生していた。
///
/// 修正後は `handle.killer` (clone_killer で取得した独立 handle) を使うため
/// child mutex と競合せず、即座に kill signal を発行して command が return する。
/// exit watcher の `child.wait()` は kill 成功後ほぼ直ちに EOF で抜けるため、
/// `pty:{id}:exit` event も正常に emit される。
#[tauri::command(rename_all = "camelCase")]
pub fn pty_kill(state: State<'_, PtyState>, pty_id: String) -> Result<(), String> {
    // state.ptys lock は killer 取得のみで解放し、kill() 呼出時には保持しない
    // (kill() が万一 blocking でも他の pty の操作を阻害しないため)。
    let killer_opt = {
        let mut guard = state
            .ptys
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        guard.remove(&pty_id).map(|h| h.killer)
    };
    if let Some(killer_arc) = killer_opt {
        if let Ok(mut killer) = killer_arc.lock() {
            let _ = killer.kill();
        }
    }
    Ok(())
}

/// 現在稼働中の pty_id 一覧。
#[tauri::command(rename_all = "camelCase")]
pub fn list_active_ptys(state: State<'_, PtyState>) -> Result<Vec<PtyInfo>, String> {
    let guard = state
        .ptys
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let mut out: Vec<PtyInfo> = guard
        .values()
        .map(|h| PtyInfo {
            pty_id: h.pty_id.clone(),
            started_at: h.started_at,
        })
        .collect();
    out.sort_by_key(|p| p.started_at);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_state_default_is_empty() {
        let s = PtyState::default();
        let map = s.ptys.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn drain_kill_all_is_safe_on_empty_state() {
        let s = PtyState::default();
        s.drain_kill_all();
        s.drain_kill_all();
        let map = s.ptys.lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn pty_info_serializes_as_camel_case() {
        let info = PtyInfo {
            pty_id: "abc".into(),
            started_at: 123,
        };
        let s = serde_json::to_string(&info).unwrap();
        assert!(s.contains("\"ptyId\""));
        assert!(s.contains("\"startedAt\""));
        assert!(!s.contains("pty_id"));
        assert!(!s.contains("started_at"));
    }

    #[test]
    fn resolve_default_shell_non_empty() {
        let s = resolve_default_shell();
        assert!(!s.is_empty());
    }

    #[test]
    fn event_name_format_is_stable() {
        let id = "11111111-1111-1111-1111-111111111111";
        assert_eq!(format!("pty:{id}:data"), "pty:11111111-1111-1111-1111-111111111111:data");
        assert_eq!(format!("pty:{id}:exit"), "pty:11111111-1111-1111-1111-111111111111:exit");
    }

    /// Send + Sync 要件 (Tauri .manage() が要求)。
    #[test]
    fn pty_state_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<PtyState>();
    }

    /// PM-921 Bug 2 修正: PtyHandle が kill 専用の独立 killer handle を保持する契約。
    /// ChildKiller trait object が Send + Sync を満たすことを type-level で保証する
    /// (Tauri state.manage() で Send + Sync が要求されるため)。
    #[test]
    fn pty_handle_killer_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        // `Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>` が Send + Sync であること。
        assert_send_sync::<
            std::sync::Arc<
                std::sync::Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
            >,
        >();
    }
}
