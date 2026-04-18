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

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Agent sidecar プロセスの状態。起動中なら `Some(child)`、未起動なら `None`。
pub struct AgentState {
    pub child: Mutex<Option<CommandChild>>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// sidecar の起動モード。
#[derive(Debug, Clone, Copy)]
enum SidecarMode {
    /// esbuild bundle (`dist/index.mjs`) を pure node で起動。
    Bundled,
    /// `src/index.ts` を `node --import tsx/esm` で起動 (dev only)。
    Dev,
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
    if let Ok(p) = app
        .path()
        .resolve("sidecar/dist/index.mjs", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Ok((p, SidecarMode::Bundled));
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

    // resource 側の src/index.ts もダメ元で
    if let Ok(p) = app
        .path()
        .resolve("sidecar/src/index.ts", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Ok((p, SidecarMode::Dev));
        }
    }

    Err(format!(
        "sidecar entry not found. tried dist/index.mjs and src/index.ts from cwd={}",
        cwd.display()
    ))
}

/// sidecar プロセスを起動する。既に起動中なら何もしない。
///
/// 起動後、子プロセスの stdout/stderr/exit を Tauri event として frontend に push する:
/// - `agent:raw`        : stdout 1 行 (NDJSON 1 レコードを期待)
/// - `agent:stderr`     : stderr 1 行 (log / error 用)
/// - `agent:terminated` : プロセス終了 (payload: exit code)
#[tauri::command]
pub async fn start_agent_sidecar(
    app: AppHandle,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    {
        let guard = state
            .child
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let (sidecar_entry, mode) = resolve_sidecar_entry(&app)?;
    let entry_str = sidecar_entry.to_string_lossy().to_string();

    // sidecar ディレクトリ (`.../sidecar/`) を解決。cwd と tsx 絶対パスで使う。
    // - Bundled: entry = sidecar/dist/index.mjs → .parent().parent() = sidecar/
    // - Dev    : entry = sidecar/src/index.ts   → .parent().parent() = sidecar/
    let sidecar_dir = sidecar_entry
        .parent() // dist/ or src/
        .and_then(|p| p.parent()) // sidecar/
        .ok_or_else(|| "sidecar ディレクトリ解決失敗".to_string())?
        .to_path_buf();

    // Dev モードでは tsx loader を絶対パスで指定 (cwd 差異によるモジュール解決失敗回避)
    let tsx_esm = sidecar_dir.join("node_modules/tsx/dist/esm/index.mjs");
    let tsx_arg = if tsx_esm.exists() {
        tsx_esm.to_string_lossy().to_string()
    } else {
        "tsx/esm".to_string()
    };

    // mode ごとに node 引数を組み立てる
    let args: Vec<String> = match mode {
        SidecarMode::Bundled => {
            // pure node: 単一ファイル実行
            vec![entry_str.clone()]
        }
        SidecarMode::Dev => {
            // node --import <tsx/esm loader> <src/index.ts>
            vec![
                "--import".to_string(),
                tsx_arg.clone(),
                entry_str.clone(),
            ]
        }
    };

    // 起動情報を stderr event で流す (デバッグ補助)
    let _ = app.emit(
        "agent:stderr",
        format!("sidecar starting: mode={mode:?}, entry={entry_str}\n"),
    );

    let shell = app.shell();
    let (mut rx, child) = shell
        .command("node")
        .current_dir(sidecar_dir)
        .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .spawn()
        .map_err(|e| format!("sidecar の spawn に失敗: {e}"))?;

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        *guard = Some(child);
    }

    // 子プロセスの stdout/stderr/exit を event 経由で frontend に push
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("agent:raw", s);
                }
                CommandEvent::Stderr(line) => {
                    let s = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("agent:stderr", s);
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_handle.emit("agent:terminated", payload.code);
                    break;
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle.emit("agent:stderr", format!("error: {err}"));
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// sidecar に prompt を 1 行 JSON として書き込む。
///
/// sidecar 側は NDJSON 1 行を 1 リクエストとして解釈する (`{type:"prompt",...}`)。
#[tauri::command]
pub async fn send_agent_prompt(
    state: State<'_, AgentState>,
    id: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    let child = guard.as_mut().ok_or("sidecar が起動していません")?;

    let req = serde_json::json!({
        "type": "prompt",
        "id": id,
        "prompt": prompt,
        "options": {
            "cwd": cwd,
            "model": model.unwrap_or_else(|| "claude-opus-4-7".to_string()),
        }
    });
    let line = req.to_string() + "\n";

    child
        .write(line.as_bytes())
        .map_err(|e| format!("sidecar stdin 書込失敗: {e}"))?;
    Ok(())
}

/// sidecar プロセスを終了させる (window close / app 終了時)。
#[tauri::command]
pub async fn stop_agent_sidecar(state: State<'_, AgentState>) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    Ok(())
}
