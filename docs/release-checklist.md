# リリースチェックリスト（v0.1.0）

本ドキュメントは ccmux-ide v0.1.0 を GitHub Release として公開するための手順とチェックリストを定義する。

- 対象: PM-303（v0.1.0 タグ push → GitHub Release 自動生成 → 公開判定）
- 前提: M3 AC チェックリスト（`docs/m3-acceptance-criteria.md`）が PASS 判定
- 関連 DEC: DEC-013（配布パイプ、未署名）、DEC-024（当面 private）、DEC-029 候補（public 化判断）

---

## 1. 事前準備（tag push の前に）

### 1.1 コード freeze

- [ ] `main` ブランチに全 Must 相当の変更が merge 済
- [ ] `pnpm typecheck` / `pnpm lint` 通過（ローカル + CI）
- [ ] `cargo check` / `cargo test` 通過（src-tauri）
- [ ] E2E 10 シナリオ緑（PM-290）

### 1.2 バージョン整合性

以下 3 箇所のバージョンが一致していること:

- [ ] `package.json` → `"version": "0.1.0"`
- [ ] `src-tauri/Cargo.toml` → `version = "0.1.0"`
- [ ] `src-tauri/tauri.conf.json` → `"version": "0.1.0"`

```bash
# 一括確認コマンド例
grep -n '"version"' package.json src-tauri/tauri.conf.json
grep -n '^version' src-tauri/Cargo.toml
```

### 1.3 ドキュメント

- [ ] `README.md` のスクリーンショットが最新ビルド由来（PM-301 / SCREENSHOTS-TODO.md 完了）
- [ ] `CHANGELOG.md` に v0.1.0 エントリ追記済（本文書末尾のテンプレート参照）
- [ ] `docs/m3-acceptance-criteria.md` の実測値欄が全項目埋まっている
- [ ] LICENSE の年号 / 著作権表記が最新

### 1.4 ブランディング素材

- [ ] `src-tauri/icons/` に全サイズ揃っている（32x32 / 128x128 / 128x128@2x / icon.icns / icon.ico）
- [ ] Welcome 画面のロゴが最終版
- [ ] スクリーンショット 5 枚が 1920x1080 PNG で `docs/screenshots/` に配置

---

## 2. Tag push → Release 自動生成

### 2.1 Tag 作成と push

```bash
# main ブランチで
git checkout main
git pull origin main

# tag 作成（annotated tag 推奨）
git tag -a v0.1.0 -m "ccmux-ide v0.1.0 - Initial M3 Full MVP release

- Welcome Wizard 4-step onboarding
- Claude Max/Pro plan auto-detection
- Japanese-first UI + 5 theme presets
- Full Claude Code ecosystem discovery (slash commands / skills / plugins / MCP)
- Monaco DiffEditor for Edit tool
- SQLite FTS5 full-text search
- Git worktree UI
- Unsigned distribution (DEC-013)

Based on ccmux by @Shin-sibainu (MIT)."

# 確認
git tag -l -n5 v0.1.0

# push
git push origin v0.1.0
```

### 2.2 GitHub Actions `release.yml` の動作確認

- [ ] tag push で `release.yml`（Chunk 1 担当）が自動発火
- [ ] matrix ビルド（windows-latest / macos-latest / ubuntu-latest）が全 green
- [ ] ビルド時間: 通常 20〜40 分、初回は Rust キャッシュなしで 60 分まで許容
- [ ] 成果物が Release draft に upload されている:
  - `ccmux-ide_0.1.0_x64-setup.exe`（NSIS）
  - `ccmux-ide_0.1.0_x64_en-US.msi`
  - `ccmux-ide_0.1.0_aarch64.dmg`（Apple Silicon）
  - `ccmux-ide_0.1.0_x64.dmg`（Intel Mac）
  - `ccmux-ide_0.1.0_amd64.AppImage`
  - `ccmux-ide_0.1.0_amd64.deb`
  - `latest.json`（updater 用メタデータ）

### 2.3 Release body 編集

- [ ] GitHub UI → Releases → Draft を開く
- [ ] Title: `ccmux-ide v0.1.0`
- [ ] Body は以下テンプレートを使用（`CHANGELOG.md` v0.1.0 セクションを流用可）

```markdown
## Highlights

ccmux-ide v0.1.0 は M3 Full MVP 初回リリースです。日本語話者向けのおしゃれな汎用 Claude Code デスクトップクライアントとして、4 軸の差別化を実装しました。

- 日本語ファースト UI、Windows IME 透過
- 4 ステップ Welcome Wizard、Claude Max / Pro 自動認証
- Monaco DiffEditor、ContextGauge、SlashPalette
- SQLite FTS5 全文検索、CLAUDE.md 3 スコープ管理
- Git worktree UI、`tauri-plugin-updater` 自動更新

詳細は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## Install

未署名配布のため、OS の警告回避手順が必要です。詳細は [README.md](./README.md#windows) を参照:

- Windows: NSIS installer（SmartScreen「詳細情報」→「実行」）
- macOS: DMG（Gatekeeper「このまま開く」）
- Linux: AppImage / deb

## Known Issues

- コード署名なし（DEC-013、EV 証明書コスト過大のため M3 許容）
- WSL2 + WebKitGTK では日本語 IME 統合が不完全、Windows ネイティブ推奨
- `latest.json` は未署名（`tauri-plugin-updater` の pubkey 空）

## Credits

Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by @Shin-sibainu (MIT).
```

### 2.4 Artifact 最終確認

