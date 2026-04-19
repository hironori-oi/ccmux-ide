//! Derived from ccmux-ide/src/ide/worktree.rs (MIT Licensed).
//!
//! git worktree CRUD を Tauri command として公開。
//!
//! セキュリティ注意:
//! - shell を介さず、必ず引数配列で git バイナリを直接呼ぶ
//! - `id` (worktree 名) は `^[a-zA-Z0-9_-]+$` でバリデーション必須

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

/// 1 つの worktree を表す struct。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub branch: String,
    pub path: PathBuf,
}

/// Tauri command: `git worktree list --porcelain` を parse して返す。
#[tauri::command]
pub async fn list_worktrees(repo_root: String) -> Result<Vec<Worktree>, String> {
    tokio::task::spawn_blocking(move || -> Result<Vec<Worktree>, String> {
        let out = Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("git spawn failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "git worktree list failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(parse_worktree_list(&String::from_utf8_lossy(&out.stdout)))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Tauri command: `git worktree add -b agent/<id> <base>/<id>` を実行する。
///
/// `id` は `^[a-zA-Z0-9_-]+$` のみ許可（コマンドインジェクション防止）。
#[tauri::command]
pub async fn add_worktree(repo_root: String, id: String) -> Result<Worktree, String> {
    if !is_safe_id(&id) {
        return Err("id は英数字 / ハイフン / アンダースコアのみ使えます".into());
    }
    tokio::task::spawn_blocking(move || -> Result<Worktree, String> {
        let base = PathBuf::from(&repo_root).join(".claude-ide").join("worktrees");
        std::fs::create_dir_all(&base).map_err(|e| format!("mkdir failed: {e}"))?;
        let path = base.join(&id);
        let branch = format!("agent/{id}");

        let out = Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                &branch,
                path.to_string_lossy().as_ref(),
            ])
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("git spawn failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(Worktree { id, branch, path })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Tauri command: `git worktree remove <path> --force`。branch は残す。
#[tauri::command]
pub async fn remove_worktree(repo_root: String, id: String) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("id は英数字 / ハイフン / アンダースコアのみ使えます".into());
    }
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let path = PathBuf::from(&repo_root)
            .join(".claude-ide")
            .join("worktrees")
            .join(&id);
        let out = Command::new("git")
            .args([
                "worktree",
                "remove",
                path.to_string_lossy().as_ref(),
                "--force",
            ])
            .current_dir(&repo_root)
            .output()
            .map_err(|e| format!("git spawn failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "git worktree remove failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Tauri command: worktree 切替のための軽量ヘルパ（PM-262）。
///
/// 内部的には `git worktree list --porcelain` を呼び、指定 id の worktree が存在
/// するかを確認してから、その `path` を返す。Rust 側で cwd を切替える責務は持たず、
/// frontend が受け取った path を Zustand state に反映し、sidecar を再起動することで
/// worktree を切替える設計（DEC: 最小限の backend 変更で済むよう、switch の実体は
/// frontend 主導）。
///
/// `id` は `list_worktrees` が返す `Worktree.id`（= path の最終セグメント）。
/// メイン worktree（`repo_root` 直下）の id はリポジトリルートのディレクトリ名に
/// なるので、その点に注意。
#[tauri::command]
pub async fn switch_worktree(
    repo_root: String,
    id: String,
) -> Result<Worktree, String> {
    if id.is_empty() {
        return Err("id が空です".into());
    }
    let list = list_worktrees(repo_root.clone()).await?;
    list.into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| format!("worktree が見つかりません: id={id}"))
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn parse_worktree_list(s: &str) -> Vec<Worktree> {
    // `--porcelain` は `worktree <path>\nHEAD <sha>\nbranch refs/heads/<name>\n\n` のブロック繰返し
    let mut result = Vec::new();
    let mut cur_path: Option<PathBuf> = None;
    let mut cur_branch: Option<String> = None;

    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            // 前のブロックを flush
            if let (Some(path), Some(branch)) = (cur_path.take(), cur_branch.take()) {
                let id = path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                result.push(Worktree { id, branch, path });
            }
            cur_path = Some(PathBuf::from(rest.trim()));
        } else if let Some(rest) = line.strip_prefix("branch ") {
            cur_branch = Some(
                rest.trim()
                    .trim_start_matches("refs/heads/")
                    .to_string(),
            );
        }
    }
    // 末尾の flush
    if let (Some(path), Some(branch)) = (cur_path, cur_branch) {
        let id = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        result.push(Worktree { id, branch, path });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_id_accepts_reasonable() {
        assert!(is_safe_id("feature-123"));
        assert!(is_safe_id("my_work"));
        assert!(is_safe_id("abc"));
    }

    #[test]
    fn is_safe_id_rejects_dangerous() {
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("a b"));
        assert!(!is_safe_id("a; rm -rf /"));
        assert!(!is_safe_id("../x"));
        assert!(!is_safe_id("ひらがな"));
    }

    #[test]
    fn parse_worktree_porcelain() {
        let sample = "worktree /repo/main\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo/.claude-ide/worktrees/feat\nHEAD def456\nbranch refs/heads/agent/feat\n\n";
        let wts = parse_worktree_list(sample);
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0].branch, "main");
        assert_eq!(wts[1].branch, "agent/feat");
        assert_eq!(wts[1].id, "feat");
    }
}
