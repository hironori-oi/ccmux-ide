//! Claude CLI `/usage` から **公式のレート制限情報**を取得する（PRJ-012 Round A）。
//!
//! Stage B (`commands::usage`) は `~/.claude/projects/**/*.jsonl` をローカル集計して
//! 「実測値」を返す実装だが、Anthropic 公式の 5h / weekly / Sonnet only 残量
//! 比率（%）は JSONL からは復元できない。Claude Code CLI 2.1.x にはこれらを
//! 表示する `/usage` slash command が存在し、TUI 上で
//!
//! ```
//! Current session
//!   Resets 9pm (Etc/GMT-9)
//!
//! Current week (all models)
//!   Resets Apr 24, 5am (Etc/GMT-9)
//!
//! Current week (Sonnet only)
//!   Resets Apr 24, 5am (Etc/GMT-9)                     51% used
//! ```
//!
//! のような出力を返す。本モジュールは:
//!
//! 1. `claude` CLI を絶対パス解決して `claude /usage` を child process spawn
//! 2. 10 秒で kill するタイムアウト + stdin に Ctrl+C 送信で interactive TUI を強制終了
//! 3. ANSI escape sequence を除去
//! 4. regex でレート制限フィールド (reset 時刻 / % / Last 24h カウント等) を抽出
//! 5. 30 秒間 in-memory cache（`Arc<Mutex<...>>` を `tauri::State` で保持）
//!
//! を行い、`get_claude_rate_limits` Tauri command として公開する。
//!
//! # Limitation / Known Issues
//!
//! - Claude CLI の `/usage` は **interactive TUI 専用**（v2.1.113 で確認）。
//!   `claude -p /usage` や `claude usage` のような non-interactive モードは
//!   存在しないため、本実装は TUI 出力を grab してから regex parse する。
//!   将来 CLI が `--json` を提供したら、`fetch_via_json()` 関数を追加して
//!   先に試行するよう切り替える想定。
//! - regex は **CLI の文言**に依存しており、Anthropic 側の表記変更で壊れる
//!   可能性がある。parse 失敗時は frontend 側で Stage B（JSONL 集計）を
//!   fallback として表示する。
//! - 未ログイン時は CLI が「`claude login` してください」風の出力を返す。
//!   regex がマッチしないので `Err("...")` で frontend に伝える。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;

// ---------------------------------------------------------------------------
// 型定義（Rust backend ↔ TypeScript frontend の JSON 転送仕様、camelCase）
// ---------------------------------------------------------------------------

/// `/usage` 出力から取り出したレート制限スナップショット。
///
/// すべての時刻フィールドは「CLI が返した raw 文字列」をそのまま保持する
/// （例: `"9pm (Etc/GMT-9)"` `"Apr 24, 5am (Etc/GMT-9)"`）。UI 側で
/// `Intl.DateTimeFormat` 等で local 表示に整形する。Rust 側で日付パースを
/// しないのは、CLI がタイムゾーンを文字列で出してくる前提を尊重するため
/// （`chrono_tz` 依存を避けて bundle size を抑える狙いもある）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRateLimits {
    /// 5h session の reset 時刻（CLI 表記そのまま、例: `"9pm (Etc/GMT-9)"`）
    pub session_reset_at: Option<String>,
    /// 5h session の使用率 %（CLI が表示しないことの方が多い）
    pub session_usage_percent: Option<u32>,
    /// Weekly (all models) の reset 時刻
    pub weekly_all_reset_at: Option<String>,
    /// Weekly (all models) の使用率 %
    pub weekly_all_percent: Option<u32>,
    /// Weekly (Sonnet only) の reset 時刻
    pub weekly_sonnet_reset_at: Option<String>,
    /// Weekly (Sonnet only) の使用率 %（オーナー実機で 51% が出ていた field）
    pub weekly_sonnet_percent: Option<u32>,
    /// Last 24h の background/loop セッション数
    pub last_24h_background: Option<u32>,
    /// Last 24h の subagent セッション数
    pub last_24h_subagent: Option<u32>,
    /// Last 24h の long session 数
    pub last_24h_long: Option<u32>,
    /// `/extra-usage` が enabled になっているか
    pub extra_usage_enabled: bool,
    /// 集計の取得時刻（ISO8601 UTC）
    pub fetched_at: String,
    /// raw 出力の先頭（最大 2KB）。debug / トラブルシュート用
    pub raw_sample: String,
}

