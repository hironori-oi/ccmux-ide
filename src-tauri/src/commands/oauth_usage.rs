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

/// `~/.claude/.credentials.json` のフルパスを返す（OS 間の HOME 差異を吸収）。
///
/// Windows では `USERPROFILE`、POSIX では `HOME` を参照する。どちらも未設定
/// の場合は Err を返す（本プロジェクトの token 探索は常にこのパスからなので、
/// `read_access_token` / `check_claude_authenticated` 両方で同じ基準を使う）。
fn credentials_path() -> Result<PathBuf, String> {
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").map_err(|e| format!("USERPROFILE 環境変数が未設定: {e}"))?
    } else {
        std::env::var("HOME").map_err(|e| format!("HOME 環境変数が未設定: {e}"))?
    };
    Ok(PathBuf::from(home).join(".claude").join(".credentials.json"))
}

/// `~/.claude/.credentials.json` から OAuth access token を抽出する。
///
/// 構造候補:
/// - `{ "claudeAiOauth": { "accessToken": "..." } }`  ← Pro/Max の標準形式
/// - `{ "access_token": "..." }`                      ← 古い形式 fallback
///
/// セキュリティ: 失敗メッセージには token を**絶対に含めない**。具体的な
/// 「どこに何が無かったか」だけ返す。
fn read_access_token() -> Result<String, String> {
    let path = credentials_path()?;

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
// 認証状態判定（PM-938 / v1.1 Welcome Wizard 撤去）
// ---------------------------------------------------------------------------

/// Claude Max / Pro 認証状態のスナップショット。
///
/// `app/page.tsx` の起動フローが `check_claude_authenticated` を invoke し、
/// `Authenticated` なら `/workspace` へ直遷移、`NotFound` / `TokenMissing`
/// なら toast で `claude login` を案内する。Network 呼出は一切しない（純粋に
/// local file の存在 + JSON 構造チェックのみ）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum AuthStatus {
    /// `~/.claude/.credentials.json` が存在し、`claudeAiOauth.accessToken` が
    /// 非空文字列で取得できた状態。token の *有効性* は検証しない
    /// （期限切れかどうかは `/api/oauth/usage` の 401 で初めて分かる）。
    Authenticated,
    /// credentials.json 自体が未作成。`claude login` 未実施 or 別環境からの初回起動。
    NotFound,
    /// credentials.json はあるが、token 抽出に失敗した
    /// （JSON parse 失敗 / accessToken 空 / path 不一致 等も含む）。
    TokenMissing,
}

/// ローカル `~/.claude/.credentials.json` を読んで OAuth token の有無を判定する。
///
/// - Network 呼出なし（I/O は file read のみ、TTL は呼出し側で管理）。
/// - token 文字列そのものは戻り値にも log にも**絶対に載せない**。
/// - HOME / USERPROFILE 未設定等の異常系も `TokenMissing` に寄せる
///   （frontend 起動フローが止まらないよう、Err 返却は最後の保険として残す）。
///
/// 返り値は enum なので、Tauri は `{ "Authenticated": null }` のような
/// variant 形式ではなく、`#[serde(rename_all = "PascalCase")]` により
/// `"Authenticated" | "NotFound" | "TokenMissing"` の文字列として渡す。
#[tauri::command]
pub fn check_claude_authenticated() -> Result<AuthStatus, String> {
    let path = match credentials_path() {
        Ok(p) => p,
        // HOME / USERPROFILE が無い極端なケースは NotFound 同等で返す。
        Err(_) => return Ok(AuthStatus::NotFound),
    };

    if !path.exists() {
        return Ok(AuthStatus::NotFound);
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        // 読めないが file は存在する（permission 等）→ TokenMissing 扱い。
        Err(_) => return Ok(AuthStatus::TokenMissing),
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(AuthStatus::TokenMissing),
    };

    let token = json
        .pointer("/claudeAiOauth/accessToken")
        .and_then(|v| v.as_str())
        .or_else(|| json.pointer("/access_token").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty());

    if token.is_some() {
        Ok(AuthStatus::Authenticated)
    } else {
        Ok(AuthStatus::TokenMissing)
    }
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

    // -----------------------------------------------------------------------
    // PM-938 / v1.1: check_claude_authenticated の判定ロジック確認。
    //
    // token 文字列そのものを誤って戻り値に混ぜないことが最重要なので、
    // 各 variant に対して serde で round-trip し、期待通りの文字列に serialize
    // されることだけ確認する（実 file 読みは test 環境依存なので行わない）。
    // -----------------------------------------------------------------------

    #[test]
    fn auth_status_serializes_as_pascal_string() {
        let a = serde_json::to_string(&AuthStatus::Authenticated).unwrap();
        let n = serde_json::to_string(&AuthStatus::NotFound).unwrap();
        let t = serde_json::to_string(&AuthStatus::TokenMissing).unwrap();
        assert_eq!(a, "\"Authenticated\"");
        assert_eq!(n, "\"NotFound\"");
        assert_eq!(t, "\"TokenMissing\"");
    }

    #[test]
    fn auth_status_roundtrip() {
        for v in [
            AuthStatus::Authenticated,
            AuthStatus::NotFound,
            AuthStatus::TokenMissing,
        ] {
            let s = serde_json::to_string(&v).unwrap();
            let back: AuthStatus = serde_json::from_str(&s).unwrap();
            assert_eq!(v, back);
        }
    }

    /// `claudeAiOauth.accessToken` が非空文字列なら Authenticated 相当の判定になる、
    /// という本体ロジックを JSON 単体で検証する（file I/O は test しない）。
    #[test]
    fn token_extraction_mirror_authenticated_path() {
        let body = r#"{ "claudeAiOauth": { "accessToken": "dummy-not-a-real-token" } }"#;
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        let token = json
            .pointer("/claudeAiOauth/accessToken")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        assert!(token.is_some());
    }

    #[test]
    fn token_extraction_mirror_empty_is_missing() {
        let body = r#"{ "claudeAiOauth": { "accessToken": "" } }"#;
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        let token = json
            .pointer("/claudeAiOauth/accessToken")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        assert!(token.is_none());
    }

    #[test]
    fn token_extraction_mirror_legacy_fallback() {
        let body = r#"{ "access_token": "legacy-shape" }"#;
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        let token = json
            .pointer("/claudeAiOauth/accessToken")
            .and_then(|v| v.as_str())
            .or_else(|| json.pointer("/access_token").and_then(|v| v.as_str()))
            .filter(|s| !s.is_empty());
        assert!(token.is_some());
    }
}
