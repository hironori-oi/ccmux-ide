//! Skill discovery — PM-953 (v1.3 MVP / Phase 1)。
//!
//! Claude Code の公式 skill 機能（`skills-2025-10-02` beta）に準拠したスキャナ。
//! Claude Agent SDK が `AgentDefinition.skills?: string[]` と内部の `supportedCommands()`
//! で skill を認識する。ccmux-ide-gui は同じ file layout を独立に走査して
//! SlashPalette 上で **一覧表示** する（Phase 1 = list 表示のみ、実行経路は
//! 後続 Phase 2 で SDK 連携を検討）。
//!
//! ## Skill の on-disk 表現（公式仕様）
//!
//! ```text
//! ~/.claude/skills/<skill-name>/SKILL.md        # Global (user-level)
//! <project>/.claude/skills/<skill-name>/SKILL.md # Project-level
//! ```
//!
//! - 各 skill は **ディレクトリ** であり、その中の `SKILL.md` が metadata + 本文を持つ
//! - `SKILL.md` の frontmatter から `name` / `description` が抽出される
//!   (Anthropic SDK の `SkillVersion.name` / `.description` コメント参照)
//! - 同名 skill は `cwd > project > global` の順で override する（slash 同様）
//!
//! ## Phase 1 スコープ（本 module）
//!
//! - `list_skills(project_path)` command: 全スコープを走査して `SkillDef[]` を返す
//! - frontmatter parser は slash.rs の簡易版を流用（YAML fullspec 非対応）
//!
//! ## Phase 2 以降（v1.4 候補）
//!
//! - Claude Agent SDK の session 経由で `supportedCommands()` を取得し、実際に
//!   sidecar が認識している skill 一覧と UI を同期
//! - skill 実行: user prompt 先頭に skill 選択を挿入する（SDK 側の slash 経由）
//!   or AgentDefinition.skills へ preload する
//!
//! ## slash.rs との違い
//!
//! - scan 対象が **`*.md` ファイル** ではなく **サブディレクトリ**（各 skill は dir）
//! - frontmatter の必須フィールドが `name` + `description`（Anthropic API spec）
//! - `argument-hint` は skill には無い（SlashCommand 型の `argumentHint` は Skill 由来
//!   ではあるが、ディスク上の SKILL.md frontmatter には現仕様で現れない）

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// フロントエンドへ返す skill 1 件。
///
/// slash.rs の `SlashCmd` と並行定義。skill は argument_hint を持たないので省略。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDef {
    /// skill の識別名（ディレクトリ名、例: `pdf-form-filler`）。
    /// frontmatter の `name` が指定されていればそちらを優先。
    pub name: String,
    /// 1 行要約（frontmatter `description` か、本文 1 行目から抽出）。
    pub description: String,
    /// "global" | "project" | "cwd"。
    pub source: String,
    /// SKILL.md の絶対パス（Monaco preview 用）。
    pub file_path: String,
    /// skill ディレクトリの絶対パス（assets を参照する UI が将来欲しがる可能性あり）。
    pub dir_path: String,
}

/// Tauri command: `~/.claude/skills/` + active project `.claude/skills/` + cwd chain を走査する。
///
/// slash.rs と同じく、走査失敗（ディレクトリが存在しない等）は致命的ではなく
/// 空を返す。同名 skill は Cwd > Project > Global で override する。
#[tauri::command]
pub fn list_skills(project_path: Option<String>) -> Result<Vec<SkillDef>, String> {
    let project = project_path.as_deref().map(Path::new);
    let cwd = std::env::current_dir().ok();
    Ok(scan_all(project, cwd.as_deref()))
}

/// スコープ優先度（数値が小さいほど近い = 上に表示）。slash.rs と同じ rule。
fn source_rank(source: &str) -> u8 {
    match source {
        "cwd" => 0,
        "project" => 1,
        "global" => 2,
        _ => 99,
    }
}

