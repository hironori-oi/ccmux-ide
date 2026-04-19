//! Claude OAuth Usage API（PRJ-012 Round D'）。
//!
//! Round A (`claude_usage.rs`) は Claude CLI の interactive TUI（`claude /usage`）
//! を spawn して parse していたが、Windows で 10 秒 timeout が常態化し Round C
//! で外部リンクカードに格下げされていた。本モジュールは **Anthropic 公式の
//! OAuth Beta API** を直接叩き、Pro/Max プランの「5 時間ウィンドウ」「週次
//! ウィンドウ」「追加クレジット」の使用率（utilization %）と reset 時刻を
//! JSON でそのまま取得する。
//!
//! # エンドポイント
//!
//! ```text
//! GET https://api.anthropic.com/api/oauth/usage
//!
//! Headers:
//!   Authorization:   Bearer <access_token>
//!   anthropic-beta:  oauth-2025-04-20
//!   User-Agent:      claude-code/2.0.31   (Anthropic 内部 endpoint の慣例)
//!   Accept:          application/json
//! ```
//!
//! Response (観測済 schema):
//!
//! ```json
//! {
//!   "five_hour":   { "utilization": 45.5, "resets_at": "2026-04-19T10:00:00Z" },
//!   "seven_day":   { "utilization": 62.3, "resets_at": "2026-04-24T00:00:00Z" },
//!   "extra_usage": {
//!     "utilization": 10.5, "used_credits": 52.5, "monthly_limit": 500.0,
//!     "is_enabled": true
//!   }
//! }
//! ```
//!
//! # OAuth token の所在
//!
//! `claude login` 実行時に Claude CLI が `~/.claude/.credentials.json` へ
//! 書き込む OAuth token の `claudeAiOauth.accessToken` を利用する。OS 共通
//! のファイル直読み実装で、Windows Credential Manager / macOS Keychain の
//! 呼び出しはしない（CLI 側が平文 JSON で書いている前提のため）。
//!
//! ```json
//! { "claudeAiOauth": { "accessToken": "sk-ant-oat-...", ... } }
//! ```
//!
//! 互換のため `access_token` トップレベル key も fallback で見る。
//!
//! # cache 戦略
//!
//! - 5 分 in-memory cache（`Instant` で TTL 判定、`tauri::State` 経由）
//! - frontend hook は 1 分 interval で呼ぶ（store が cache hit を検知して
//!   backend まで届かない、二重呼出しは store の isLoading ガードで防ぐ）
//! - 公式 API 側にも rate limit があるはずなので保守的に 5 分を採用
//!
//! # Beta API 安定性
//!
//! `anthropic-beta: oauth-2025-04-20` header 必須の Beta API で、Anthropic
//! 側の仕様変更で壊れる可能性がある。`serde_json::Value` を経由して optional
//! field 化しているので、新規 field 追加や既存 field の消失には柔軟に耐える。
//! 完全な schema breakage（top-level 名変更等）は CHANGELOG に Known Issues
//! として明示する。
//!
//! # セキュリティ
//!
//! - access token は `Result::Err` にも log 出力にも絶対に含めない。
//!   誤ってテキスト化するのを防ぐため `String` のまま local 変数で短命に保持。
//! - token 再取得は `read_access_token()` を毎回呼ぶ方式（cache しない）。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_BETA: &str = "oauth-2025-04-20";
/// Anthropic 内部 endpoint の慣例に合わせた User-Agent。
/// 互換性を保つため Claude Code CLI の既知 UA 形式に追従する。
const USER_AGENT: &str = "claude-code/2.0.31";
const CACHE_TTL: Duration = Duration::from_secs(300);
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------------------
// 型定義（Rust backend ↔ TypeScript frontend、camelCase）
// ---------------------------------------------------------------------------

/// 5 時間 / 7 日 ウィンドウ共通の使用率スナップショット。
///
/// 上り（Anthropic API）は snake_case、下り（TS frontend）は camelCase にする
/// 必要があるため、`rename_all` ではなく field ごとに `rename` + `alias`
/// を指定する:
/// - `rename = "<camelCase>"`: Serialize（TS へ）
/// - `alias = "<snake_case>"`: Deserialize（API から）も受け付け
///
/// 実測として Anthropic API は snake_case で返す（e.g. `resets_at`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    /// 使用率 (0.0 〜 100.0)。
    pub utilization: f64,
    /// ISO8601 UTC（例: `"2026-04-19T10:00:00Z"`）。欠落時は `None`。
    #[serde(rename = "resetsAt", alias = "resets_at")]
    pub resets_at: Option<String>,
}

