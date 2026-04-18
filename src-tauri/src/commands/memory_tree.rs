//! Derived from ccmux-ide/src/ide/memory_tree.rs (MIT Licensed).
//!
//! 3 スコープの CLAUDE.md 走査を Tauri command 化。
//! - Global: `~/.claude/CLAUDE.md` + `~/.claude/memory/**/*.md`
//! - Parent: `<repo>/../CLAUDE.md` を最大 3 階層まで
//! - Project: `<repo>/CLAUDE.md` + `<repo>/.claude/memory/**/*.md`

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

/// スコープ種別（UI 側で色分けに使う）。
#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Scope {
    Global,
    Parent,
    Project,
    Cwd,
}

/// フラット化済みツリーの 1 ノード。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub path: PathBuf,
    pub scope: Scope,
    pub depth: u8,
    pub label: String,
    pub is_file: bool,
}

/// Tauri command: 指定された repo_root を起点に 3 スコープを走査しフラットリストを返す。
#[tauri::command]
pub async fn scan_memory_tree(repo_root: String) -> Result<Vec<TreeNode>, String> {
    let root = PathBuf::from(repo_root);
    tokio::task::spawn_blocking(move || -> Vec<TreeNode> { scan(&root) })
        .await
        .map_err(|e| format!("join error: {e}"))
}

fn scan(repo_root: &Path) -> Vec<TreeNode> {
    let mut nodes: Vec<TreeNode> = Vec::new();

    // Global
    if let Some(home) = dirs::home_dir() {
        let global_claude = home.join(".claude").join("CLAUDE.md");
        if global_claude.is_file() {
            nodes.push(TreeNode {
                path: global_claude,
                scope: Scope::Global,
                depth: 0,
                label: "CLAUDE.md".into(),
                is_file: true,
            });
        }
        let global_mem = home.join(".claude").join("memory");
        if global_mem.is_dir() {
            collect_md_walk(&global_mem, Scope::Global, 1, &mut nodes);
        }
    }

    // Parent (最大 3 階層)
    let mut cur = repo_root.parent().map(Path::to_path_buf);
    for depth in 0..3u8 {
        let Some(dir) = cur.clone() else { break };
        let candidate = dir.join("CLAUDE.md");
        if candidate.is_file() {
            let label = format!(
                "{}/CLAUDE.md",
                dir.file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| dir.display().to_string())
            );
            nodes.push(TreeNode {
                path: candidate,
                scope: Scope::Parent,
                depth,
                label,
                is_file: true,
            });
        }
        cur = dir.parent().map(Path::to_path_buf);
    }

    // Project
    let proj_claude = repo_root.join("CLAUDE.md");
    if proj_claude.is_file() {
        nodes.push(TreeNode {
            path: proj_claude,
            scope: Scope::Project,
            depth: 0,
            label: "CLAUDE.md".into(),
            is_file: true,
        });
    }
    let proj_mem = repo_root.join(".claude").join("memory");
    if proj_mem.is_dir() {
        collect_md_walk(&proj_mem, Scope::Project, 1, &mut nodes);
    }

    nodes
}

fn collect_md_walk(dir: &Path, scope: Scope, base_depth: u8, out: &mut Vec<TreeNode>) {
    let mut entries: Vec<_> = WalkDir::new(dir)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by(|a, b| a.path().cmp(b.path()));
    for e in entries {
        let rel_depth = e
            .path()
            .strip_prefix(dir)
            .map(|r| r.components().count().saturating_sub(1) as u8)
            .unwrap_or(0);
        let label = e
            .path()
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| e.path().display().to_string());
        out.push(TreeNode {
            path: e.into_path(),
            scope,
            depth: base_depth.saturating_add(rel_depth),
            label,
            is_file: true,
        });
    }
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
    fn scan_picks_up_project_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(&root.join("CLAUDE.md"), "root doc");
        write_file(&root.join(".claude").join("memory").join("a.md"), "a");

        let nodes = scan(root);
        let project_nodes: Vec<_> =
            nodes.iter().filter(|n| n.scope == Scope::Project).collect();
        assert_eq!(project_nodes.len(), 2);
    }
}