/// 全スコープを走査して重複を解決した `Vec<SkillDef>` を返す。
fn scan_all(project_root: Option<&Path>, cwd: Option<&Path>) -> Vec<SkillDef> {
    let mut map: HashMap<String, SkillDef> = HashMap::new();

    // 1) Global: ~/.claude/skills/
    if let Some(home) = dirs::home_dir() {
        let dir = home.join(".claude").join("skills");
        for skill in scan_skills_dir(&dir, "global") {
            map.insert(skill.name.clone(), skill);
        }
    }

    // 2) Project: <project>/.claude/skills/
    if let Some(proj) = project_root {
        let dir = proj.join(".claude").join("skills");
        for skill in scan_skills_dir(&dir, "project") {
            map.insert(skill.name.clone(), skill);
        }
    }

    // 3) Cwd chain: 最大 5 階層上まで遡り、深い方を優先。
    if let Some(start) = cwd {
        let mut chain: Vec<PathBuf> = Vec::new();
        let mut cur: Option<PathBuf> = Some(start.to_path_buf());
        for _ in 0..=5 {
            let Some(p) = cur.clone() else { break };
            chain.push(p.clone());
            cur = p.parent().map(Path::to_path_buf);
        }
        // 遠い親 → 近い親 → cwd の順に insert（後勝ち）
        for dir in chain.into_iter().rev() {
            let skills = scan_skills_dir(&dir.join(".claude").join("skills"), "cwd");
            for skill in skills {
                map.insert(skill.name.clone(), skill);
            }
        }
    }

    let mut out: Vec<SkillDef> = map.into_values().collect();
    out.sort_by(|a, b| {
        let ra = source_rank(&a.source);
        let rb = source_rank(&b.source);
        ra.cmp(&rb).then_with(|| a.name.cmp(&b.name))
    });
    out
}

/// `skills_root` 直下のサブディレクトリを skill として走査する。
///
/// 各サブディレクトリ内の `SKILL.md` を見て `SkillDef` を構築。`SKILL.md` が
/// 無い場合はその skill を無視する（公式 spec 準拠、`README.md` 等は fallback
/// しない。ノイズ防止）。
fn scan_skills_dir(skills_root: &Path, source: &str) -> Vec<SkillDef> {
    let Ok(entries) = std::fs::read_dir(skills_root) else {
        return Vec::new();
    };
    let mut out: Vec<SkillDef> = Vec::new();
    for ent in entries.flatten() {
        let dir_path = ent.path();
        if !dir_path.is_dir() {
            continue;
        }
        let dir_name = dir_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if dir_name.is_empty() || dir_name.starts_with('.') {
            // `.` 始まりの hidden dir（`.cache` 等）はスキップ
            continue;
        }
        let skill_md = dir_path.join("SKILL.md");
        if !skill_md.is_file() {
            // 大文字違いの `Skill.md` / `skill.md` も許容（cross-platform 配慮）。
            let alt_candidates = ["Skill.md", "skill.md"];
            let found = alt_candidates
                .iter()
                .map(|n| dir_path.join(n))
                .find(|p| p.is_file());
            let Some(alt) = found else {
                continue;
            };
            match parse_skill_file(&alt, &dir_name, &dir_path, source) {
                Ok(skill) => out.push(skill),
                Err(e) => eprintln!("[skills] parse failed: {}: {e}", alt.display()),
            }
            continue;
        }
        match parse_skill_file(&skill_md, &dir_name, &dir_path, source) {
            Ok(skill) => out.push(skill),
            Err(e) => eprintln!("[skills] parse failed: {}: {e}", skill_md.display()),
        }
    }
    out
}

/// 1 つの SKILL.md を読んで `SkillDef` に変換する。
fn parse_skill_file(
    skill_md: &Path,
    dir_name: &str,
    dir_path: &Path,
    source: &str,
) -> Result<SkillDef, String> {
    let body = std::fs::read_to_string(skill_md).map_err(|e| format!("read: {e}"))?;
    let parsed = parse_frontmatter(&body);

    let name = parsed
        .name
        .unwrap_or_else(|| dir_name.to_string())
        .trim()
        .to_string();

    let description = parsed
        .description
        .unwrap_or_else(|| fallback_description(&body))
        .trim()
        .to_string();

    Ok(SkillDef {
        name,
        description,
        source: source.to_string(),
        file_path: skill_md.to_string_lossy().into_owned(),
        dir_path: dir_path.to_string_lossy().into_owned(),
    })
}

