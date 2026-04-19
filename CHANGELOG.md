# Changelog

All notable changes to ccmux-ide will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release body 自動生成は `.github/workflows/release.yml` が awk でタグ chunk
（`## [v0.1.0] - ...` 〜 次の `## [` 行の直前）を抽出して使用します。タグ名と
見出しのバージョン表記を一致させてください（例: tag `v0.1.0` → 見出し `[v0.1.0]`）。

## [Unreleased]
### Added
- **公式 OAuth Usage API 連携**（PRJ-012 Round D'）。Anthropic 公式 Beta API (`GET https://api.anthropic.com/api/oauth/usage`, `anthropic-beta: oauth-2025-04-20`) を直接叩いて、Pro/Max プランの **5 時間ウィンドウ / 週次ウィンドウ / 追加クレジット**の正確な使用率と reset 時刻（ISO8601 UTC）を取得。Rust backend `get_oauth_usage` が `~/.claude/.credentials.json` の `claudeAiOauth.accessToken` を Bearer token として利用、5 分 in-memory cache + 10 秒 HTTP timeout + `reqwest` (rustls-tls) 実装。
- StatusBar 中央に公式 5h / 7d ゲージ復活（Round C で廃止していたミニゲージの後継）。`5h: 45% ▓▓ ~19:00 | 7d: 62% ▓▓▓ 4/24` 形式で色段階（<60 緑 / <85 黄 / ≥85 赤）。
- サイドバー `UsageStatsCard` 最上部の「公式レート制限」ブロックを **外部リンクカード → 実値表示**に格上げ。5h / 7d の %bar + リセット時刻（`今日 19:00` / `明日 10:00` / `4/24 09:00` の日本語 local 表記）+ `is_enabled` 有効時の追加クレジット（`%` + `used / monthly_limit USD`）を表示、手動 refresh ボタン + キャッシュ age (`cached N 分前`) 表示付き。
- エラー時の誘導文言: credentials 未検出 → `claude login` 実行案内、OAuth token 期限切れ (HTTP 401) → `claude login` で再認証案内、retry ボタンで手動再取得。

### Changed
- PRJ-012 Round A の `claude /usage` CLI TUI parse 経路は廃止。`lib/stores/claude-usage.ts` と `hooks/useClaudeRateLimits.ts` を削除し、OAuth API ベースの `lib/stores/oauth-usage.ts` / `hooks/useClaudeOAuthUsage.ts` に置換。Rust 側の `claude_usage.rs` / `get_claude_rate_limits` command は将来の JSON mode 対応に備えて残置（invoke は継続、UI からは未呼出）。

### Known Issues
- OAuth Usage API は Anthropic **Beta**（`anthropic-beta: oauth-2025-04-20`）のため仕様変更の可能性あり。top-level schema 崩壊時は UI 側で 3 ブロックそれぞれ個別に `null` 判定して partial 表示を維持する（`serde_json::from_value::<_>::ok()` で耐性を持たせた）。完全崩壊時はエラーメッセージを表示、Stage B（ローカル JSONL 集計）は引き続き利用可。
- OAuth access token は `~/.claude/.credentials.json` の `claudeAiOauth.accessToken` 平文 JSON から読む。`claude login` 未実行時はこのファイルが存在せず取得不可（エラーメッセージで誘導）。token 文字列は log / error message に絶対出さない実装。
- Round A 時代のミニゲージ仕様（AlertTriangle + 週次 Sonnet only）は OAuth API の seven_day 集約値に置き換わった（Anthropic の 7 日ウィンドウは all-models 合算のため Sonnet only は提供されない）。

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
