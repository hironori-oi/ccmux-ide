//! File listing for `@file` / `@folder` mention picker (PRJ-012 v3.4 / Chunk B / DEC-034 Must 2).
//!
//! `AtMentionPicker` (frontend) が Cursor ライクに `@foo` 入力で候補を絞り込むために、
//! project_root 配下のファイル / ディレクトリ一覧を返す Tauri command を提供する。
//!
//! ## 設計
//!
//! - `ignore::WalkBuilder` を使い、`.gitignore` を自動で尊重する（ripgrep 由来）
//! - 常に除外: `node_modules` / `.git` / `target` / `dist` / `.next`
//!   （`.gitignore` に未記載な巨大ディレクトリを爆発させないため、二重 guard）
//! - `query` が Some かつ非空なら **case-insensitive substring match** で粗く絞り
//!   込み、frontend 側の fuzzy match 実装 (`lib/file-completion.ts`) に最終順位
//!   付けを委譲する（Rust 側で fuzzy を持つと LRU キャッシュが効かなくなるため）
//! - `limit`（既定 500）で打切り、過大な結果返却を防ぐ
//! - 戻り値は camelCase 化（`serde(rename_all = "camelCase")`）で TypeScript と整合
//!
//! ## 他 Chunk との排他
//!
//! 本モジュールは PRJ-012 v3.4 / Chunk B の専用ファイル。`lib.rs` / `mod.rs`
//! の編集は Chunk A / C との衝突を避けるため **末尾 append のみ**。

use std::path::{Path, PathBuf};

use serde::Serialize;

/// 1 ファイル / 1 ディレクトリの列挙結果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// project_root からの相対パス（OS separator は `/` に正規化）。
    pub path: String,
    /// 絶対パス（OS 依存 separator のまま）。
    pub abs_path: String,
    /// basename（表示用、例: `project.ts`）。
    pub name: String,
    /// ディレクトリなら true、ファイルなら false。
    pub is_directory: bool,
    /// バイト数（ディレクトリは 0）。
    pub size_bytes: u64,
}

/// 常に除外するディレクトリ名。`.gitignore` で除外されていても保険で二重 guard。
const ALWAYS_EXCLUDE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    ".venv",
    "__pycache__",
    ".turbo",
];

/// `@file` / `@folder` mention picker 用のファイル一覧取得 command。
///
/// # 引数
///
/// * `project_root` - 列挙対象のルートディレクトリ（絶対パス必須）
/// * `query` - 小文字化 substring 絞り込み。None or 空なら全件
/// * `limit` - 最大件数。None なら 500
///
/// # 戻り値
///
/// `FileEntry` のリスト。ディレクトリ / ファイル混在、order は walk 順
/// （frontend 側 `lib/file-completion.ts::fuzzyScore` が最終順位付け）。
///
/// # Error
///
/// - `project_root` が存在しない / ディレクトリでない場合 `Err(String)`
/// - walk 中のエラーは個別 entry を skip するだけで Err にしない
#[tauri::command]
pub async fn list_project_files(
    project_root: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(format!("project_root が存在しません: {project_root}"));
    }
    if !root.is_dir() {
        return Err(format!("project_root はディレクトリではありません: {project_root}"));
    }

    let limit = limit.unwrap_or(500).max(1);
    let q_lower = query
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    // 重い walk は blocking thread で回して UI スレッドを塞がない
    tokio::task::spawn_blocking(move || walk(&root, q_lower.as_deref(), limit))
        .await
        .map_err(|e| format!("join error: {e}"))
}