impl ClaudeRateLimits {
    /// 何も取れなかった場合の placeholder。fetched_at だけ詰める。
    fn empty(now_iso: String, raw: String) -> Self {
        ClaudeRateLimits {
            session_reset_at: None,
            session_usage_percent: None,
            weekly_all_reset_at: None,
            weekly_all_percent: None,
            weekly_sonnet_reset_at: None,
            weekly_sonnet_percent: None,
            last_24h_background: None,
            last_24h_subagent: None,
            last_24h_long: None,
            extra_usage_enabled: false,
            fetched_at: now_iso,
            raw_sample: raw,
        }
    }
}

// ---------------------------------------------------------------------------
// 30 秒 cache
// ---------------------------------------------------------------------------

/// `tauri::State` で保持する cache 本体。
///
/// `(取得時刻, 結果)` のペア。`Instant` で TTL 判定する。
#[derive(Default)]
pub struct ClaudeUsageCache {
    inner: Arc<Mutex<Option<(Instant, ClaudeRateLimits)>>>,
}

impl ClaudeUsageCache {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

const CACHE_TTL: Duration = Duration::from_secs(30);
const SPAWN_TIMEOUT: Duration = Duration::from_secs(10);
/// raw_sample に入れる出力の最大バイト数（UI 上の debug tooltip 用）。
const RAW_SAMPLE_MAX: usize = 2048;

// ---------------------------------------------------------------------------
// claude CLI のパス解決（sidecar の findClaudeExecutable と同等のロジック）
// ---------------------------------------------------------------------------

/// `claude` 実行ファイルの絶対パスを解決する。
///
/// sidecar/src/agent.ts の `findClaudeExecutable()` の Rust 版で、解決順は同じ:
/// 1. `CLAUDE_CODE_EXECUTABLE` 環境変数
/// 2. `$PATH` 上の claude（`where` / `which`）
/// 3. 一般的なインストール場所（Linux/macOS の `/usr/local/bin` 等）
///
/// sidecar 側では Agent SDK のネイティブバイナリ同梱パスも探していたが、
/// 本コマンドは Tauri バックエンドから直接 `claude /usage` を spawn するだけ
/// なので、PATH と環境変数だけで十分。
fn resolve_claude_path() -> Option<PathBuf> {
    // 1. 環境変数で明示指定
    if let Ok(p) = std::env::var("CLAUDE_CODE_EXECUTABLE") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // 2. $PATH 上の claude を where/which で探す
    let finder = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = std::process::Command::new(finder).arg("claude").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let candidate = line.trim();
                if candidate.is_empty() {
                    continue;
                }
                let pb = PathBuf::from(candidate);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }
    }

    // 3. 一般的なインストール場所
    if !cfg!(windows) {
        let home = std::env::var("HOME").ok();
        let mut candidates = vec![
            PathBuf::from("/usr/local/bin/claude"),
            PathBuf::from("/usr/bin/claude"),
        ];
        if let Some(h) = home {
            for sub in [".local/bin", ".npm/bin", ".npm-global/bin", ".bun/bin"] {
                candidates.push(PathBuf::from(&h).join(sub).join("claude"));
            }
        }
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    } else {
        // Windows: ~/.local/bin/claude.exe / claude (Git Bash) も候補
        if let Ok(home) = std::env::var("USERPROFILE") {
            for name in ["claude.exe", "claude"] {
                let p = PathBuf::from(&home).join(".local").join("bin").join(name);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// claude CLI 実行 + 出力 capture
// ---------------------------------------------------------------------------

/// `claude /usage` を spawn して TUI 出力を文字列で返す。
///
/// # 終了制御
///
/// `/usage` は interactive TUI のため、放っておくと永続的に画面を出し続ける。
/// 確実に終了させるため:
///
/// 1. stdin に Ctrl+C (`\x03`) と `q` を書き込んでから close
/// 2. それでも終わらない場合は 10 秒のタイムアウトで `kill()`
///
/// stdout / stderr の両方を capture して結合する（タイムスタンプ等は stderr に
/// 出ることがある）。
async fn spawn_claude_usage(claude: &PathBuf) -> Result<String, String> {
    use std::process::Stdio;

    let mut child = Command::new(claude)
        .arg("/usage")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Windows で別 console window が開かないようにする
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("claude CLI 起動失敗: {e}"))?;

    // 即座に Ctrl+C と 'q' を送って interactive モードを抜けさせる。
    if let Some(mut stdin) = child.stdin.take() {
        // ベストエフォート: 失敗しても fallthrough
        let _ = stdin.write_all(b"\x03q\n").await;
        let _ = stdin.shutdown().await;
        drop(stdin);
    }

    let wait_fut = child.wait_with_output();
    let output = match timeout(SPAWN_TIMEOUT, wait_fut).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("claude CLI wait 失敗: {e}")),
        Err(_) => {
            // タイムアウトしたら新しい child を kill するすべがないので、
            // wait_with_output が consume してしまった child は drop で
            // kill_on_drop(true) により始末される。
            return Err(format!(
                "claude /usage が {} 秒以内に終了しませんでした",
                SPAWN_TIMEOUT.as_secs()
            ));
        }
    };

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        combined.push('\n');
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok(combined)
}

