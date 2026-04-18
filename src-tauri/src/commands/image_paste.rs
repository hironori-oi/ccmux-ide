//! Derived from ccmux-ide/src/ide/image_paste.rs (MIT Licensed).
//!
//! Tauri command 化して Next.js 側から `invoke("save_clipboard_image")` で
//! 呼べるようにする。既存実装（arboard + wl-paste fallback + PNG save）は
//! ほぼそのまま、戻り値のみ Tauri 流儀に合わせた `Result<Option<String>, String>`。

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use arboard::{Clipboard, ImageData};
use image::{ImageBuffer, Rgba};
use time::{format_description::FormatItem, macros::format_description, OffsetDateTime};

const TS_FORMAT: &[FormatItem<'static>] = format_description!(
    "[year][month][day]T[hour][minute][second]Z"
);

/// Tauri command: クリップボード画像を PNG として保存し、絶対パスを返す。
///
/// - 画像がない場合 / 未対応 MIME の場合は `Ok(None)`。
/// - エラーは `Err(String)` で UI に伝える。
///
/// 保存先: `~/.claude/ccmux-images/paste-<UTC>-<uuid>.png`
#[tauri::command]
pub async fn save_clipboard_image() -> Result<Option<String>, String> {
    // arboard::Clipboard は !Send なので、`spawn_blocking` 内で完結させる。
    tokio::task::spawn_blocking(|| match try_save() {
        Ok(Some(p)) => Ok(Some(p.to_string_lossy().into_owned())),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("{e:#}")),
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

fn try_save() -> Result<Option<PathBuf>> {
    let mut clipboard = Clipboard::new().context("クリップボードを開けませんでした")?;

    match clipboard.get_image() {
        Ok(img) => {
            let saved = save_image_data_as_png(&img)?;
            Ok(Some(saved))
        }
        Err(arboard::Error::ContentNotAvailable) => {
            // WSLg 等で arboard が image/png を取れない場合のフォールバック。
            #[cfg(target_os = "linux")]
            {
                if let Some(saved) = try_wl_paste_as_png()? {
                    return Ok(Some(saved));
                }
            }
            Ok(None)
        }
        Err(other) => Err(anyhow::Error::new(other).context("クリップボード画像取得失敗")),
    }
}

/// `ImageData` を PNG にエンコードして既定ディレクトリに保存し、絶対パスを返す。
pub fn save_image_data_as_png(img: &ImageData<'_>) -> Result<PathBuf> {
    let width = u32::try_from(img.width).context("画像幅が u32 範囲外")?;
    let height = u32::try_from(img.height).context("画像高さが u32 範囲外")?;

    let rgba: Vec<u8> = match &img.bytes {
        Cow::Borrowed(b) => b.to_vec(),
        Cow::Owned(v) => v.clone(),
    };

    let buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, rgba)
        .ok_or_else(|| anyhow!("RGBA バッファのサイズが width*height*4 と一致しません"))?;

    let out_path = build_output_path()?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("出力ディレクトリ作成に失敗: {}", parent.display()))?;
    }

    buffer
        .save_with_format(&out_path, image::ImageFormat::Png)
        .with_context(|| format!("PNG 保存に失敗: {}", out_path.display()))?;

    Ok(out_path)
}

/// WSLg フォールバック（Linux のみ）。
#[cfg(target_os = "linux")]
fn try_wl_paste_as_png() -> Result<Option<PathBuf>> {
    use std::process::{Command, Stdio};

    let list_res = Command::new("wl-paste")
        .arg("--list-types")
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output();
    let types_out = match list_res {
        Ok(out) if out.status.success() => out,
        _ => return Ok(None),
    };
    let types = String::from_utf8_lossy(&types_out.stdout);

    let mime = if types.lines().any(|l| l.trim() == "image/png") {
        "image/png"
    } else if types.lines().any(|l| l.trim() == "image/bmp") {
        "image/bmp"
    } else {
        return Ok(None);
    };

    let img_out = Command::new("wl-paste")
        .args(["-t", mime])
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .context("wl-paste の実行に失敗")?;

    if !img_out.status.success() || img_out.stdout.is_empty() {
        return Ok(None);
    }

    let dyn_img = image::load_from_memory(&img_out.stdout)
        .context("wl-paste で取得した画像の decode に失敗")?;

    let out_path = build_output_path()?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("出力ディレクトリ作成に失敗: {}", parent.display()))?;
    }

    dyn_img
        .save_with_format(&out_path, image::ImageFormat::Png)
        .with_context(|| format!("PNG 保存に失敗: {}", out_path.display()))?;

    Ok(Some(out_path))
}

/// 出力先ディレクトリ `~/.claude/ccmux-images/` を返す。
fn output_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home directory が解決できません")?;
    Ok(home.join(".claude").join("ccmux-images"))
}

/// `~/.claude/ccmux-images/paste-<UTC>-<uuid>.png` を組み立てる。
fn build_output_path() -> Result<PathBuf> {
    let dir = output_dir()?;
    let now = OffsetDateTime::now_utc();
    let ts = now.format(&TS_FORMAT).context("タイムスタンプ整形に失敗")?;
    let suffix = uuid::Uuid::new_v4();
    let filename = format!("paste-{ts}-{suffix}.png");
    Ok(apply_long_path_prefix(&dir.join(filename)))
}

fn apply_long_path_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if s.starts_with(r"\\?\") {
            return path.to_path_buf();
        }
        if s.starts_with(r"\\") {
            return PathBuf::from(format!(r"\\?\UNC\{}", &s[2..]));
        }
        return PathBuf::from(format!(r"\\?\{s}"));
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_output_path_layout() {
        let p = build_output_path().expect("home dir must be resolvable in test env");
        let s = p.to_string_lossy();
        assert!(s.contains(".claude"), "expect .claude in path: {s}");
        assert!(s.contains("ccmux-images"), "expect ccmux-images: {s}");
        assert!(s.ends_with(".png"), "expect .png suffix: {s}");
    }

    #[test]
    fn save_image_data_roundtrip() {
        let w: usize = 8;
        let h: usize = 8;
        let mut bytes = Vec::with_capacity(w * h * 4);
        for _ in 0..(w * h) {
            bytes.extend_from_slice(&[255, 0, 0, 255]);
        }
        let img = ImageData {
            width: w,
            height: h,
            bytes: Cow::Owned(bytes),
        };
        let out = save_image_data_as_png(&img).expect("save must succeed");
        assert!(out.exists(), "PNG should exist on disk: {}", out.display());
        let _ = std::fs::remove_file(&out);
    }
}