/// 追加クレジット（extra_usage）ブロック。Pro/Max 上位プラン or 追加課金時のみ
/// `is_enabled == true` になる。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    /// 利用率 % （残量指標、無効時は None）。
    pub utilization: Option<f64>,
    /// 使用済みクレジット (USD)。
    #[serde(rename = "usedCredits", alias = "used_credits")]
    pub used_credits: Option<f64>,
    /// 月次上限 (USD)。
    #[serde(rename = "monthlyLimit", alias = "monthly_limit")]
    pub monthly_limit: Option<f64>,
    /// 有効フラグ。Pro/Max 追加課金 enable 時 true。
    #[serde(rename = "isEnabled", alias = "is_enabled")]
    pub is_enabled: bool,
}

/// `get_oauth_usage` 戻り値。公式 API 3 ブロック + fetch 時刻。
///
/// 上りと下りで naming convention が違うため rename + alias を field 単位で
/// 指定（上記 `UsageWindow` と同方針）。`fetched_at` は Rust 側でしか使わない
/// ので Deserialize は不要だが、struct 横断で consistency を保つため alias
/// も付けておく。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeOAuthUsage {
    #[serde(rename = "fiveHour", alias = "five_hour")]
    pub five_hour: Option<UsageWindow>,
    #[serde(rename = "sevenDay", alias = "seven_day")]
    pub seven_day: Option<UsageWindow>,
    #[serde(rename = "extraUsage", alias = "extra_usage")]
    pub extra_usage: Option<ExtraUsage>,
    /// 集計取得時刻 (ISO8601 UTC)。UI の "cached N sec ago" 表示に利用。
    #[serde(rename = "fetchedAt", alias = "fetched_at")]
    pub fetched_at: String,
}

// ---------------------------------------------------------------------------
// cache state
// ---------------------------------------------------------------------------

/// 5 分 cache 本体。`tauri::State` で保持。
///
/// 内容: `(取得 Instant, 結果)`。TTL 経過後は miss 扱い。
#[derive(Default)]
pub struct OAuthUsageCache(pub Arc<Mutex<Option<(Instant, ClaudeOAuthUsage)>>>);

// ---------------------------------------------------------------------------
// token 取得（OS 共通、`~/.claude/.credentials.json` 直読み）
// ---------------------------------------------------------------------------

