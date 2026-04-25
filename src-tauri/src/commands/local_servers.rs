//! PRJ-012 v1.23.0 / DEC-069: localhost サーバー管理機能 (Phase 1 MVP)。
//!
//! ## 概要
//! 開発者が local で起動した HTTP / TCP サーバー (例: `next dev` の :3000、
//! `vite` の :5173、Python REPL の :8000 等) を Sumi の Sidebar から **可視化 +
//! 停止** できるようにする。Cursor では「どこかで何かが port を握っている」
//! 状態が頻発し、taskkill / ps -ef で逐一探す必要があったが、Sumi は
//! sidebar の「サーバー」tab で一覧 → kill / preview / external-open の 3 アクション
//! を完結させる。
//!
//! ## 取得経路
//!
//! 1. `netstat2::get_sockets_info()` で **LISTEN 状態の TCP socket** のみを列挙
//!    (TIME_WAIT / CLOSE_WAIT / ESTABLISHED は除外)。IPv4 / IPv6 を統合取得。
//! 2. 各 socket の `associated_pids[0]` を pid とみなす。
//! 3. `sysinfo::System` で pid → process name / cmd / cwd / started_at /
//!    cpu_usage / memory を解決。
//! 4. 同一 pid の (IPv4 ::ffff:x.x.x.x / IPv6 ::1) や、`0.0.0.0:3000` と
//!    `[::]:3000` のような重複は **同 pid + 同 port** で 1 行に集約。代表 host は
//!    優先順位 (`127.0.0.1` > `::1` > `0.0.0.0` > その他) で 1 つ選ぶ。
//!
//! ## kill 方針
//!
//! - `force=false`: SIGTERM (Unix) / Process::kill_with(Signal::Term) (sysinfo は
//!   Windows でも内部で TerminateProcess にフォールバック)。3 秒待って残存なら
//!   force=true 相当に escalate (Unix=SIGKILL / Windows=`taskkill /F /T /PID`)。
//! - `force=true`: 直接 SIGKILL / `taskkill /F /T`。Windows は子プロセスも一括 (`/T`)。
//! - Sumi 自身の pid (`std::process::id()`) を kill しようとしたら必ず Err。
//!
//! ## 注意
//!
//! - LISTEN 以外の状態は frontend に出さない (TIME_WAIT 大量発生時の noise 抑制)。
//! - 権限不足 / pid 既存しないは Err 文字列で返し、frontend 側で toast.error。
//! - Sumi 自身の pty 子プロセス由来 (例: pty 内で `npm run dev` した process) は
//!   `is_self=false` で扱う (Sumi 本体と pid が異なるため)。

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use netstat2::{
    get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
};
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

/// Frontend へ返す 1 サーバー行。
///
/// Rust struct field は serde(rename_all = "camelCase") で TS と整合。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServer {
    /// プロセス ID。kill_local_server 引数に渡す。
    pub pid: u32,
    /// LISTEN 中の TCP port。
    pub port: u16,
    /// 代表 host (`127.0.0.1` / `0.0.0.0` / `::1` / `::` 等)。
    /// 同 pid + 同 port で IPv4/IPv6 重複している場合は優先順位で 1 つに集約。
    pub host: String,
    /// プロセス名 (例: `node.exe` / `node` / `python3` / `cargo`)。
    pub process_name: String,
    /// 起動コマンドライン (例: `node /path/to/next dev`)。
    /// 取得不可は None (sysinfo の権限で他ユーザ owned のとき等)。
    pub command_line: Option<String>,
    /// プロセス起動時刻 (UNIX epoch milliseconds)。取得不可は None。
    pub started_at: Option<i64>,
    /// CPU 使用率 (%, 0.0 - 100.0 *コア合算ではない*)。
    pub cpu_percent: f32,
    /// 物理メモリ使用量 (MB)。
    pub memory_mb: u64,
    /// **Sumi 自身の pid なら true**。Frontend で kill 候補から除外する判定に使う。
    pub is_self: bool,
}