/// `ignore::WalkBuilder` で project_root 配下を .gitignore 尊重で walk する。
///
/// 所有権を持ち込み blocking 実行するため pub ではない。
fn walk(root: &Path, query_lower: Option<&str>, limit: usize) -> Vec<FileEntry> {
    use ignore::WalkBuilder;

    let mut out: Vec<FileEntry> = Vec::with_capacity(limit.min(1024));

    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false) // ドットファイル (.env 等) もデフォルトで列挙する。.gitignore で弾かれる
        .parents(true) // 親方向 .gitignore も読む
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .ignore(true)
        // `.gitignore` を非 git 配下でも適用する。ripgrep 既定は require_git=true で
        // `.git` が無いと .gitignore を無視してしまうが、project_root が未初期化
        // リポジトリ / plain directory のケースでも .gitignore を尊重したい。
        .require_git(false)
        .follow_links(false);

    // ALWAYS_EXCLUDE_DIRS を最終フィルタに渡す
    builder.filter_entry(|ent| {
        let name = ent.file_name().to_string_lossy();
        !ALWAYS_EXCLUDE_DIRS
            .iter()
            .any(|excl| name.eq_ignore_ascii_case(excl))
    });

    for result in builder.build() {
        if out.len() >= limit {
            break;
        }
        let Ok(ent) = result else {
            continue; // walk 中の I/O エラーは skip
        };

        // root 自身は skip（project_root をリストの先頭に置く必要はない）
        if ent.depth() == 0 {
            continue;
        }

        let abs_path = ent.path();
        let Ok(rel) = abs_path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel
            .to_string_lossy()
            .replace('\\', "/");
        let name = ent
            .file_name()
            .to_string_lossy()
            .into_owned();

        // ignore::DirEntry::file_type() は traverse 中の symlink follow 判定から
        // Some(FileType) を返す。None は極めて稀だが safe に skip。
        let Some(ft) = ent.file_type() else { continue };
        let is_directory = ft.is_dir();
        if !is_directory && !ft.is_file() {
            // symlink 等は skip
            continue;
        }

        // query substring filter（粗い第 1 段、frontend が最終 fuzzy scoring）
        if let Some(q) = query_lower {
            let path_lower = rel_str.to_ascii_lowercase();
            let name_lower = name.to_ascii_lowercase();
            if !path_lower.contains(q) && !name_lower.contains(q) {
                continue;
            }
        }

        let size_bytes = if is_directory {
            0
        } else {
            ent.metadata().map(|m| m.len()).unwrap_or(0)
        };

        out.push(FileEntry {
            path: rel_str,
            abs_path: abs_path.to_string_lossy().into_owned(),
            name,
            is_directory,
            size_bytes,
        });
    }

    out
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
    fn lists_regular_files_with_relative_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("a.ts"), "export {}");
        write_file(&root.join("src").join("b.ts"), "export {}");
        write_file(&root.join("README.md"), "# hi");

        let entries = walk(root, None, 500);
        // a.ts / src (dir) / src/b.ts / README.md の 4 entry
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.ts"));
        assert!(names.contains(&"b.ts"));
        assert!(names.contains(&"README.md"));
    }

    #[test]
    fn excludes_node_modules_and_git_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("node_modules").join("foo").join("index.js"), "");
        write_file(&root.join(".git").join("config"), "");
        write_file(&root.join("target").join("debug").join("out"), "");
        write_file(&root.join("src").join("main.rs"), "");

        let entries = walk(root, None, 500);
        for e in &entries {
            assert!(
                !e.path.starts_with("node_modules"),
                "node_modules が除外されていない: {}",
                e.path
            );
            assert!(!e.path.starts_with(".git"), ".git が除外されていない: {}", e.path);
            assert!(!e.path.starts_with("target"), "target が除外されていない: {}", e.path);
        }
        // src/main.rs は残るはず
        assert!(entries.iter().any(|e| e.path.ends_with("main.rs")));
    }

    #[test]
    fn respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // `ignore` crate は .gitignore を拾うには `.git` か repo root の hint が
        // 必要なケースがある。tempdir 内で `git init` は行わず、直接 .gitignore
        // を置くだけでも ripgrep 相当の動作をする（parents=true で root scan）。
        write_file(&root.join(".gitignore"), "secret.txt\n*.log\n");
        write_file(&root.join("secret.txt"), "hide me");
        write_file(&root.join("app.log"), "log");
        write_file(&root.join("public.md"), "ok");

        let entries = walk(root, None, 500);
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"public.md"));
        assert!(paths.contains(&".gitignore"));
        assert!(!paths.contains(&"secret.txt"), ".gitignore が効いていない");
        assert!(!paths.contains(&"app.log"), "*.log が効いていない");
    }

    #[test]
    fn query_substring_filters_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("Project.ts"), "");
        write_file(&root.join("util.ts"), "");
        write_file(&root.join("docs").join("Projects.md"), "");

        // "proj" で絞り込み
        let entries = walk(root, Some("proj"), 500);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"Project.ts"));
        assert!(names.contains(&"Projects.md"));
        assert!(!names.contains(&"util.ts"));
    }

    #[test]
    fn limit_caps_results() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for i in 0..50 {
            write_file(&root.join(format!("f{i}.txt")), "");
        }
        let entries = walk(root, None, 10);
        assert_eq!(entries.len(), 10);
    }

    #[test]
    fn includes_directory_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("subdir").join("inner.txt"), "");

        let entries = walk(root, None, 500);
        // subdir (dir) が含まれているはず
        let dir_entry = entries.iter().find(|e| e.name == "subdir");
        assert!(dir_entry.is_some(), "ディレクトリが列挙されていない");
        assert!(dir_entry.unwrap().is_directory);
        assert_eq!(dir_entry.unwrap().size_bytes, 0);
    }

    #[test]
    fn rel_path_uses_forward_slash_even_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("a").join("b").join("c.txt"), "");

        let entries = walk(root, None, 500);
        let c = entries.iter().find(|e| e.name == "c.txt").unwrap();
        assert!(!c.path.contains('\\'), "rel path に backslash が残っている: {}", c.path);
        assert_eq!(c.path, "a/b/c.txt");
    }
}
