//! Claude Pro/Max 使用量集計（PRJ-012 Stage B）。
//!
//! `~/.claude/projects/<project-uuid>/<session-uuid>.jsonl` を走査し、
//! 各 JSONL 行の `type == "assistant"` entry から `message.usage` を抽出して
//! session 5h / weekly 7d / daily の使用量 + 推定コスト (USD) を返す。
//!
//! # 背景
//!
//! - Claude Pro/Max の「5 時間セッション」「週次」制限は Anthropic 公式 API
//!   レスポンスに含まれないため、SDK 経由で正確に取得することは不可能。
//! - ただし Claude Code CLI は `~/.claude/projects/` 配下に各 message と usage
//!   を JSONL 形式で記録しており、これを集計すれば十分に実用的な精度で
//!   使用状況が把握できる（OSS ツール `ccusage` が実証済）。
//!
//! # データ仕様（入力）
//!
//! 各 JSONL 行:
//! ```jsonc
//! {
//!   "type": "assistant",          // or "user" / "tool_result" 等
//!   "message": {
//!     "model": "claude-opus-4-7[1m]",
//!     "usage": {
//!       "input_tokens": 82,
//!       "output_tokens": 1240,
//!       "cache_read_input_tokens": 51200,
//!       "cache_creation_input_tokens": 0
//!     }
//!   },
//!   "timestamp": "2026-04-18T09:32:11.000Z"
//! }
//! ```
//!
//! # 料金表
//!
//! `price_for_model()` に 2026-04 時点の Anthropic 公開価格を定数化。
//! 将来価格改定された場合はここを差し替える。
//!
//! # Limitation
//!
//! - Anthropic 公式「5h / weekly limit」の絶対値は公開されていないため、本実装は
//!   「相対的な使用実測値」を返す。UI 側は残量 % ではなく absolute tokens / cost
//!   で表示する。
//! - JSONL 書き込みは Claude Code CLI 依存であり、CLI 未使用の session は
//!   集計対象外。
//! - parse error の行は silently skip（stderr にデバッグ log を出力、続行）。

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// 型定義（Rust backend ↔ TypeScript frontend の JSON 転送仕様、camelCase）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    /// ISO8601 UTC
    pub timestamp: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub messages: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_usd: f64,
    /// ISO8601 UTC
    pub window_start: String,
    /// ISO8601 UTC
    pub window_end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// "YYYY-MM-DD"
    pub date: String,
    pub messages: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    /// 直近 5 時間ウィンドウ
    pub session_5h: UsageWindow,
    /// 直近 7 日ウィンドウ（ローリング）
    pub weekly_7d: UsageWindow,
    /// 過去 7 日分の日別集計（古い→新しい、末尾が今日）
    pub daily: Vec<DailyUsage>,
    /// 5 時間ウィンドウのリセット時刻（window_start + 5h）
    pub session_reset_at: Option<String>,
    /// 集計対象 JSONL ファイル数（デバッグ用）
    pub source_files: u64,
}

// ---------------------------------------------------------------------------
// 料金表（2026-04 時点の Anthropic 公開価格、USD per 1M tokens）
// ---------------------------------------------------------------------------

/// 戻り値: `(input, output, cache_read, cache_creation)` per 1M tokens USD。
///
/// **注意**: これは推定値。Anthropic が価格改定した場合はこの関数を更新すること。
/// 未知モデル名は Sonnet 相当にフォールバックする。
fn price_for_model(model: &str) -> (f64, f64, f64, f64) {
    let m = model.to_lowercase();
    // Opus 系（opus-4-7 / opus-4-6 / opus-4-5）
    if m.contains("opus-4-7")
        || m.contains("opus-4.7")
        || m.contains("opus-4-6")
        || m.contains("opus-4.6")
        || m.contains("opus-4-5")
        || m.contains("opus-4.5")
        || m.contains("opus")
    {
        // Opus 4.x: input $15 / output $75 / cache read $1.50 / cache write $18.75
        (15.0, 75.0, 1.5, 18.75)
    } else if m.contains("haiku-4") || m.contains("haiku-3-5") || m.contains("haiku") {
        // Haiku 4.x: input $0.80 / output $4 / cache read $0.08 / cache write $1.00
        (0.80, 4.0, 0.08, 1.0)
    } else if m.contains("sonnet") {
        // Sonnet 4.x: input $3 / output $15 / cache read $0.30 / cache write $3.75
        (3.0, 15.0, 0.3, 3.75)
    } else {
        // fallback = Sonnet 相当
        (3.0, 15.0, 0.3, 3.75)
    }
}