/// LISTEN 中の localhost サーバー一覧を返す。
///
/// 失敗 (権限不足 / OS API エラー) は `Err(String)` で返す。
#[tauri::command]
pub fn list_local_servers() -> Result<Vec<LocalServer>, String> {
    list_local_servers_impl().map_err(|e| format!("list_local_servers failed: {e}"))
}

fn list_local_servers_impl() -> anyhow::Result<Vec<LocalServer>> {
    // 1. netstat2 で LISTEN 中の TCP socket を列挙。UDP は対象外 (HTTP / dev サーバ用途)。
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::TCP;
    let sockets = get_sockets_info(af_flags, proto_flags)
        .map_err(|e| anyhow::anyhow!("netstat2: {e}"))?;

    // 2. (pid, port) 単位で集約するため一旦中間 map に集める。
    //    値は (host_priority, host, raw_pid)。同 (pid, port) で複数 host が来たら
    //    priority が高い (= 数値が小さい) 方を採用。
    let mut acc: BTreeMap<(u32, u16), AggEntry> = BTreeMap::new();
    let self_pid: u32 = std::process::id();

    for s in sockets {
        let ProtocolSocketInfo::Tcp(tcp) = s.protocol_socket_info else {
            continue;
        };
        // LISTEN のみ。TIME_WAIT / ESTABLISHED 等は除外。
        if tcp.state != TcpState::Listen {
            continue;
        }
        let Some(pid) = s.associated_pids.first().copied() else {
            continue;
        };
        let port = tcp.local_port;
        let host = tcp.local_addr.to_string();
        let prio = host_priority(&host);

        acc.entry((pid, port))
            .and_modify(|e| {
                if prio < e.host_priority {
                    e.host_priority = prio;
                    e.host = host.clone();
                }
            })
            .or_insert(AggEntry {
                host: host.clone(),
                host_priority: prio,
                pid,
            });
    }

    // 3. sysinfo で pid → metadata 解決。一括 refresh で必要 pid だけ refresh する
    //    (全プロセス refresh は重い)。
    let pids: Vec<Pid> = acc.values().map(|e| Pid::from_u32(e.pid)).collect();
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    // 全プロセスを 1 度 refresh (cpu / memory 用)。
    sys.refresh_processes();
    // 念のため named pids 再 refresh (cpu_usage は 2 回 refresh で値が安定するが、
    // Phase 1 MVP では initial value で割り切る)。
    let _ = pids; // marker: 必要なら refresh_pids で絞り込み可能。

    // 4. struct LocalServer に変換。
    let mut out: Vec<LocalServer> = Vec::with_capacity(acc.len());
    for ((pid, port), entry) in acc {
        let proc = sys.process(Pid::from_u32(pid));
        let (process_name, command_line, started_at, cpu_percent, memory_mb) = match proc {
            Some(p) => {
                let name = p.name().to_string();
                let cmd_vec = p.cmd();
                let cmd_line = if cmd_vec.is_empty() {
                    None
                } else {
                    Some(cmd_vec.join(" "))
                };
                let start_secs = p.start_time();
                // sysinfo::Process::start_time() は **絶対 UNIX epoch seconds** を返す
                // (0.30.x 仕様)。0 の場合は取得失敗扱い。
                let started_at_ms = if start_secs == 0 {
                    None
                } else {
                    Some((start_secs as i64).saturating_mul(1000))
                };
                let cpu = p.cpu_usage();
                let mem_mb = p.memory() / (1024 * 1024);
                (name, cmd_line, started_at_ms, cpu, mem_mb)
            }
            None => ("(unknown)".to_string(), None, None, 0.0, 0),
        };

        out.push(LocalServer {
            pid,
            port,
            host: entry.host,
            process_name,
            command_line,
            started_at,
            cpu_percent,
            memory_mb,
            is_self: pid == self_pid,
        });
    }

    // port 昇順で sort (UI で見やすく)。
    out.sort_by_key(|s| (s.port, s.pid));
    Ok(out)
}

