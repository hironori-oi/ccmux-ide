//! Slash command discovery — PM-200 (Week6 Chunk 1)。
//!
//! Derived from ccmux-ide/src/ide/slash_palette.rs (MIT Licensed). TUI 実装を
//! Tauri 2 command として完全に書き直した版。UI 状態（open / query / filtered）は
//! React 側の `SlashPalette` コンポーネントが保持するので、Rust 側は **純粋な
//! ファイルスキャン + frontmatter 解析** に徹する。
//!
//! スキャンスコープ:
//!   - Global    : `~/.claude/commands/*.md`
//!   - Project   : active project（引数で渡された場合） `.claude/commands/*.md`
//!
//! 重複処理: 同じ name のコマンドが両スコープに存在する場合は Project を優先する。
//! これは Claude Code CLI の実挙動（repo 直下で上書き）と整合する。
//!
//! frontmatter:
//!   ファイル先頭が `---\n` で始まる場合のみ YAML-like な簡易解析を行い、
//!   `name` / `description` / `argument-hint` を拾う。無い場合は
//!   filename (拡張子除く) を name、本文 1 行目（非空・非ヘッダ）を description とする。
//!   `#` や `##` で始まる markdown ヘッダは description 候補にする（先頭 `#` を trim）。
//!
//! ## DEC-027 汎用化（v4 Chunk B）
//!
//! 旧版で持っていた `ORGANIZATION_SLASHES` 定数（特定組織ロール 8 役の
//! ハードコード）は **本リリースで完全に削除** した。slash 一覧は純粋な
//! ファイル走査 + スコープ優先度のみで構築され、特定の組織スキーマに依存しない。
//!
//! - `SlashCmd.is_organization` は廃止
//! - 並べ替えは「スコープ（project > global）→ alphabetical」のみ
//! - UI 側の組織グループ表示も削除（`SlashPalette.tsx` 参照）
//!
//! ## DEC-051（PM-960）: cwd scope の完全撤去
//!
//! 旧版は `std::env::current_dir()` を起点に親方向へ 5 階層 walk して
//! `.claude/commands/` を追加スキャンする "cwd chain" を持っていたが、以下の
//! 問題があり廃止した:
//!
//! - デスクトップ IDE ではアプリ process の cwd はユーザーの意図と無関係
//!   （Tauri exe の起動元 or dev server 起動元）
//! - cwd chain が `~/` に到達すると `~/.claude/commands/` を「cwd」として
//!   再スキャンしてしまい、**global コマンドが cwd ラベルに上書きされる** 回帰
//! - project scope が同等の役割を果たすため cwd は冗長
//!
//! 本 release 以降は **Global / Project の 2 スコープのみ**。

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

/// フロントエンドへ返す slash 1 件。
///
/// DEC-027: `is_organization` フィールドは v4 Chunk B で削除済。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCmd {
    /// 先頭 `/` を含むコマンド名（例: `/ceo`）。
    pub name: String,
    /// 1 行要約（description）。
    pub description: String,
    /// 引数の placeholder（例: `{指示}`）。無ければ None。
    pub argument_hint: Option<String>,
    /// "global" | "project"。DEC-051 で "cwd" は廃止。
    pub source: String,
    /// 絶対パス（Monaco preview 用）。
    pub file_path: String,
}

/// Tauri command: `~/.claude/commands/` + active project `.claude/commands/` を走査する。
///
/// 引数 `project_path` が Some なら、そのディレクトリの `.claude/commands/` も
/// Project scope として追加走査する（active project が未設定なら None でよい）。
///
/// 走査失敗（ディレクトリが存在しない等）は致命的ではなく空を返すだけ。
/// Result の Err は frontend 側 fatal なケースのみ（現状は返さない）。
///
/// DEC-051: cwd chain スキャンは廃止。Global / Project の 2 スコープのみ。
#[tauri::command]
pub fn list_slash_commands(project_path: Option<String>) -> Result<Vec<SlashCmd>, String> {
    let project = project_path.as_deref().map(Path::new);
    Ok(scan_all(project))
}

/// スコープ優先度（数値が小さいほど近い = 上に表示）。
///
/// DEC-027: 旧 `organization_rank` を置換。組織ロールハードコードは削除し、
/// 純粋にスコープのみで決定する。
/// DEC-051: "cwd" を削除。
fn source_rank(source: &str) -> u8 {
    match source {
        "project" => 0,
        "global" => 1,
        _ => 99,
    }
}