/// `~/.claude/.credentials.json` から OAuth access token を抽出する。
///
/// 構造候補:
/// - `{ "claudeAiOauth": { "accessToken": "..." } }`  ← Pro/Max の標準形式
/// - `{ "access_token": "..." }`                      ← 古い形式 fallback
///
/// セキュリティ: 失敗メッセージには token を**絶対に含めない**。具体的な
/// 「どこに何が無かったか」だけ返す。
fn read_access_token() -> Result<String, String> {
    // HOME / USERPROFILE の OS 分岐
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").map_err(|e| format!("USERPROFILE 環境変数が未設定: {e}"))?
    } else {
        std::env::var("HOME").map_err(|e| format!("HOME 環境変数が未設定: {e}"))?
    };
    let path = PathBuf::from(home).join(".claude").join(".credentials.json");

    if !path.exists() {
        return Err(format!(
            "Claude credentials が見つかりません ({})。`claude login` を実行してください。",
            path.display()
        ));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("credentials 読込失敗 ({}): {}", path.display(), e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("credentials JSON parse 失敗: {e}"))?;

    if let Some(t) = json
        .pointer("/claudeAiOauth/accessToken")
        .and_then(|v| v.as_str())
    {
        return Ok(t.to_string());
    }
    if let Some(t) = json.pointer("/access_token").and_then(|v| v.as_str()) {
        return Ok(t.to_string());
    }

    Err(
        "credentials JSON に access token が見つかりません (claudeAiOauth.accessToken / access_token いずれも無し)"
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// HTTP 呼出
// ---------------------------------------------------------------------------

/// 公式 endpoint を叩いて生 JSON を返す。cache 判定の外側で呼ぶ。
///
/// # エラー文言
///
/// - 401 → 「OAuth token が期限切れ / 無効。`claude login` で再認証してください。」
/// - その他非 2xx → `status + body 先頭 300 文字`
/// - ネットワーク → reqwest の error をそのまま表示
///
/// いずれも token 文字列を error message に含めない。
async fn fetch_fresh() -> Result<ClaudeOAuthUsage, String> {
    let token = read_access_token()?;

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client 初期化失敗: {e}"))?;

    let resp = client
        .get(ENDPOINT)
        .bearer_auth(&token)
        .header("anthropic-beta", ANTHROPIC_BETA)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("OAuth Usage API リクエスト失敗: {e}"))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(
            "OAuth token が期限切れ / 無効です。`claude login` で再認証してください。".to_string(),
        );
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("OAuth Usage API エラー: HTTP {status} : {snippet}"));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("OAuth Usage API レスポンス読取失敗: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        let snippet: String = body.chars().take(200).collect();
        format!("OAuth Usage API JSON parse 失敗: {e} (先頭200文字: {snippet})")
    })?;

    let usage = ClaudeOAuthUsage {
        five_hour: parsed
            .get("five_hour")
            .and_then(|v| serde_json::from_value::<UsageWindow>(v.clone()).ok()),
        seven_day: parsed
            .get("seven_day")
            .and_then(|v| serde_json::from_value::<UsageWindow>(v.clone()).ok()),
        extra_usage: parsed
            .get("extra_usage")
            .and_then(|v| serde_json::from_value::<ExtraUsage>(v.clone()).ok()),
        fetched_at: Utc::now().to_rfc3339(),
    };

    Ok(usage)
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// 公式 OAuth Usage API から Pro/Max 使用率を取得する。
///
/// 5 分以内の cache hit 時はネットワークを使わない。miss 時だけ
/// `fetch_fresh()` を呼んで結果を cache に書き込む。
#[tauri::command]
pub async fn get_oauth_usage(
    cache: tauri::State<'_, OAuthUsageCache>,
) -> Result<ClaudeOAuthUsage, String> {
    // cache hit 判定
    {
        let guard = cache.0.lock().await;
        if let Some((at, ref data)) = *guard {
            if at.elapsed() < CACHE_TTL {
                return Ok(data.clone());
            }
        }
    }

    // miss: 再取得
    let fresh = fetch_fresh().await?;

    // cache 更新
    {
        let mut guard = cache.0.lock().await;
        *guard = Some((Instant::now(), fresh.clone()));
    }

    Ok(fresh)
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_response_shape_full() {
        // 仕様 schema の full サンプル
        let body = r#"{
            "five_hour":   { "utilization": 45.5, "resets_at": "2026-04-19T10:00:00Z" },
            "seven_day":   { "utilization": 62.3, "resets_at": "2026-04-24T00:00:00Z" },
            "extra_usage": {
              "utilization": 10.5,
              "used_credits": 52.5,
              "monthly_limit": 500.0,
              "is_enabled": true
            }
        }"#;
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap();

        let five: UsageWindow = serde_json::from_value(parsed["five_hour"].clone()).unwrap();
        assert!((five.utilization - 45.5).abs() < 0.01);
        assert_eq!(five.resets_at.as_deref(), Some("2026-04-19T10:00:00Z"));

        let seven: UsageWindow = serde_json::from_value(parsed["seven_day"].clone()).unwrap();
        assert!((seven.utilization - 62.3).abs() < 0.01);

        let extra: ExtraUsage = serde_json::from_value(parsed["extra_usage"].clone()).unwrap();
        assert!(extra.is_enabled);
        assert!((extra.used_credits.unwrap() - 52.5).abs() < 0.01);
        assert!((extra.monthly_limit.unwrap() - 500.0).abs() < 0.01);
    }

    #[test]
    fn parse_response_missing_extra_usage() {
        // extra_usage が無いケース（無償 Pro プラン等）
        let body = r#"{
            "five_hour": { "utilization": 10.0, "resets_at": "2026-04-19T10:00:00Z" },
            "seven_day": { "utilization": 20.0, "resets_at": "2026-04-24T00:00:00Z" }
        }"#;
        let parsed: serde_json::Value = serde_json::from_str(body).unwrap();
        let has_extra = parsed.get("extra_usage").is_some();
        assert!(!has_extra);
    }

    #[test]
    fn parse_response_missing_resets_at() {
        // resets_at が欠落してもパースは成功する
        let body = r#"{ "utilization": 5.0 }"#;
        let w: UsageWindow = serde_json::from_str(body).unwrap();
        assert!((w.utilization - 5.0).abs() < 0.01);
        assert!(w.resets_at.is_none());
    }

    #[test]
    fn extra_usage_disabled_parses() {
        let body = r#"{ "is_enabled": false }"#;
        let e: ExtraUsage = serde_json::from_str(body).unwrap();
        assert!(!e.is_enabled);
        assert!(e.utilization.is_none());
        assert!(e.used_credits.is_none());
        assert!(e.monthly_limit.is_none());
    }

    #[test]
    fn cache_ttl_is_five_minutes() {
        assert_eq!(CACHE_TTL, Duration::from_secs(300));
    }
}
