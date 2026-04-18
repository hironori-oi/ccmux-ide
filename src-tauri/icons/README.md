# icons/

アプリアイコンを配置するディレクトリ。`tauri.conf.json` の `bundle.icon`
から参照される。

## 必要なファイル（M1 まで空でもビルド自体は通る可能性あり、M3 配布時には必須）

| ファイル | 用途 |
|---|---|
| `32x32.png` | Linux / 汎用 |
| `128x128.png` | Linux / 汎用 |
| `128x128@2x.png` | macOS Retina / 汎用 |
| `icon.icns` | macOS バンドル |
| `icon.ico` | Windows NSIS / MSI |

## 生成方法（後日オーナー作業）

1. 1024x1024 PNG の原稿を用意する
2. `cargo install tauri-cli` 済なら:

   ```bash
   npx @tauri-apps/cli icon path/to/source.png
   ```

   で自動生成できる
3. 生成された全ファイルを本ディレクトリに配置

## 現状（2026-04-18 雛形作成時点）

アイコン未作成。`tauri build` はアイコン必須なので、配布前に上記手順で作成すること。
`tauri dev` 段階ではアイコンなしでも起動できるはず。