/// 1 メッセージあたりのコスト (USD) を推定。
fn estimate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
) -> f64 {
    let (in_p, out_p, cread_p, cwrite_p) = price_for_model(model);
    let per_m = 1_000_000.0;
    (input_tokens as f64 / per_m) * in_p
        + (output_tokens as f64 / per_m) * out_p
        + (cache_read_tokens as f64 / per_m) * cread_p
        + (cache_creation_tokens as f64 / per_m) * cwrite_p
}

// ---------------------------------------------------------------------------
// JSONL パース
// ---------------------------------------------------------------------------

/// 1 行の JSON Value から UsageEntry を抽出。assistant 以外 or usage 無しは None。
fn extract_entry(v: &serde_json::Value) -> Option<UsageEntry> {
    let ty = v.get("type")?.as_str()?;
    if ty != "assistant" {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let model = msg
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    let ts = v.get("timestamp")?.as_str()?.to_string();

    let input_tokens = usage
        .get("input_tokens")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);

    // すべて 0 なら記録価値なし（ただし 0 tokens の assistant message も数 messages
    // にはカウントしたいので、entry は返す）。
    Some(UsageEntry {
        timestamp: ts,
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
    })
}

/// 1 JSONL ファイルを走査して UsageEntry を取り出す。
///
/// BufReader の line stream で処理するため、巨大ファイル (100MB+) でもメモリ
/// 爆発しない。parse error の行は silently skip。
fn parse_jsonl_file(path: &PathBuf) -> Vec<UsageEntry> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[usage] open failed {}: {}", path.display(), e);
            return Vec::new();
        }
    };
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for (lineno, line) in reader.lines().enumerate() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                // silently skip 壊れた行（debug 用に最初 200 文字のみ log）
                eprintln!(
                    "[usage] parse_error in {} line {}: {:.200}",
                    path.display(),
                    lineno + 1,
                    trimmed
                );
                continue;
            }
        };
        if let Some(entry) = extract_entry(&v) {
            out.push(entry);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 集計ロジック
// ---------------------------------------------------------------------------

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// UsageWindow に 1 entry を足し込む。
fn add_to_window(win: &mut UsageWindow, e: &UsageEntry) {
    win.messages += 1;
    win.input_tokens += e.input_tokens;
    win.output_tokens += e.output_tokens;
    win.cache_read_tokens += e.cache_read_tokens;
    win.cache_creation_tokens += e.cache_creation_tokens;
    win.cost_usd += estimate_cost(
        &e.model,
        e.input_tokens,
        e.output_tokens,
        e.cache_read_tokens,
        e.cache_creation_tokens,
    );
}

/// 現在時刻 `now` と entries から UsageStats を組み立てる（純関数、テスト可能）。
fn compute_stats(now: DateTime<Utc>, entries: Vec<UsageEntry>, source_files: u64) -> UsageStats {
    let five_h_ago = now - Duration::hours(5);
    let seven_d_ago = now - Duration::days(7);

    // timestamp 昇順にして window_start 判定を容易にする。
    let mut parsed: Vec<(DateTime<Utc>, UsageEntry)> = entries
        .into_iter()
        .filter_map(|e| parse_ts(&e.timestamp).map(|t| (t, e)))
        .collect();
    parsed.sort_by_key(|(t, _)| *t);

    let mut session_5h = UsageWindow::default();
    let mut weekly_7d = UsageWindow::default();
    let mut session_start: Option<DateTime<Utc>> = None;
    let mut session_end: Option<DateTime<Utc>> = None;
    let mut weekly_start: Option<DateTime<Utc>> = None;
    let mut weekly_end: Option<DateTime<Utc>> = None;

    // 過去 7 日分の日別集計（ローカル TZ 使わず UTC で date 切り：国際日付変更線
    // 問題は承知の上で簡潔さを優先）。
    let mut daily_map: HashMap<String, DailyUsage> = HashMap::new();

    for (t, e) in &parsed {
        if *t >= five_h_ago && *t <= now {
            add_to_window(&mut session_5h, e);
            if session_start.map(|s| *t < s).unwrap_or(true) {
                session_start = Some(*t);
            }
            if session_end.map(|s| *t > s).unwrap_or(true) {
                session_end = Some(*t);
            }
        }
        if *t >= seven_d_ago && *t <= now {
            add_to_window(&mut weekly_7d, e);
            if weekly_start.map(|s| *t < s).unwrap_or(true) {
                weekly_start = Some(*t);
            }
            if weekly_end.map(|s| *t > s).unwrap_or(true) {
                weekly_end = Some(*t);
            }
            let date_key = t.format("%Y-%m-%d").to_string();
            let d = daily_map.entry(date_key.clone()).or_insert(DailyUsage {
                date: date_key,
                messages: 0,
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: 0.0,
            });
            d.messages += 1;
            d.input_tokens += e.input_tokens;
            d.output_tokens += e.output_tokens;
            d.cost_usd += estimate_cost(
                &e.model,
                e.input_tokens,
                e.output_tokens,
                e.cache_read_tokens,
                e.cache_creation_tokens,
            );
        }
    }

    let session_start = session_start.unwrap_or(now);
    let session_end = session_end.unwrap_or(now);
    let weekly_start = weekly_start.unwrap_or(now);
    let weekly_end = weekly_end.unwrap_or(now);

    session_5h.window_start = session_start.to_rfc3339();
    session_5h.window_end = session_end.to_rfc3339();
    weekly_7d.window_start = weekly_start.to_rfc3339();
    weekly_7d.window_end = weekly_end.to_rfc3339();

    // session reset = 最初のメッセージから 5h 後（messages=0 なら None）
    let session_reset_at = if session_5h.messages > 0 {
        Some((session_start + Duration::hours(5)).to_rfc3339())
    } else {
        None
    };

    // 過去 7 日分の日別を、今日を末尾にして 7 要素に整える。
    let mut daily: Vec<DailyUsage> = Vec::with_capacity(7);
    for i in (0..7).rev() {
        let date = (now - Duration::days(i as i64))
            .format("%Y-%m-%d")
            .to_string();
        if let Some(d) = daily_map.remove(&date) {
            daily.push(d);
        } else {
            daily.push(DailyUsage {
                date,
                messages: 0,
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: 0.0,
            });
        }
    }

    UsageStats {
        session_5h,
        weekly_7d,
        daily,
        session_reset_at,
        source_files,
    }
}

// ---------------------------------------------------------------------------
// ファイル走査
// ---------------------------------------------------------------------------

fn claude_projects_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let p = home.join(".claude").join("projects");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// `~/.claude/projects/` 配下の *.jsonl を列挙（max_depth=3、最大 500 ファイル）。
fn list_jsonl_files(root: &PathBuf) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if out.len() >= 500 {
            break;
        }
        let path = entry.path();
        if path.is_file() && path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path.to_path_buf());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// `~/.claude/projects/**/*.jsonl` を集計して UsageStats を返す。