/// 全スコープを走査して重複を解決した `Vec<SlashCmd>` を返す。
///
/// `project_root` は **active project のリポジトリルート**（Chunk 2 の ProjectSwitcher
/// で選択されたディレクトリ）。
fn scan_all(project_root: Option<&Path>) -> Vec<SlashCmd> {
    // name をキーに、後勝ち（Project > Global）で上書き。
    let mut map: HashMap<String, SlashCmd> = HashMap::new();

    // 1) Global
    if let Some(home) = dirs::home_dir() {
        let dir = home.join(".claude").join("commands");
        for cmd in scan_dir(&dir, "global") {
            map.insert(cmd.name.clone(), cmd);
        }
    }

    // 2) Project（active project 直下）
    if let Some(proj) = project_root {
        let dir = proj.join(".claude").join("commands");
        for cmd in scan_dir(&dir, "project") {
            map.insert(cmd.name.clone(), cmd);
        }
    }

    // 出力: スコープ（project → global）で安定化。
    // 同一スコープ内は name 昇順。
    let mut out: Vec<SlashCmd> = map.into_values().collect();
    out.sort_by(|a, b| {
        let ra = source_rank(&a.source);
        let rb = source_rank(&b.source);
        ra.cmp(&rb).then_with(|| a.name.cmp(&b.name))
    });
    out
}

/// `dir` 直下の `*.md` を走査して `SlashCmd` のリストにする。
/// ディレクトリが存在しない等は空を返す。
fn scan_dir(dir: &Path, source: &str) -> Vec<SlashCmd> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<SlashCmd> = Vec::new();
    for ent in entries.flatten() {
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        // CLAUDE.md はスラッシュコマンドではないのでスキップ（ノイズ除去）。
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if stem.is_empty() || stem.eq_ignore_ascii_case("CLAUDE") {
            continue;
        }
        match parse_cmd_file(&path, &stem, source) {
            Ok(cmd) => out.push(cmd),
            Err(e) => eprintln!("[slash] parse failed: {}: {e}", path.display()),
        }
    }
    out
}

/// 1 ファイルを読んで `SlashCmd` に変換する。
fn parse_cmd_file(path: &Path, stem: &str, source: &str) -> Result<SlashCmd, String> {
    let body = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;

    let parsed = parse_markdown(&body);
    let name = parsed
        .name
        .unwrap_or_else(|| stem.to_string())
        .trim()
        .to_string();
    let name_with_slash = if name.starts_with('/') {
        name
    } else {
        format!("/{name}")
    };

    let description = parsed
        .description
        .unwrap_or_else(|| fallback_description(&body))
        .trim()
        .to_string();

    Ok(SlashCmd {
        name: name_with_slash,
        description,
        argument_hint: parsed.argument_hint,
        source: source.to_string(),
        file_path: path.to_string_lossy().into_owned(),
    })
}

/// 簡易 markdown 解析の結果。
#[derive(Default, Debug)]
struct ParsedMd {
    name: Option<String>,
    description: Option<String>,
    argument_hint: Option<String>,
}

/// `---\nYAML\n---\n` frontmatter を軽量解析する。無ければ全フィールド None。
///
/// 対応キー: `name` / `description` / `argument-hint`（`argument_hint` も fallback 対応）。
/// クォートはダブル/シングルどちらも trim。YAML フル仕様には踏み込まない
/// （`serde_yaml` は依存追加するため見送り）。
fn parse_markdown(body: &str) -> ParsedMd {
    let mut out = ParsedMd::default();

    // 先頭が "---\n" または "---\r\n" で始まる場合のみ frontmatter あり。
    let trimmed = body.trim_start_matches('\u{feff}'); // BOM 除去
    let rest = if let Some(r) = trimmed.strip_prefix("---\r\n") {
        r
    } else if let Some(r) = trimmed.strip_prefix("---\n") {
        r
    } else {
        return out;
    };

    // 次の `---` 行までを frontmatter として切り出す。
    let mut fm_end: Option<usize> = None;
    let mut cursor = 0usize;
    for line in rest.lines() {
        if line.trim() == "---" {
            fm_end = Some(cursor);
            break;
        }
        // +1 は '\n' の分（最終行に改行が無い場合は後で adjust）。
        cursor += line.len() + 1;
    }
    let Some(end) = fm_end else {
        return out;
    };
    let fm = &rest[..end];

    for line in fm.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key_norm = key.trim().to_ascii_lowercase();
        let value_raw = value.trim();
        let value_clean = value_raw
            .trim_start_matches('"')
            .trim_end_matches('"')
            .trim_start_matches('\'')
            .trim_end_matches('\'')
            .trim()
            .to_string();
        if value_clean.is_empty() {
            continue;
        }
        match key_norm.as_str() {
            "name" => out.name = Some(value_clean),
            "description" => out.description = Some(value_clean),
            "argument-hint" | "argument_hint" => out.argument_hint = Some(value_clean),
            _ => {}
        }
    }

    out
}