// ---------------------------------------------------------------------------
// ANSI 除去 + parse
// ---------------------------------------------------------------------------

/// ANSI escape sequence (CSI / OSC / その他) を除去する単純な state machine。
///
/// `regex` クレートで `\x1b\[[0-9;?]*[A-Za-z]` のような pattern を組んでも
/// よいが、TUI が OSC や DECSET なども混ぜてくるので state machine の方が安全。
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // ESC で始まるシーケンスを skip
            match chars.next() {
                Some('[') => {
                    // CSI: 終端は @ - ~ (0x40 - 0x7e) のいずれか
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&nc) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: BEL (0x07) または ESC \ で終わる
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if nc == '\x07' {
                            break;
                        }
                        if nc == '\x1b' {
                            // ST (ESC \)
                            chars.next();
                            break;
                        }
                    }
                }
                Some(_) => {
                    // その他の 2 文字 ESC sequence は 1 文字 skip だけ
                }
                None => break,
            }
        } else if c == '\r' {
            // CR は LF に統一して line 検出を簡単にする
            if chars.peek() != Some(&'\n') {
                out.push('\n');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// 「Resets 9pm (Etc/GMT-9)                     51% used」のような 1 行から
/// `(reset_text, percent)` を取り出す。
///
/// `Resets ` プレフィックスを取り除いた残りを `% used` で分割するだけの
/// シンプル実装。regex を使うよりこちらの方が CLI の余白変動に強い。
fn parse_reset_line(line: &str) -> Option<(String, Option<u32>)> {
    let trimmed = line.trim();
    let after = trimmed.strip_prefix("Resets")?.trim_start();
    if after.is_empty() {
        return None;
    }

    // 「... 51% used」を後ろから検出
    if let Some(idx) = after.rfind("% used") {
        // % の前の数字を逆向きに collect
        let (head, _) = after.split_at(idx);
        let mut digits = String::new();
        for ch in head.chars().rev() {
            if ch.is_ascii_digit() {
                digits.insert(0, ch);
            } else if ch.is_whitespace() && digits.is_empty() {
                continue;
            } else {
                break;
            }
        }
        if let Ok(p) = digits.parse::<u32>() {
            // reset 文字列は数字部分の手前まで
            let reset_part = head[..head.len() - digits.len()].trim_end();
            if !reset_part.is_empty() {
                return Some((reset_part.to_string(), Some(p)));
            }
        }
    }
    Some((after.to_string(), None))
}

/// `/usage` 出力 (ANSI 除去済) から `ClaudeRateLimits` を抽出する純関数。
///
/// CLI 文言（`Current session` / `Current week (all models)` /
/// `Current week (Sonnet only)`）を見出しとして使い、その直後に来る `Resets ...`
/// 行を `parse_reset_line` で処理する。Last 24h ブロックも `Background` /
/// `Subagent` / `Longer` キーワードと隣接する数字を拾う。
fn parse_usage_text(text: &str, fetched_at: String) -> ClaudeRateLimits {
    let raw_sample = if text.len() > RAW_SAMPLE_MAX {
        // UTF-8 char boundary で切るために take 方式
        text.chars().take(RAW_SAMPLE_MAX).collect::<String>()
    } else {
        text.to_string()
    };

    let mut out = ClaudeRateLimits::empty(fetched_at, raw_sample);

    let lines: Vec<&str> = text.lines().collect();

    // ---- Section 見出しを線形 scan して、直近の Resets 行を拾う -----------
    enum Section {
        None,
        Session,
        WeeklyAll,
        WeeklySonnet,
        Last24h,
    }
    let mut section = Section::None;

    for raw_line in &lines {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        // 見出し検出（部分一致で文言ゆれを吸収）
        let lower = line.to_ascii_lowercase();
        if lower.contains("current session") {
            section = Section::Session;
            continue;
        }
        if lower.contains("current week (all models)") || lower.contains("current week (all)") {
            section = Section::WeeklyAll;
            continue;
        }
        if lower.contains("current week (sonnet only)") || lower.contains("current week (sonnet)")
        {
            section = Section::WeeklySonnet;
            continue;
        }
        if lower.contains("last 24h") || lower.contains("last 24 h") {
            section = Section::Last24h;
            continue;
        }

        // /extra-usage の状態
        if lower.contains("extra usage not enabled") {
            out.extra_usage_enabled = false;
        } else if lower.contains("extra usage enabled") {
            out.extra_usage_enabled = true;
        }

        // Resets 行を section に応じて代入
        if line.starts_with("Resets") {
            if let Some((reset_text, pct)) = parse_reset_line(line) {
                match section {
                    Section::Session => {
                        out.session_reset_at = Some(reset_text);
                        if pct.is_some() {
                            out.session_usage_percent = pct;
                        }
                    }
                    Section::WeeklyAll => {
                        out.weekly_all_reset_at = Some(reset_text);
                        if pct.is_some() {
                            out.weekly_all_percent = pct;
                        }
                    }
                    Section::WeeklySonnet => {
                        out.weekly_sonnet_reset_at = Some(reset_text);
                        if pct.is_some() {
                            out.weekly_sonnet_percent = pct;
                        }
                    }
                    _ => {}
                }
                section = Section::None;
            }
            continue;
        }

        // Last 24h block の数値抽出（「7These are often background/loop ...」のように
        // 行頭に数字が貼り付いてくる CLI 表現を許容）。
        if matches!(section, Section::Last24h) {
            // 行頭の数字を取り出す
            let mut digits = String::new();
            for ch in line.chars() {
                if ch.is_ascii_digit() {
                    digits.push(ch);
                } else {
                    break;
                }
            }
            if let Ok(n) = digits.parse::<u32>() {
                let rest = line[digits.len()..].to_ascii_lowercase();
                if rest.contains("background") || rest.contains("loop") {
                    out.last_24h_background = Some(n);
                } else if rest.contains("subagent") {
                    out.last_24h_subagent = Some(n);
                } else if rest.contains("longer") || rest.contains("long session") {
                    out.last_24h_long = Some(n);
                }
            }
        }
    }

    out
}

// ---------------------------------------------------------------------------
// 公開 fetcher
// ---------------------------------------------------------------------------

/// claude CLI を spawn → ANSI 除去 → parse の本体。cache 判定の外側で呼ぶ。
async fn fetch_fresh() -> Result<ClaudeRateLimits, String> {
    let claude = resolve_claude_path()
        .ok_or_else(|| "claude CLI が見つかりません。`npm i -g @anthropic-ai/claude-code` でインストール後、`claude login` してください。".to_string())?;

    let raw = spawn_claude_usage(&claude).await?;
    let stripped = strip_ansi(&raw);

    // ログイン未完了等で空出力が返るケースをガード
    if stripped.trim().is_empty() {
        return Err(
            "claude /usage が空の出力を返しました。`claude login` でログイン状態を確認してください。"
                .to_string(),
        );
    }

    let now_iso = Utc::now().to_rfc3339();
    let limits = parse_usage_text(&stripped, now_iso);

    // すべてのフィールドが None だった場合は parse 失敗とみなして Err
    let nothing_parsed = limits.session_reset_at.is_none()
        && limits.weekly_all_reset_at.is_none()
        && limits.weekly_sonnet_reset_at.is_none()
        && limits.last_24h_background.is_none()
        && limits.last_24h_subagent.is_none()
        && limits.last_24h_long.is_none();
    if nothing_parsed {
        return Err(format!(
            "claude /usage の出力から既知のフィールドを抽出できませんでした（CLI 仕様変更の可能性）。raw: {:.200}",
            stripped
        ));
    }

    Ok(limits)
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// 公式の Claude レート制限スナップショットを返す。
///
/// 30 秒以内のキャッシュがあればそれを返す（CLI spawn コストが大きいため）。
/// それ以外は `claude /usage` を spawn し、結果を cache に書き込む。
#[tauri::command]
pub async fn get_claude_rate_limits(
    cache: tauri::State<'_, ClaudeUsageCache>,
) -> Result<ClaudeRateLimits, String> {
    // ---- cache hit 判定 ------------------------------------------------
    {
        let guard = cache.inner.lock().await;
        if let Some((at, ref limits)) = *guard {
            if at.elapsed() < CACHE_TTL {
                return Ok(limits.clone());
            }
        }
    }

    // ---- miss: 取り直し ------------------------------------------------
    let fresh = fetch_fresh().await?;

    let mut guard = cache.inner.lock().await;
    *guard = Some((Instant::now(), fresh.clone()));
    Ok(fresh)
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_csi() {
        let s = "\x1b[31mHello\x1b[0m World";
        assert_eq!(strip_ansi(s), "Hello World");
    }

    #[test]
    fn strip_ansi_preserves_newlines() {
        let s = "line1\r\nline2\rline3\n";
        let stripped = strip_ansi(s);
        assert!(stripped.contains("line1\nline2\nline3"));
    }

    #[test]
    fn parse_reset_line_no_percent() {
        let r = parse_reset_line("Resets 9pm (Etc/GMT-9)").unwrap();
        assert_eq!(r.0, "9pm (Etc/GMT-9)");
        assert!(r.1.is_none());
    }

    #[test]
    fn parse_reset_line_with_percent() {
        let r = parse_reset_line("Resets Apr 24, 5am (Etc/GMT-9)                     51% used")
            .unwrap();
        assert_eq!(r.0, "Apr 24, 5am (Etc/GMT-9)");
        assert_eq!(r.1, Some(51));
    }

    #[test]
    fn parse_usage_text_owner_sample() {
        // オーナー実機出力をそのまま貼った fixture
        let sample = "  Status   Config   Usage   Stats\n\
\n\
  Current session\n\
  Resets 9pm (Etc/GMT-9)\n\
\n\
  Current week (all models)\n\
  Resets Apr 24, 5am (Etc/GMT-9)\n\
\n\
  Current week (Sonnet only)\n\
  Resets Apr 24, 5am (Etc/GMT-9)                     51% used\n\
\n\
  Approximate, based on local sessions on this machine\n\
\n\
  Last 24h\n\
  7These are often background/loop sessions.\n\
  5Each subagent runs its own requests.\n\
  3Longer sessions are more expensive even when cached.\n\
  d to day · w to week\n\
  Extra usage not enabled · /extra-usage to enable\n";

        let now = "2026-04-18T12:00:00Z".to_string();
        let r = parse_usage_text(sample, now.clone());

        assert_eq!(r.fetched_at, now);
        assert_eq!(r.session_reset_at.as_deref(), Some("9pm (Etc/GMT-9)"));
        assert!(r.session_usage_percent.is_none());
        assert_eq!(
            r.weekly_all_reset_at.as_deref(),
            Some("Apr 24, 5am (Etc/GMT-9)")
        );
        assert!(r.weekly_all_percent.is_none());
        assert_eq!(
            r.weekly_sonnet_reset_at.as_deref(),
            Some("Apr 24, 5am (Etc/GMT-9)")
        );
        assert_eq!(r.weekly_sonnet_percent, Some(51));
        assert_eq!(r.last_24h_background, Some(7));
        assert_eq!(r.last_24h_subagent, Some(5));
        assert_eq!(r.last_24h_long, Some(3));
        assert!(!r.extra_usage_enabled);
        assert!(r.raw_sample.starts_with("  Status"));
    }

    #[test]
    fn parse_usage_text_extra_usage_enabled() {
        let sample = "Current session\nResets 9pm (Etc/GMT-9)\nExtra usage enabled\n";
        let r = parse_usage_text(sample, "now".into());
        assert!(r.extra_usage_enabled);
    }

    #[test]
    fn parse_usage_text_empty_returns_empty() {
        let r = parse_usage_text("", "now".into());
        assert!(r.session_reset_at.is_none());
        assert!(r.weekly_all_reset_at.is_none());
        assert!(r.weekly_sonnet_reset_at.is_none());
    }

    #[test]
    fn empty_helper_initializes_fetched_at() {
        let e = ClaudeRateLimits::empty("ts".into(), "raw".into());
        assert_eq!(e.fetched_at, "ts");
        assert_eq!(e.raw_sample, "raw");
        assert!(!e.extra_usage_enabled);
    }
}