///
/// - projects ディレクトリが存在しない → 空の UsageStats（エラーにしない）
/// - JSONL パースエラー行 → silently skip（stderr log）
/// - 重い処理は `spawn_blocking` で外す（UI スレッドをブロックしない）
#[tauri::command]
pub async fn get_usage_stats() -> Result<UsageStats, String> {
    tokio::task::spawn_blocking(|| -> Result<UsageStats, String> {
        let now = Utc::now();
        let Some(root) = claude_projects_dir() else {
            // ~/.claude/projects/ が無い → 空 stats を返す
            return Ok(compute_stats(now, Vec::new(), 0));
        };

        let files = list_jsonl_files(&root);
        let source_files = files.len() as u64;

        let mut all_entries: Vec<UsageEntry> = Vec::new();
        for f in &files {
            let entries = parse_jsonl_file(f);
            all_entries.extend(entries);
        }

        Ok(compute_stats(now, all_entries, source_files))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_entry(ts: &str, model: &str, input: u64, output: u64) -> UsageEntry {
        UsageEntry {
            timestamp: ts.to_string(),
            model: model.to_string(),
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
        }
    }

    #[test]
    fn price_for_model_known_families() {
        let (i, o, _, _) = price_for_model("claude-opus-4-7[1m]");
        assert!((i - 15.0).abs() < 1e-9);
        assert!((o - 75.0).abs() < 1e-9);

        let (i, o, _, _) = price_for_model("claude-sonnet-4-6");
        assert!((i - 3.0).abs() < 1e-9);
        assert!((o - 15.0).abs() < 1e-9);

        let (i, o, _, _) = price_for_model("claude-haiku-4-5");
        assert!((i - 0.8).abs() < 1e-9);
        assert!((o - 4.0).abs() < 1e-9);
    }

    #[test]
    fn estimate_cost_opus_basic() {
        // 1M in + 1M out Opus = $15 + $75 = $90
        let c = estimate_cost("claude-opus-4-7", 1_000_000, 1_000_000, 0, 0);
        assert!((c - 90.0).abs() < 1e-6);
    }

    #[test]
    fn compute_stats_empty() {
        let now = Utc::now();
        let s = compute_stats(now, Vec::new(), 0);
        assert_eq!(s.session_5h.messages, 0);
        assert_eq!(s.weekly_7d.messages, 0);
        assert_eq!(s.daily.len(), 7);
        assert!(s.session_reset_at.is_none());
    }

    #[test]
    fn compute_stats_windows() {
        let now = Utc::now();
        let within_5h = (now - Duration::hours(2)).to_rfc3339();
        let within_7d = (now - Duration::days(3)).to_rfc3339();
        let outside = (now - Duration::days(10)).to_rfc3339();

        let entries = vec![
            mk_entry(&within_5h, "claude-sonnet-4-6", 1000, 500),
            mk_entry(&within_7d, "claude-sonnet-4-6", 2000, 1000),
            mk_entry(&outside, "claude-sonnet-4-6", 9999, 9999),
        ];
        let s = compute_stats(now, entries, 1);
        // session_5h は 1 件
        assert_eq!(s.session_5h.messages, 1);
        assert_eq!(s.session_5h.input_tokens, 1000);
        // weekly_7d は 2 件（5h 内のも含む）
        assert_eq!(s.weekly_7d.messages, 2);
        // 範囲外は入らない
        assert!(s.session_5h.input_tokens < 9999);
        assert!(s.session_reset_at.is_some());
    }

    #[test]
    fn extract_entry_valid_assistant() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{
                "type":"assistant",
                "message":{
                    "model":"claude-opus-4-7",
                    "usage":{
                        "input_tokens":100,
                        "output_tokens":200,
                        "cache_read_input_tokens":50,
                        "cache_creation_input_tokens":10
                    }
                },
                "timestamp":"2026-04-18T10:00:00Z"
            }"#,
        )
        .unwrap();
        let e = extract_entry(&v).unwrap();
        assert_eq!(e.input_tokens, 100);
        assert_eq!(e.output_tokens, 200);
        assert_eq!(e.cache_read_tokens, 50);
        assert_eq!(e.cache_creation_tokens, 10);
        assert_eq!(e.model, "claude-opus-4-7");
    }

    #[test]
    fn extract_entry_user_is_ignored() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"type":"user","message":{"content":"hi"},"timestamp":"2026-04-18T10:00:00Z"}"#,
        )
        .unwrap();
        assert!(extract_entry(&v).is_none());
    }
}