/// frontmatter が無い / description を拾えない場合の fallback。
///
/// 本文 1 行目（非空）を返す。`# Title` なら先頭の `#` を剥がす。
/// 600 字を超える行は 120 字で切って省略記号を付ける（UI 崩れ防止）。
fn fallback_description(body: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let no_hash = trimmed.trim_start_matches('#').trim();
        if no_hash.is_empty() {
            continue;
        }
        if no_hash.chars().count() > 120 {
            let truncated: String = no_hash.chars().take(117).collect();
            return format!("{truncated}...");
        }
        return no_hash.to_string();
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn fallback_uses_first_heading() {
        let body = "# CEO - 最高経営責任者\n\nbody...";
        let desc = fallback_description(body);
        assert_eq!(desc, "CEO - 最高経営責任者");
    }

    #[test]
    fn frontmatter_parses_name_description_hint() {
        let body = "---\nname: my-cmd\ndescription: \"Do something cool\"\nargument-hint: \"{task}\"\n---\n# body\n";
        let parsed = parse_markdown(body);
        assert_eq!(parsed.name.as_deref(), Some("my-cmd"));
        assert_eq!(parsed.description.as_deref(), Some("Do something cool"));
        assert_eq!(parsed.argument_hint.as_deref(), Some("{task}"));
    }

    #[test]
    fn frontmatter_missing_returns_none() {
        let body = "# Heading only\nbody";
        let parsed = parse_markdown(body);
        assert!(parsed.name.is_none());
        assert!(parsed.description.is_none());
    }

    #[test]
    fn scan_dir_finds_md_and_skips_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("ceo.md"), "# CEO role");
        write_file(&root.join("CLAUDE.md"), "# ignored");
        write_file(&root.join("dev.md"), "# dev role\n");
        write_file(&root.join("notes.txt"), "# not md");

        let cmds = scan_dir(root, "global");
        let names: Vec<_> = cmds.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"/ceo"));
        assert!(names.contains(&"/dev"));
        assert_eq!(cmds.len(), 2);
    }

    #[test]
    fn source_rank_orders_project_first_then_global() {
        // DEC-051: "cwd" は廃止。project > global の 2 スコープのみ。
        assert!(source_rank("project") < source_rank("global"));
        assert!(source_rank("global") < source_rank("unknown"));
    }

    #[test]
    fn scan_project_and_global_are_independent() {
        // Global に ceo.md、Project にも ceo.md を置いたとき、それぞれが
        // 独立に scan され source ラベルも正しく付くことを確認。
        let home_root = tempfile::tempdir().unwrap();
        let project_root = tempfile::tempdir().unwrap();

        write_file(
            &home_root.path().join(".claude").join("commands").join("ceo.md"),
            "# global CEO",
        );
        write_file(
            &project_root.path().join(".claude").join("commands").join("ceo.md"),
            "# project CEO",
        );

        let cmds_global = scan_dir(
            &home_root.path().join(".claude").join("commands"),
            "global",
        );
        let cmds_project = scan_dir(
            &project_root.path().join(".claude").join("commands"),
            "project",
        );
        assert_eq!(cmds_global.len(), 1);
        assert_eq!(cmds_project.len(), 1);
        assert_eq!(cmds_global[0].source, "global");
        assert_eq!(cmds_project[0].source, "project");
    }

    #[test]
    fn scan_dir_does_not_set_organization_field_anymore() {
        // DEC-027 v4 Chunk B: SlashCmd は is_organization フィールド自体を持たない。
        // scan_dir が返す struct のフィールド集合を field 列挙でなくダミー使用で確認する。
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("ceo.md"), "# CEO");

        let cmds = scan_dir(root, "global");
        let ceo = cmds.iter().find(|c| c.name == "/ceo").unwrap();
        assert_eq!(ceo.source, "global");
        // 以下 4 フィールドの存在のみ確認（is_organization が無いことはコンパイルが保証）
        let _ = (&ceo.name, &ceo.description, &ceo.argument_hint, &ceo.file_path);
    }
}