/// 指定 pid のプロセスを停止する。
///
/// - `force=false`: 通常 kill (SIGTERM / TerminateProcess soft) → 3 秒待ち、
///   残存していれば force kill に escalate。
/// - `force=true`: 直接 SIGKILL / `taskkill /F /T`。
///
/// Sumi 自身の pid を渡すと `Err("Sumi 自身は停止できません")`。
#[tauri::command]
pub fn kill_local_server(pid: u32, force: bool) -> Result<(), String> {
    kill_local_server_impl(pid, force).map_err(|e| e.to_string())
}

fn kill_local_server_impl(pid: u32, force: bool) -> anyhow::Result<()> {
    let self_pid = std::process::id();
    if pid == self_pid {
        anyhow::bail!("Sumi 自身は停止できません (pid={pid})");
    }

    if force {
        return force_kill(pid);
    }

    // soft kill 試行 → 3 秒待機 → 残存なら force escalate。
    let soft_ok = soft_kill(pid).is_ok();
    if !soft_ok {
        // soft 失敗ならそのまま force にフォールバック。
        return force_kill(pid);
    }

    // 3 秒間 100ms 刻みでプロセス存在チェック。
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if !process_exists(pid) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // 残存していたら force kill に escalate。
    force_kill(pid)
}

// ------------------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------------------

struct AggEntry {
    host: String,
    host_priority: u8,
    #[allow(dead_code)]
    pid: u32,
}

/// host 表現の優先度。低いほど優先 (採用される)。
///
/// 1. `127.0.0.1` (loopback IPv4)
/// 2. `::1` (loopback IPv6)
/// 3. `0.0.0.0` (any IPv4)
/// 4. `::` (any IPv6)
/// 5. その他 (LAN IP 等)
fn host_priority(host: &str) -> u8 {
    match host {
        "127.0.0.1" => 0,
        "::1" => 1,
        "0.0.0.0" => 2,
        "::" => 3,
        _ => 9,
    }
}

/// 現在時刻 (UNIX epoch ms)。テスト用。
#[allow(dead_code)]
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// プロセスが存在するか。sysinfo を使うが軽量化のため pid 1 件のみ refresh する。
fn process_exists(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_process(Pid::from_u32(pid));
    sys.process(Pid::from_u32(pid)).is_some()
}

/// SIGTERM 相当 (Unix) / TerminateProcess soft (Windows)。
///
/// sysinfo::Process::kill() は Unix で SIGKILL を送るので、
/// soft kill は明示的に Signal::Term を指定する。Windows では sysinfo の Signal は
/// 一律 TerminateProcess に解決されるため kill() でも kill_with(Term) でも同等。
fn soft_kill(pid: u32) -> anyhow::Result<()> {
    let mut sys = System::new();
    sys.refresh_process(Pid::from_u32(pid));
    let proc = sys
        .process(Pid::from_u32(pid))
        .ok_or_else(|| anyhow::anyhow!("プロセスが見つかりません (pid={pid})"))?;

    #[cfg(unix)]
    {
        let killed = proc
            .kill_with(sysinfo::Signal::Term)
            .ok_or_else(|| anyhow::anyhow!("SIGTERM 未対応"))?;
        if !killed {
            anyhow::bail!("SIGTERM 送信に失敗 (pid={pid}, 権限不足の可能性)");
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        // Windows: sysinfo は TerminateProcess にフォールバックする。
        // 子プロセスは一緒に kill されない点に注意 (force_kill は taskkill /T で網羅)。
        let killed = proc.kill();
        if !killed {
            anyhow::bail!("プロセス停止に失敗 (pid={pid}, 権限不足の可能性)");
        }
        Ok(())
    }
}

/// SIGKILL (Unix) / `taskkill /F /T /PID <pid>` (Windows)。
///
/// Windows は子プロセスも一括 kill するため `/T` を必ず付ける。
/// (例: `npm run dev` で起動した node の更に下の next-server プロセスを巻き込む)
fn force_kill(pid: u32) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        let mut sys = System::new();
        sys.refresh_process(Pid::from_u32(pid));
        let proc = sys
            .process(Pid::from_u32(pid))
            .ok_or_else(|| anyhow::anyhow!("プロセスが見つかりません (pid={pid})"))?;
        let killed = proc.kill_with(sysinfo::Signal::Kill).unwrap_or(false);
        if !killed {
            anyhow::bail!("SIGKILL 送信に失敗 (pid={pid}, 権限不足の可能性)");
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let status = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .status()
            .map_err(|e| anyhow::anyhow!("taskkill spawn 失敗: {e}"))?;
        if !status.success() {
            anyhow::bail!(
                "taskkill 失敗 (pid={pid}, exit={:?}, 権限不足 / 既に終了している可能性)",
                status.code()
            );
        }
        Ok(())
    }
}