/// 簡易 frontmatter 解析結果。slash.rs の `ParsedMd` とほぼ同じだが、skill は
/// argument-hint を持たないため簡略化。
#[derive(Default, Debug)]
struct ParsedFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

/// `---\n...\n---\n` frontmatter を軽量解析する。無ければ全 None。
///
/// - 対応キー: `name` / `description`
/// - YAML full spec には踏み込まない（`serde_yaml` 追加依存回避）
/// - quote 済み値（`"..."` / `'...'`）は trim
fn parse_frontmatter(body: &str) -> ParsedFrontmatter {
    let mut out = ParsedFrontmatter::default();

    let trimmed = body.trim_start_matches('\u{feff}');
    let rest = if let Some(r) = trimmed.strip_prefix("---\r\n") {
        r
    } else if let Some(r) = trimmed.strip_prefix("---\n") {
        r
    } else {
        return out;
    };

    let mut fm_end: Option<usize> = None;
    let mut cursor = 0usize;
    for line in rest.lines() {
        if line.trim() == "---" {
            fm_end = Some(cursor);
            break;
        }
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
            _ => {}
        }
    }

    out
}

/// frontmatter に description が無い場合の fallback。
///
/// 本文 1 行目（非空、非 `#` heading）を返す。120 字で truncate。
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
    fn parse_frontmatter_reads_name_and_description() {
        let body = "---\nname: my-skill\ndescription: \"Does something cool\"\n---\n# body\n";
        let parsed = parse_frontmatter(body);
        assert_eq!(parsed.name.as_deref(), Some("my-skill"));
        assert_eq!(parsed.description.as_deref(), Some("Does something cool"));
    }

    #[test]
    fn parse_frontmatter_returns_empty_when_absent() {
        let body = "# Heading only\nbody line\n";
        let parsed = parse_frontmatter(body);
        assert!(parsed.name.is_none());
        assert!(parsed.description.is_none());
    }

    #[test]
    fn fallback_uses_first_non_heading_line() {
        let body = "# PDF Filler\n\nFill out PDF forms via CLI\n";
        let desc = fallback_description(body);
        assert_eq!(desc, "PDF Filler");
    }

    #[test]
    fn scan_skills_dir_requires_skill_md_in_subdir() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Valid skill: sub/SKILL.md
        write_file(
            &root.join("pdf-filler").join("SKILL.md"),
            "---\nname: pdf-filler\ndescription: Fill PDFs\n---\nbody",
        );
        // No SKILL.md → skipped
        fs::create_dir_all(root.join("empty-dir")).unwrap();
        // Hidden dir → skipped
        write_file(&root.join(".cache").join("SKILL.md"), "---\nname: cached\n---");
        // Plain file at root (not a dir) → skipped
        write_file(&root.join("not-a-skill.md"), "# ignored");

        let skills = scan_skills_dir(root, "global");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "pdf-filler");
        assert_eq!(skills[0].description, "Fill PDFs");
        assert_eq!(skills[0].source, "global");
    }

    #[test]
    fn scan_skills_dir_falls_back_to_alternate_casing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // `Skill.md` (mixed case) should still be picked up.
        write_file(
            &root.join("alt-case").join("Skill.md"),
            "---\nname: alt-case\n---\ndesc body",
        );
        let skills = scan_skills_dir(root, "global");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "alt-case");
    }

    #[test]
    fn scan_skills_dir_falls_back_name_to_dirname_when_frontmatter_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("nameless").join("SKILL.md"), "# Nameless skill\nbody");
        let skills = scan_skills_dir(root, "global");
        assert_eq!(skills.len(), 1);
        // frontmatter 無し → dirname が name、本文 1 行目 heading が description
        assert_eq!(skills[0].name, "nameless");
        assert_eq!(skills[0].description, "Nameless skill");
    }

    #[test]
    fn source_rank_matches_slash_rule() {
        assert!(source_rank("cwd") < source_rank("project"));
        assert!(source_rank("project") < source_rank("global"));
        assert!(source_rank("global") < source_rank("unknown"));
    }

    #[test]
    fn scan_skills_dir_returns_empty_when_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let skills = scan_skills_dir(&missing, "global");
        assert!(skills.is_empty());
    }
}
