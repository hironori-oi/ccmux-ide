//! PRJ-012 v1.1 / PM-944 (2026-04-20): Preview window の Rust spawn 実装。
//! PRJ-012 v1.2 / PM-945 (2026-04-20): Preview window の position / size 記憶対応。
//!   - `spawn_preview_window` signature に optional `x` / `y` / `width` / `height` を追加。
//!   - 指定がなければ従来どおり `center()` + `1280x800` で spawn（後方互換）。
//!   - 指定があれば `.position(x, y)` / `.inner_size(width, height)` を適用し、
//!     前回 close 時の geometry で再表示する。
//!   - frontend 側 (`components/preview/PreviewPane.tsx` + `lib/stores/preview.ts`) が
//!     `onMoved` / `onResized` / `onCloseRequested` でユーザー操作を捕捉し、
//!     `windowGeometries[projectId]` に persist する。次回 spawn 時に store から
//!     取り出して invoke 引数に載せる。
//!
//! ## 背景（PM-943 の 7 hotfix で解消しなかった症状）
//!
//! PM-943 (a927d7f → b675b7c) では `@tauri-apps/api/webviewWindow` の
//! `new WebviewWindow(label, opts)` 経由で preview window を spawn していたが、
//! Windows 実機で以下症状が継続発生:
//!
//! - `tauri://created` は受信する
//! - 直後の `isVisible()` が `runtime error: failed to receive message from webview`
//!   で reject される
//! - OS 上に window が現れない（Alt+Tab に出ない / タスクマネージャに preview の
//!   WebView2 process が存在しない）
//!
//! = **WebView2 process が初期化途中で破棄されている**。
//!
//! ## Root Cause
//!
//! PM-942 §8 R3「Windows は multi-webview で **user data dir 個別指定** が必須」
//! (公式 doc 明記)。
//!
//! JS API 経由では `dataDirectory` option が公開されておらず、親 webview と
//! 同じ WebView2 user data dir を共有しようとして WebView2 側の排他 lock で
//! spawn 直後に process が kill される。Rust 側 `WebviewWindowBuilder::data_directory`
//! でのみ指定可能。
//!
//! ## 実装方針
//!
//! 1. `#[tauri::command] spawn_preview_window(label, url, title?)`
//! 2. 同 label の既存 window があれば `destroy()` してから create
//!    （frontend 側の enumerate → destroy loop は削除。Rust で sync に完結）
//! 3. `app_local_data_dir()/preview-webview/{label}` を user data dir として
//!    明示指定（Windows 必須、macOS / Linux でも分離して cross-platform 一貫性を
//!    確保）
//! 4. `WebviewWindowBuilder::build()` で同期的に OS window を生成
//!    - `build()` が成功すれば OS window は既に表示されている
//!    - 失敗は `Err(String)` で frontend へ伝搬（invoke の Promise reject）
//! 5. `visible(true).focused(true).center().resizable(true)` で確実に前面表示
//!
//! ## API 契約
//!
//! ```ts
//! await invoke("spawn_preview_window", {
//!   label: "preview-<projectId>",
//!   url: "https://example.com",
//!   title: "Preview - example.com", // optional
//!   // PM-945 optional geometry (前回 close 時の値を渡す)
//!   x: 120.0,      // outer position x (physical px)
//!   y: 80.0,       // outer position y (physical px)
//!   width: 1440.0, // inner width  (physical px)
//!   height: 900.0, // inner height (physical px)
//! });
//! ```
//!
//! Promise resolve = OS window 作成成功。reject = URL parse / builder / WebView2
//! エラー（詳細は error message）。
//!
//! 4 パラメータ (x/y/width/height) は独立 optional。全部 `None` なら従来通り
//! center + 1280x800 で spawn する。部分指定（例: width/height のみ）も許容。

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Preview 用 WebviewWindow を Rust 側で spawn する。
///
/// - 同 label の既存 window があれば destroy してから create する（sync）。
/// - user data dir を `app_local_data_dir()/preview-webview/{label}` に分離し、
///   Windows WebView2 の multi-webview 共有 lock 競合を回避する。
/// - `build()` が Ok を返した時点で OS window は生成済み（visible=true で spawn）。
#[tauri::command]
pub async fn spawn_preview_window(
    app: AppHandle,
    label: String,
    url: String,
    title: Option<String>,
    // PM-945: 前回 close 時の outer position / inner size。None なら default
    // (center + 1280x800) で spawn する。frontend 側 persist store から取り出して渡す。
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    // 1. 既存 window を destroy（label 一致）
    //
    // PM-943 hotfix3 までは frontend で `getAllWebviewWindows()` → `destroy()` の
    // loop を回していたが、Tauri JS API の destroy は async + 完了保証が弱く、
    // 新規 spawn が「まだ生きている」同 label の window と衝突して `already exists`
    // が race で発生していた。Rust 側で `get_webview_window()` → `destroy()` は
    // 同 thread 同期なので、returnした直後に同 label を create しても安全。
    if let Some(existing) = app.get_webview_window(&label) {
        if let Err(e) = existing.destroy() {
            // destroy 失敗は warn 扱い（既に死んでいる / OS 側で先に消えた等）で
            // 続行。後段 build が `already exists` を返したらそのとき fail させる。
            eprintln!("[preview] destroy existing window '{label}' failed (continue): {e}");
        }
    }

    // 2. user data dir を project/label 固有に分離
    //
    // `app_local_data_dir()` は platform 別:
    //   - Windows: `%LOCALAPPDATA%\com.improver.ccmux-ide\`
    //     （identifier は tauri.conf.json の `identifier` から派生）
    //   - macOS:   `~/Library/Application Support/com.improver.ccmux-ide/`
    //   - Linux:   `~/.local/share/com.improver.ccmux-ide/`
    //
    // WebView2 は各 webview が **独自の user data dir** を使う時だけ安全に並列
    // 起動できる（公式 doc + PM-942 §8 R3）。ここで label ごとに subdir を切る
    // ことで、preview window 複数 + 親 main window が全て分離される。
    let app_local_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app_local_data_dir failed: {e}"))?;
    let preview_data_dir: PathBuf = app_local_dir.join("preview-webview").join(&label);
    std::fs::create_dir_all(&preview_data_dir)
        .map_err(|e| format!("create preview data dir failed ({preview_data_dir:?}): {e}"))?;

    // 3. URL parse（invalid URL は即 reject）
    //
    // `tauri::Url` は `url::Url` の再 export。空文字 / scheme 欠落 / 不正 host は
    // ここで parse error になる。frontend 側でも trim + 空チェックしているが、
    // 安全のため Rust でも validate する。
    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("invalid preview URL '{url}': {e}"))?;

    // 4. WebviewWindowBuilder で build
    //
    // - `visible(true)`: hotfix5 で `show()` を別呼出にしたが解消せず。
    //   builder 側で visible=true にして build 時に OS window が即出る経路に統一。
    // - `focused(true)`: 前面表示
    // - `resizable(true)`: ユーザーが自由にリサイズ可能
    // - `data_directory(preview_data_dir)`: PM-944 の本質（Windows WebView2 分離）
    //
    // PM-945: size / position は以下ロジックで決定。
    //   - width/height 両方が Some → `.inner_size(w, h)` を適用
    //   - それ以外 → 従来どおり `.inner_size(1280, 800)`（default）
    //   - x/y 両方が Some → `.position(x, y)` を適用
    //   - それ以外 → 従来どおり `.center()`（default）
    //
    // 順序注意: `.position()` は後から呼ぶと `.center()` を上書きし、逆もまた然り
    // (Tauri 内部は最後に set された側が勝つ)。よって排他で分岐させる。
    let title_final = title.unwrap_or_else(|| format!("Preview - {url}"));
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title(title_final)
        .resizable(true)
        .focused(true)
        .visible(true)
        .data_directory(preview_data_dir);

    // inner size: 保存値があれば優先、なければ default
    builder = match (width, height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => builder.inner_size(w, h),
        _ => builder.inner_size(1280.0, 800.0),
    };

    // outer position: 保存値があれば優先、なければ center
    builder = match (x, y) {
        (Some(px), Some(py)) => builder.position(px, py),
        _ => builder.center(),
    };

    builder
        .build()
        .map_err(|e| format!("build preview webview window '{label}' failed: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    // PM-945: module が compile できることを担保する smoke test。
    //
    // `#[tauri::command]` マクロは内部的に wrapper 関数を生成するため、
    // async fn 本体を直接 fn pointer として参照するのは難しい。
    // ここでは module 自体の存在のみ静的に検査する（`cargo test --lib` で
    // preview.rs の parse / type check が通ることを保証）。
    //
    // 実 window 生成は Tauri runtime context (AppHandle) が必須で、
    // MockRuntime は `WebviewWindowBuilder::build()` まで対応していないため
    // unit test では実行しない。実機検証は report の手順を参照。
    #[test]
    fn module_compiles() {
        // 型レベル check のみ。関数 body は呼ばない。
        assert!(true, "preview module is reachable");
    }
}