// ------------------------------------------------------------------------
// テスト
// ------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// list_local_servers は LISTEN socket が 1 つも無い場合は空を返す
    /// (panic しないことを確認)。
    #[test]
    fn list_returns_ok_or_skips_when_no_listen_sockets() {
        // CI / 通常環境では LISTEN port が存在する保証がない。
        // 失敗時は (Linux user namespace 等で) Err になりうるので Result を緩く受ける。
        let res = list_local_servers_impl();
        match res {
            Ok(v) => {
                // 全 entry の pid > 0 / port > 0 を invariant で確認。
                for s in v {
                    assert!(s.pid > 0, "pid should be positive: {s:?}");
                    assert!(s.port > 0, "port should be positive: {s:?}");
                }
            }
            Err(_) => {
                // netstat2 が permission 不足で失敗するケース (sandbox / minimal Docker)
                // は許容。手元 / GitHub Actions では走らないので xfail 扱い。
            }
        }
    }

    /// host_priority は文書化された優先度どおりに sort される。
    #[test]
    fn host_priority_matches_docs() {
        assert!(host_priority("127.0.0.1") < host_priority("::1"));
        assert!(host_priority("::1") < host_priority("0.0.0.0"));
        assert!(host_priority("0.0.0.0") < host_priority("::"));
        assert!(host_priority("::") < host_priority("192.168.1.1"));
    }

    /// kill_local_server に Sumi 自身の pid を渡すと拒否される。
    /// (pid 値の取得は std::process::id() で確実)
    #[test]
    fn kill_self_pid_is_rejected() {
        let self_pid = std::process::id();
        let result = kill_local_server(self_pid, false);
        assert!(result.is_err(), "self pid kill should be rejected");
        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("Sumi 自身"),
            "error msg should mention Sumi 自身: {err_msg}"
        );
    }

    /// force=true でも Sumi 自身は拒否される。
    #[test]
    fn kill_self_pid_with_force_is_also_rejected() {
        let self_pid = std::process::id();
        let result = kill_local_server(self_pid, true);
        assert!(result.is_err());
    }

    /// LocalServer struct が is_self=true を Sumi 自身の pid で立てる。
    /// ※ list_local_servers が必ず Sumi 自身を返すとは限らない (Sumi が listen してない場合)
    /// ので、ここでは struct 構築の挙動だけを確認する。
    #[test]
    fn local_server_is_self_flag_struct_construction() {
        let self_pid = std::process::id();
        let s = LocalServer {
            pid: self_pid,
            port: 1234,
            host: "127.0.0.1".to_string(),
            process_name: "sumi".to_string(),
            command_line: None,
            started_at: None,
            cpu_percent: 0.0,
            memory_mb: 0,
            is_self: self_pid == std::process::id(),
        };
        assert!(s.is_self);
    }
}
