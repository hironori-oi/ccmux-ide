# Changelog

All notable changes to ccmux-ide will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release body 自動生成は `.github/workflows/release.yml` が awk でタグ chunk
（`## [v0.1.0] - ...` 〜 次の `## [` 行の直前）を抽出して使用します。タグ名と
見出しのバージョン表記を一致させてください（例: tag `v0.1.0` → 見出し `[v0.1.0]`）。

## [Unreleased]
### Added
- **Claude CLI `/usage` 連携**（PRJ-012 Round A）。`get_claude_rate_limits` Tauri command で `claude /usage` を spawn し、ANSI 除去 + TUI text parser で **Anthropic 公式の 5h セッション / 週次（全モデル）/ 週次（Sonnet only）残量 % と reset 時刻**を取得。30 秒 cache + 10 秒 spawn timeout。
- StatusBar 中央に 5h reset 時刻 + 週次 Sonnet 使用率 % のミニゲージ（≥85% で AlertTriangle 警告色）。
- サイドバー `UsageStatsCard` 最上部に「公式レート制限」ブロックを追加（Stage B の JSONL 集計とは別表示）。直近 24h の background/subagent/long セッション数 + `/extra-usage` 有効状態も表示。

### Known Issues
- Claude CLI v2.1.x の `/usage` は **interactive TUI 専用**で `--json` 等の non-interactive 出力モードが存在しない。本実装は TUI 出力を ANSI 除去後に文言ベースで parse しているため、Anthropic 側の文言変更（`Current week (Sonnet only)` のラベルや `Resets ...` フォーマット等）で壊れる可能性がある。parse 失敗時は frontend 側で Stage B（JSONL 集計）を fallback として継続表示する。
- `claude` CLI 未インストール / 未ログイン時は `get_claude_rate_limits` が `Err("...")` を返し、UI には案内文言を表示する。Stage B は引き続き利用可。

## [v0.1.0] - 2026-04-19
### Added
- 日本語ファーストな Claude Code GUI クライアント（Tauri 2 + Next.js 15）
- Welcome Wizard（API Key 入力 / パーミッション説明 / サンプルプロジェクト）
- 会話履歴 SQLite 永続化（FTS5 横断検索 + セッション管理）
- Monaco DiffEditor による Edit tool 可視化
- Slash Commands 連携（`/ceo` `/dev` `/pm` `/research` `/review` `/secretary` `/marketing` `/web-ops` + プロジェクト内 `.claude/commands/`）
- PRJ-XXX プロジェクトツリー + CLAUDE.md 3 スコープビュー
- ContextGauge / SubAgents / Todos サイドバー常設
- Command Palette（Ctrl+K）+ Slash Palette + Search Palette（Ctrl+Shift+F）
- ダーク / ライトテーマ + 5 種のテーマプリセット（Tokyo Night / Catppuccin Mocha / Dracula / Nord / Claude Orange）+ アクセントカラー
- git worktree 管理 UI（作成 / 切替 / 削除）
- 画像 D&D + Ctrl+V 貼付（Agent SDK streaming input image）
- 自動更新（GitHub Release ポーリング、`tauri-plugin-updater`）
- 配布: Windows NSIS/MSI、macOS DMG (Intel + Apple Silicon)、Linux AppImage/deb

### Known Issues
- WSL2 の日本語 IME は制約あり（Windows native ビルドを推奨）
- 自己署名なし配布のため、Windows SmartScreen / macOS Gatekeeper の警告あり（README の回避手順参照）
- Updater は pubkey 未設定のため署名検証 skip（MVP 許容、M3 PM-304 で Ed25519 化予定）

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust モジュール（`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`）は ccmux から派生（DEC-008 / DEC-022）
- 組織運営統合は [claude-code-company](https://github.com/hironori-oi/claude-code-company) のメタ設計に基づく

### Acceptance
- M3 AC チェックリストは [docs/m3-acceptance-criteria.md](./docs/m3-acceptance-criteria.md) を参照（起動時間 / バイナリサイズ / RAM / 7 日 dogfood / 画像 D&D 20 連続 / E2E 10 シナリオ / 友人配布テスト）
- リリース手順は [docs/release-checklist.md](./docs/release-checklist.md) を参照
