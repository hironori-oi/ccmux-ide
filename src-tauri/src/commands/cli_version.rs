//! Claude Code CLI のバージョン検出 (PRJ-012 v1.24.0 / DEC-070)。
//!
//! Settings の「ブラウザ操作」セクションで、`/chrome` 機能の前提条件である
//! Claude Code CLI 2.0.73 以上がインストールされているかを表示するために、
//! `claude --version` の stdout から semver を抽出する。
//!
//! ## 戻り値
//! - `Some("2.1.113")` 等: stdout から semver 抽出に成功
//! - `None`             : claude が見つからない / spawn 失敗 / parse 失敗 / timeout
//!
//! ## エラー方針
//! 取得失敗は silent fallback で `None` を返す（Settings UI 側で「CLI が見つかりません」
//! と表示する）。Result ではなく Option を採用するのは、UI 側で error 文字列を
//! 出すより「取得不能 = 未インストール扱い」のほうが UX が単純なため。
//!
//! ## timeout
//! `claude --version` は通常 100ms 程度で返るが、network probe や auth check が
//! 走る将来バージョンに備えて 5 秒で timeout する。

use std::path::PathBuf;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

/// `claude --version` を spawn して stdout から semver を抽出する。
///
/// 失敗時は `None`。timeout は 5 秒。
#[tauri::command]
pub async fn claude_version() -> Option<String> {
    let path = resolve_claude_binary()?;

    // `claude --version` は通常 "Claude Code 2.1.113 (..)\n" のような形式で返す。
    // Windows は .cmd shim で起動するため Command::new(path) を直接使う
    // (claude_usage.rs の resolve_claude_path と同じ流儀)。
    let mut cmd = Command::new(&path);
    cmd.arg("--version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn().ok()?;
    let output = timeout(Duration::from_secs(5), child.wait_with_output())
        .await
        .ok()?
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_semver(&stdout)
}

/// `claude` の実バイナリパスを解決する。
///
/// `claude_usage.rs::resolve_claude_path` と同等の手順だが、本 module は依存を
/// 増やさないため小さく再実装する（SDK bundled は除外、Windows は .cmd 優先）。
fn resolve_claude_binary() -> Option<PathBuf> {
    // 1. 環境変数で明示指定
    if let Ok(p) = std::env::var("CLAUDE_CODE_EXECUTABLE") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Some(pb);
        }
    }

    let is_sdk_bundled = |p: &PathBuf| p.to_string_lossy().contains("claude-agent-sdk-");

    // 2. PATH 上の claude（Windows=where, unix=which）
    let finder = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = std::process::Command::new(finder).arg("claude").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            let candidates: Vec<PathBuf> = s
                .lines()
                .filter_map(|l| {
                    let t = l.trim();
                    if t.is_empty() {
                        return None;
                    }
                    let pb = PathBuf::from(t);
                    if pb.exists() && !is_sdk_bundled(&pb) {
                        Some(pb)
                    } else {
                        None
                    }
                })
                .collect();

            if cfg!(windows) {
                if let Some(cmd) = candidates.iter().find(|p| {
                    p.extension()
                        .map(|e| e.eq_ignore_ascii_case("cmd"))
                        .unwrap_or(false)
                }) {
                    return Some(cmd.clone());
                }
            }
            if let Some(first) = candidates.first() {
                return Some(first.clone());
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
            if c.exists() && !is_sdk_bundled(&c) {
                return Some(c);
            }
        }
    } else {
        if let Ok(appdata) = std::env::var("APPDATA") {
            for name in ["claude.cmd", "claude.ps1", "claude"] {
                let p = PathBuf::from(&appdata).join("npm").join(name);
                if p.exists() && !is_sdk_bundled(&p) {
                    return Some(p);
                }
            }
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            for name in ["claude.cmd", "claude.exe", "claude"] {
                let p = PathBuf::from(&home).join(".local").join("bin").join(name);
                if p.exists() && !is_sdk_bundled(&p) {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// `claude --version` 出力から先頭の semver らしい文字列を抽出する。
///
/// 想定入力例:
///   - "Claude Code 2.1.113 (Claude Code, Anthropic)\n"
///   - "claude 2.0.73\n"
///   - "2.1.113"
///
/// 戻り値は "2.1.113" のような `MAJOR.MINOR.PATCH` 文字列（pre-release / build
/// metadata は捨てる）。マッチしなければ None。
fn extract_semver(s: &str) -> Option<String> {
    // 正規表現を入れず、ASCII で愚直に MAJOR.MINOR.PATCH を探す。
    // どこかに `\d+.\d+.\d+` がある最初の出現を返す。
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            // 第 1 セグメント
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'.' {
                let dot1 = i;
                i += 1;
                let s2_start = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > s2_start && i < bytes.len() && bytes[i] == b'.' {
                    i += 1;
                    let s3_start = i;
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i > s3_start {
                        let raw = &s[start..i];
                        return Some(raw.to_string());
                    }
                }
                // 不発: 戻して次の数字を探す
                i = dot1 + 1;
            }
        } else {
            i += 1;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_semver_from_typical_output() {
        let s = "Claude Code 2.1.113 (Claude Code, Anthropic)\n";
        assert_eq!(extract_semver(s), Some("2.1.113".to_string()));
    }

    #[test]
    fn extract_semver_with_only_version_number() {
        assert_eq!(extract_semver("claude 2.0.73\n"), Some("2.0.73".to_string()));
        assert_eq!(extract_semver("2.1.113"), Some("2.1.113".to_string()));
    }

    #[test]
    fn extract_semver_returns_none_when_no_version() {
        assert_eq!(extract_semver(""), None);
        assert_eq!(extract_semver("Claude Code (no version)\n"), None);
        assert_eq!(extract_semver("not.a.semver"), None);
    }

    #[test]
    fn extract_semver_skips_non_triple_dots() {
        // "1.0" 単独 + "2.1.113" の組合せ → 後者を取る
        let s = "version 1.0 build 2.1.113";
        assert_eq!(extract_semver(s), Some("2.1.113".to_string()));
    }

    #[test]
    fn extract_semver_takes_first_match() {
        let s = "1.2.3 vs 4.5.6";
        assert_eq!(extract_semver(s), Some("1.2.3".to_string()));
    }
}
