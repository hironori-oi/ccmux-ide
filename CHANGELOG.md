# Changelog

All notable changes to ccmux-ide will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release body 自動生成は `.github/workflows/release.yml` が awk でタグ chunk
（`## [v0.1.0] - ...` 〜 次の `## [` 行の直前）を抽出して使用します。タグ名と
見出しのバージョン表記を一致させてください（例: tag `v0.1.0` → 見出し `[v0.1.0]`）。

## [Unreleased]

## [v1.2.0] - 2026-04-23

### Added
- **Ctrl+P で File Palette** (VSCode/Cursor Quick Open 相当)。project 内の file を fuzzy 検索して Editor で開く。既存 Rust `list_project_files` + LRU/TTL cache 流用、warm で ~1ms 応答 (PM-948)
- **Terminal keyboard shortcut 7 種** 追加。`Ctrl+Shift+F` 検索 / `C` コピー / `V` paste / `K` clear / `N` 新規 / `W` 閉じる / `Ctrl+Tab` sub-tab 切替。`@xterm/addon-search` で scrollback 検索 (PM-947)
- **SearchPalette tool_use 構造化表示**。tool Badge + field preview + raw snippet の 2 段、`parseToolMessageContent` → regex → raw の 3 段 fallback (PM-900)
- **Preview window 位置・サイズ記憶**。project ごとに persist、次回 open で前回 geometry を復元。onMoved/onResized/onCloseRequested 経由で polling なし (PM-945)
- **session 継続性 system hint**。sidecar resume 時のみ「これは継続中の会話」hint を systemPrompt に additive append、Claude の応答変動を抑制 (PM-850)
- **起動時の project auto-restore**。前回 active だった project を自動選択、stale/null なら先頭 project、空なら未選択 (PM-950)
- **Monaco Editor theme sync**。app の dark/light と preset (Tokyo Night / Catppuccin / Dracula / Nord) に theme 追従、Ctrl+S keybinding (PM-949)
- **File icon 拡張**。docker-compose / bun.lockb / .eslintrc / .nvmrc / Makefile / CMakeLists 等を追加 (PM-949)

### Fixed
- **設定画面のフォントサイズ変更が反映されない bug を修正**。store は persist していたが DOM/Monaco/xterm に apply する処理が未実装だった。Chat / Editor / Terminal 3 pane に live 反映、persist で reload 後も維持 (PM-951)
- `FileEditor.tsx` / `FilePreviewDialog.tsx` で Monaco 存在しない theme 名 `"vs-light"` を渡していた bug を `"vs"` に修正 (silent fallback で気づかれていなかった) (PM-949)

