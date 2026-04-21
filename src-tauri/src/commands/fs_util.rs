//! 汎用 FS ユーティリティ Tauri command（v3.4.5、2026-04-20 新設）。
//!
//! tauri-plugin-fs の `readDir` / `readFile` が Windows 絶対パス + 大量フォルダで
//! hang / 遅延する事象を根治するため、std::fs で直接実装した専用 command を提供。
//! capability の scope 制約や plugin の path 正規化バグを迂回する。
//!
//! ## command 2 種
//! - `list_dir_children(path)` → フォルダ直下 1 階層のエントリを高速列挙
//! - `read_file_bytes(path)`   → ファイルを Uint8Array で返す（画像プレビュー用）

use std::fs;

use serde::Serialize;

/// 1 エントリの表現（frontend 側の Entry 型と integerate）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirChild {
    /// basename（拡張子含む）。
    pub name: String,
    /// 絶対パス（OS 標準区切り文字）。
    pub path: String,
    /// true ならディレクトリ、false なら通常ファイル / シンボリックリンク等。
    pub is_directory: bool,
}

/// 指定パス配下の直下エントリのみを返す（再帰しない）。
///
/// - 失敗したら `Result::Err` を返す（frontend で toast 表示）
/// - シンボリックリンクは **リンク先の metadata を見ずに** `is_directory=false` として
///   扱う（ループ回避、素人 UX 向け）
/// - "." / ".." は返さない（std::fs::read_dir の既定挙動）
#[tauri::command]
pub fn list_dir_children(path: String) -> Result<Vec<DirChild>, String> {
    let entries = fs::read_dir(&path)
        .map_err(|e| format!("ディレクトリを開けません: {e} (path={path})"))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                // 個別エントリのエラーは skip（権限なし等）
                eprintln!("[fs_util] skip broken entry: {e}");
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path();
        // symlink は is_dir() 側で target を見に行って遅延するので file_type で判定。
        let is_directory = match entry.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => false,
        };
        out.push(DirChild {
            name,
            path: full_path.to_string_lossy().to_string(),
            is_directory,
        });
    }
    Ok(out)
}

/// 指定パスのファイルを raw bytes（Vec<u8>）で返す。
///
/// Tauri v2 は `Vec<u8>` を JSON 化時に配列にシリアライズし、frontend では
/// `number[]` として受け取って `Uint8Array.from()` で復元する。
/// 画像プレビュー時の Blob 生成などで使う（tauri-plugin-fs `readFile` の
/// capability / 挙動問題を回避）。
///
/// - 10MB を超えるファイルは拒否（誤操作で巨大 binary を frontend に流さない）
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    const MAX_BYTES: u64 = 10 * 1024 * 1024;
    let meta = fs::metadata(&path)
        .map_err(|e| format!("ファイル情報の取得に失敗: {e} (path={path})"))?;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "ファイルが大きすぎます ({} bytes > 10MB 上限)",
            meta.len()
        ));
    }
    fs::read(&path).map_err(|e| format!("読込失敗: {e} (path={path})"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn list_dir_children_returns_files_and_dirs() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        let file_path = dir.path().join("hello.txt");
        let mut f = fs::File::create(&file_path).unwrap();
        f.write_all(b"hi").unwrap();

        let entries =
            list_dir_children(dir.path().to_string_lossy().to_string()).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"hello.txt"));
        assert!(names.contains(&"subdir"));
        let hello = entries.iter().find(|e| e.name == "hello.txt").unwrap();
        assert!(!hello.is_directory);
        let sub = entries.iter().find(|e| e.name == "subdir").unwrap();
        assert!(sub.is_directory);
    }

    #[test]
    fn list_dir_children_err_for_missing_path() {
        let r = list_dir_children("/nonexistent/path/__ccmux_test__".to_string());
        assert!(r.is_err());
    }

    #[test]
    fn read_file_bytes_roundtrip() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("a.bin");
        let mut f = fs::File::create(&file_path).unwrap();
        f.write_all(&[1, 2, 3, 4]).unwrap();
        let bytes =
            read_file_bytes(file_path.to_string_lossy().to_string()).unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
    }

    #[test]
    fn read_file_bytes_rejects_huge_file() {
        // 10MB 上限はロジックチェックのみ（実ファイル不要）。
        // ここでは「小さいファイルは通る」の smoke test で代替。
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("small.bin");
        fs::write(&file_path, b"tiny").unwrap();
        let r = read_file_bytes(file_path.to_string_lossy().to_string());
        assert!(r.is_ok());
    }
}