- [ ] NSIS installer を Windows 11 クリーン環境（VM 推奨）でダウンロード → インストール → 起動成功
- [ ] MSI installer を同じく確認
- [ ] DMG を macOS で確認（入手できる環境なら）
- [ ] AppImage を Ubuntu 24.04 で `chmod +x && ./` で起動確認
- [ ] deb を `sudo dpkg -i` でインストール確認
- [ ] `latest.json` の `version` / `platforms[].url` が正しい URL を指す

### 2.5 `latest.json` 署名確認（M3 では未署名）

- [ ] `signature` フィールドが空文字 or 省略（pubkey 未設定のため、DEC-013 継承）
- [ ] 将来 Ed25519 鍵発行時は:
  - `tauri signer generate -w ~/.tauri/ccmux-ide.key` で鍵ペア作成
  - `tauri.conf.json` の `plugins.updater.pubkey` に公開鍵設定
  - CI の TAURI_PRIVATE_KEY / TAURI_KEY_PASSWORD secret 登録

---

## 3. 公開判定

### 3.1 当面 private 維持（M3 時点の default）

DEC-024 により新規リポジトリは当面 private。以下の条件が揃うまで public 化しない:

- [ ] M3 AC 8/8 PASS（特に AC-08 友人配布テスト Full Win）
- [ ] 1 週間の dogfood で重大バグ発生ゼロ
- [ ] README / LICENSE / クレジットの第三者確認（/review 部門 or オーナー自身の法務確認）
- [ ] Shin-sibainu 氏への礼儀として、事前に issue / discussion で通知（DEC-014 継承）

### 3.2 public 化判断（DEC-029 候補）

上記クリア後、以下を CEO 決裁:

- [ ] GitHub リポジトリを private → public に変更
- [ ] Release を draft → published に変更
- [ ] `tauri.conf.json` の updater endpoint が public URL で到達可能
- [ ] README 冒頭のバッジ（build status / license / downloads）を追加
- [ ] `organization/knowledge/prj-012-lessons-learned.md` 執筆（Learning Win 記録）

### 3.3 告知（public 化した場合）

- [ ] X / Twitter に日本語投稿
- [ ] 英語版の Show HN 検討（Hacker News）
- [ ] Qiita / Zenn 記事執筆候補（日本語ファースト + おしゃれ UI の差別化軸を前面に）

---

## 4. Rollback 手順（緊急時）

配布後に重大バグが判明した場合:

1. **Release を draft に戻す**: GitHub UI から該当 Release を "Convert to draft"
2. **Tag 削除 + 再 push**（必要なら）:
   ```bash
   git push --delete origin v0.1.0
   git tag -d v0.1.0
   # fix commit 後に再 tag
   git tag -a v0.1.0 -m "..."
   git push origin v0.1.0
   ```
3. **Updater 対策**: 既にインストール済ユーザーへの影響を最小化するため、`latest.json` を前バージョン参照に差し替え（該当なし、v0.1.0 が最初のため）
4. **ポストモーテム**: `projects/PRJ-012/progress.md` に事象 + 原因 + 対策を記録、DEC 追加検討

---

## 5. CHANGELOG.md v0.1.0 エントリ（テンプレート）

本 Chunk（Chunk 3）は `CHANGELOG.md` を新規作成しない方針。Chunk 1 が `CHANGELOG.md` を作成する前提で、以下のエントリを append する。

**Chunk 1 が未作成の場合のみ**、本文書の `## 5.1 CHANGELOG.md ひな形` をコピーしてルートに作成すること。

### 5.1 CHANGELOG.md ひな形（Chunk 1 未作成時のフォールバック）

```markdown
# Changelog

All notable changes to ccmux-ide will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-XX

### Added

- Initial M3 Full MVP release
- Welcome Wizard 4-step onboarding (Brand / API Key / Permissions / Sample Project)
- Claude Max / Pro plan auto-detection via `~/.claude/.credentials.json`
- Anthropic API Key input with keyring persistence (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- Markdown rendering with syntax highlighting (react-markdown + remark-gfm + rehype-highlight)
- ToolUseCard for Read / Edit / Bash / Glob / Grep / WebFetch / WebSearch / Task tools
- Image paste (Ctrl+V) and drag-and-drop with `@path` injection for Vision
- Monaco DiffEditor integration for Edit tool before/after visualization
- Always-on sidebar: ContextGauge / SubAgentsList / TodosList
- 5 theme presets: Tokyo Night / Catppuccin Mocha / Dracula / Nord / Claude Orange
- Claude Code slash commands discovered from `.claude/commands/` across cwd / project / global scopes
- Skills / Plugins / MCP auto-discovery with 5-scope resolution
- `CLAUDE.md` 2-scope (Global / Project, including Parent fallback) inspector with Monaco editor
- SQLite FTS5 full-text search (Ctrl+Shift+F)
- Git worktree switcher with cwd-aware sidecar restart
- Auto-updater via `tauri-plugin-updater` (unsigned, M3 MVP)

### Credits

- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust modules (`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`) derived from ccmux.

### Known Limitations

- Unsigned distribution (DEC-013)
- WSL2 + WebKitGTK has incomplete IME integration (Windows native recommended)
- `latest.json` signature disabled (pubkey unset)
```

---

## 参考

- Tauri 2 bundler docs: <https://v2.tauri.app/distribute/>
- `tauri-plugin-updater`: <https://v2.tauri.app/plugin/updater/>
- GitHub Actions `release.yml` template: ccmux 由来（DEC-013）、Chunk 1 が新規作成