### Known Issues
- In-window Preview (Cursor 同等 UX、案 D2) は Tauri 2 multi-webview `unstable` feature 必要のため **v1.2 でも見送り** (v1.3+ で Tauri stable 化を待って再検討)
- Preview window 新規 spawn 時に一瞬 default サイズが見える可能性 (geometry 適用前) → v1.3 で event pre-apply を検討

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed
- 組織運営統合は [claude-code-company](https://github.com/hironori-oi/claude-code-company) のメタ設計に基づく

## [v1.1.0] - 2026-04-22

### Added
- **Preview タブにアプリ内プレビュー**。Tauri 2 `WebviewWindow` を Rust 側 `WebviewWindowBuilder` で spawn、任意 HTTPS URL (yahoo.co.jp / github.com 等) を別 window で表示可能。user data dir を project/label 別に分離し、Windows WebView2 の multi-webview lock 競合を回避 (PM-943 / PM-944)
- **Terminal scrollback 保持**。tab 切替で xterm が unmount されても 256KB/pty の ring buffer に PTY output を蓄積、再 mount 時に即復元 (PM-941)

### Changed
- **Welcome Wizard 撤去 + Claude 認証自動検出**。起動時に `~/.claude/.credentials.json` の OAuth token を検出、認証済なら即 Workspace、未認証なら toast 案内 + 「ターミナルを開く」誘導 (PM-938)
- **snapshot orchestrate を Shell 側 effect に移管**。project 切替時の streaming 中 message / activity が deep copy で保持され、戻した時に途中のまま復活 (PM-890、PM-810 regression hotfix の縮退を解消)

### Fixed
- **セッション作成時にプロジェクト必須化 (3 層 validate)**。UI disable + tooltip + Store guard + Rust backend rejection (PM-939)
- PreviewPane の Tooltip が `<p>` 内にネストされて起きる React hydration error を `<div>` ラッピングに修正

### Security
- **GitHub Actions を Node 24 対応にバンプ** (PM-940)。`actions/checkout@v6` / `setup-node@v6` / `cache@v5` / `upload-artifact@v7` / `download-artifact@v8` / `action-gh-release@v3` で Node.js 20 deprecation 警告解消 (2026-06 強制切替前に対応済)
- Preview window 用の WebView2 user data dir を `$APPLOCALDATA/preview-webview/{label}/` 配下に分離、メイン webview と credential / cache 共有を回避

### Infra
- `darwin-x86_64` の runner を `macos-13` (deprecated) → `macos-14` (Apple Silicon) に変更、`x86_64-apple-darwin` は cross-compile で生成
- `v1.0.1` → `v1.1.0` tag で workflow 再 trigger、全 4 matrix (win/linux/darwin-x64/darwin-arm64) が macOS 14 以降の runner で安定動作

### Known Issues
- In-window Preview (Cursor 同等 UX、案 D2) は Tauri 2 の multi-webview `unstable` feature が必要なため **v1.1 見送り**。Tauri multi-webview stable 化を待って v1.2+ で再検討
- Preview 別 window の position / size は非記憶 (次回 open で default 位置、v1.2 候補)
- Terminal 4 pane 同時使用時の memory 消費は PTY × 4 + scrollback buffer × 4 (256KB each)
- Node.js 20 deprecation 対応は完了だが、各 action の major bump に伴う細かい挙動差分は dogfood で観察

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed
- 組織運営統合は [claude-code-company](https://github.com/hironori-oi/claude-code-company) のメタ設計に基づく

### Acceptance
- v1.1 実機検証: Preview / Terminal / Welcome 撤去 / セッション必須化 すべて合格
- v1.1-dev branch で 6 PM (938/939/940/890/941/944) + 8 hotfix を累積、実機検証合格で main merge

## [v1.0.0] - 2026-04-21

### Added
- **組込ターミナル本格版** (xterm.js + portable-pty)。cmd / PowerShell / bash / zsh / vim / python REPL 等 interactive command 対応、複数 pty の sub-tab 切替、Windows JobObject による orphan-process 防止 (PM-920 / DEC-045)
- **Preview タブ**。外部ブラウザ連携 (`@tauri-apps/plugin-shell`) による URL プレビュー、プロジェクトごとに last URL を zustand persist (PM-925 / PM-936 / DEC-046 / DEC-048)
- **Chat / Editor / Terminal の 1 / 2 / 4 pane 分割**。shadcn DropdownMenu で mode 切替、4 pane は 2×2 grid (垂直 PanelGroup 内に水平 PanelGroup 2 つ) (PM-924 / PM-937 / DEC-049 / DEC-050)
- **`/effort` slash command**。model-level thinking effort の UI 連携 (PM-840)
- **tool content の JSON 整形表示**。assistant の tool_use / tool_result を humanize、専用 view (Edit / Bash) + 汎用 pretty JSON fallback (PM-831 / PM-880)
- **公式 OAuth Usage API 連携** (Round D')。`GET https://api.anthropic.com/api/oauth/usage` で Pro/Max プランの 5 時間 / 7 日 / 追加クレジット使用率を取得。StatusBar 中央のミニゲージ + サイドバー UsageStatsCard の実値化 (5 分 cache、`claude login` 誘導)

### Changed
- **`/clear` で sidecar 再起動による完全 context リフレッシュ**。従来は conversation reset のみだったが、Claude session jsonl も cleanup (PM-910)
- **Sidebar タブ順序**: ファイル / セッション / ルール / 実行状態 → **セッション / ファイル / ルール / 実行状態**。default active tab も sessions に変更
- **Terminal Shell は conditional mount に移行**。`display:hidden` 常時 mount の 0x0 canvas race を構造的に解消 (PM-935 / DEC-047)
- Round A の `claude /usage` CLI TUI parse 経路を廃止、OAuth API ベースに全面置換 (`lib/stores/oauth-usage.ts` / `hooks/useClaudeOAuthUsage.ts`)

### Fixed
- **Split Sessions で message が誤 pane に届く regression**。pm810-claim/resolve/release の 3-phase routing で sidecar event を正しい pane に配送 (PM-810)
- **Session cache stale で resume 失敗する regression** (v3.5.19)。session 選択時の cache invalidation タイミング制御
- **背景画像が起動時に反映されない bug**。AppearanceSettings 初期化と apply-accent の race (PM-870)
- **Next.js CVE-2025-66478** (HTTP smuggling / SSRF / RCE / DoS 系 15 advisory) を 15.0.3 → 15.5.15 で解消。`npm audit critical 1 → 0` (T1-B)
- **React 19 + zustand infinite loop 3 件**。MessageList / InputArea / ActivityIndicator の selector memoize 修正
- `tailwind.config.ts` の ESM `require()` エラーを ESM import に移行
- Terminal で `term.open()` が 0x0 container で呼ばれ canvas が永続破損する bug (PM-930 → PM-935 で根治)
- Terminal の `pty_kill` deadlock (child mutex 共有で blocking wait が killer を block) を `ChildKiller` 分離で解消 (PM-921)

### Security
- **Tauri asset protocol scope 絞込**: `$HOME/**` → 8 具体 path (`$APPLOCALDATA/**` / `$APPDATA/ccmux-images/**` / `$HOME/.claude/**` / `$HOME/.ccmux-ide-gui/**` / `$HOME/Pictures/**` / `$HOME/Desktop/**` / `$HOME/Downloads/**` / `$HOME/Documents/**`) (T2-D)
- **Frontend console.log を logger wrapper で `NODE_ENV` gate 化**。実コード 12 件を `logger.debug` に置換、warn / error は production でも残置 (T1-C)
- Capability の `fs:scope $HOME/**` と `shell:allow-spawn args:true` は維持 (project cwd / sidecar args 可変要件、v1.1 で Rust 側 dynamic scope + whitelist 化予定) (T2-E)

### Removed
- **Frontend dead code 14 ファイル** (PM-770): `GitPanel` / `WorktreeTabs` / `Inspector` / `ProjectSwitcher` 等、過去の実験 UI で現在参照なし
- **Rust 孤立 command 13 個** (PM-771): `git_*` / `worktree_*` / `status_*` 系、frontend から invoke なしの v3.4 以前残骸

### Known Issues
- Terminal 4 pane は PTY process が project 当たり最大 4 個生成、メモリ消費増 (ユーザ明示選択時のみ)
- Terminal conditional mount の tradeoff として tab 切替で xterm scrollback が reset (PTY 自体は維持、v1.1 で data stream buffering 検討)
- Preview は iframe 撤退のため完全な IDE 内 preview ではなく外部ブラウザ起動式 (v1.1 で Tauri 2 secondary webview window / Phase 4 案 D を再検証)
- OAuth Usage API は Anthropic Beta のため仕様変更の可能性あり (partial `null` 判定で耐性確保)
- WSL2 の日本語 IME は制約あり (Windows native ビルドを推奨)
- 自己署名なし配布のため Windows SmartScreen / macOS Gatekeeper の警告あり (README の回避手順参照)
- Updater は pubkey 未設定のため署名検証 skip (v1.1 で Ed25519 化予定)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed
- 組織運営統合は [claude-code-company](https://github.com/hironori-oi/claude-code-company) のメタ設計に基づく

### Acceptance
- v1.0 readiness audit: `pm-release-readiness-audit.md` (Tier 1 全完了、Tier 2-D/E 完了、Tier 2-G は v1.1 候補)
- リリース手順: [docs/release-checklist.md](./docs/release-checklist.md)

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
