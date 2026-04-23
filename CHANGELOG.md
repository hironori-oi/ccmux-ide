# Changelog

All notable changes to Sumi (formerly ccmux-ide through v1.3.1) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release body 自動生成は `.github/workflows/release.yml` が awk でタグ chunk
（`## [v0.1.0] - ...` 〜 次の `## [` 行の直前）を抽出して使用します。タグ名と
見出しのバージョン表記を一致させてください（例: tag `v0.1.0` → 見出し `[v0.1.0]`）。

## [Unreleased]

## [v1.6.0] - 2026-04-23

**Workspace-First UI** — タブ廃止、ワークスペースがアプリそのものに。Tray Bar を
icon-first の超コンパクト設計に全面刷新。

### 💎 Changed (Breaking UI)

- **タブ全廃** (PM-970)。旧「チャット / エディタ / ターミナル / プレビュー /
  ワークスペース」の 5 タブを撤去。起動時から常にワークスペース UI を表示。
  チャット / エディタ / ターミナル / プレビューは **slot へドラッグ** して
  初めて表示される設計へ統一。
- **Tray Bar を 1 行コンパクト化** (PM-970)。旧 2 段 (トレイ + レイアウト) を
  1 行に集約、高さ 44px。チップは icon-first で label は 12 文字 truncate +
  tooltip で full name 表示。チャットチップは Main のみ表示で不要な "Chat (main)"
  を削除。

### ✨ Added

- **Tray Bar 内の新規作成ボタン** (PM-970):
  - 💬+ チャット追加（青）
  - 🖥+ ターミナル追加（緑、project cwd で pty_spawn）
  - 🌐 プレビューは project 単位 1 つで常時チップ表示（ボタン不要）
  - 📝 エディタは sidebar ファイル D&D で開く（ボタン不要）
- **Sidebar ファイル → Slot 直接 D&D** (PM-970)。ProjectTree の HTML5 ネイティブ
  ドラッグ（`CCMUX_FILE_PATH_MIME`）を Slot 側で受け、`openFile` + `setSlot`
  を自動実行。`@dnd-kit` と HTML5 のハイブリッドドロップで共存。
- **LayoutSwitcher を Tray Bar 右端に inline 配置** (PM-970)。1 / 2 横 / 2 縦 /
  2x2 をアイコンボタン 4 つで切替。旧 WorkspaceView の独立行は撤去。
- **DragOverlay ghost chip** (PM-970)。ドラッグ中に浮遊するチップを表示、
  視覚フィードバック向上。

### 🔧 Fixed

- (Minor) TrayBar の幅が横に膨れて後続コントロールを押し出す regression

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.5.0] - 2026-04-23

**Workspace Mode** — チャット / エディタ / ターミナル / プレビューをドラッグ&ドロップで自由に組み合わせ表示できるヘテロ分割ワークスペース追加。

### ✨ Added

- **Workspace モード** (PM-969)。画面上部の新タブ「ワークスペース」から起動。
  画面上部に **Tray Bar**（開いている項目のドラッグソース）、下部に **1 / 2 横 / 2 縦 / 4 (2x2)** から選べる slot grid。各 slot にトレイのチップをドロップすると、その項目（chat / editor / terminal / preview）が表示される:
  - 💬 Chat セッション
  - 📝 開いているエディタファイル（PDF / 画像含む）
  - 🖥 ターミナル (pty)
  - 🌐 プレビュー
  - 任意の組み合わせ可能（例: A=Chat / B=Editor、A=Terminal / B=Preview、2x2 で全部入り）
- レイアウト配置は `sumi:workspace-layout` に localStorage 永続化（アプリ再起動後も復元）
- 依存追加: `@dnd-kit/core@^6.3.1` (~30KB、キーボード a11y 込み)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.2] - 2026-04-23

**Readability & Viewer Fixes** — チャット可読性 + PDF / 画像ビューワ対応。

### ✨ Added

- **Tool use 折り畳み表示** (PM-967)。Claude レスポンス中の `Read` / `Edit` /
  `Bash` / `Grep` 等の tool 呼び出しが数十件並んで本質的な回答が埋もれる問題
  に対応。連続する tool use を「N 件の tool 操作」の折り畳みカードに集約
  表示する。チャットヘッダ右上の 👁 toggle ボタンで「詳細表示 ON / OFF」を
  切替可能。**デフォルトは折り畳み ON**（本修正で即座に可読性改善）。
  状態は `sumi:settings` に localStorage 永続化。
- **PDF / 画像 / 動画 / 音声ビューワ** (PM-968)。エディタに PDF を開くと
  Monaco が text として流し込んで文字化けしていた問題を修正。`FileViewer`
  が拡張子を見て適切なビューワにディスパッチする:
  - `.pdf` → WebView2 / WebKit 内蔵 PDF ビューワ（iframe + `asset://` URL）
  - `.png` / `.jpg` / `.webp` / `.gif` / `.bmp` / `.ico` / `.avif` → `<img>`
  - `.svg` → `<img>`（ソース編集は拡張子判定外しで Monaco に切替可能）
  - `.mp4` / `.webm` / `.mov` / `.mkv` → `<video controls>`
  - `.mp3` / `.wav` / `.ogg` / `.flac` / `.m4a` → `<audio controls>`
  - その他 → `<FileEditor>`（Monaco、従来通り）
- **バイナリファイルの上限緩和**: テキストは従来の 1MB 制限のまま、バイナリ
  ビューワ対応ファイルは 50MB まで（PM-968）。`readTextFile` をスキップする
  ことで text / UTF-8 破損のリスクも消滅。

### 🔧 Fixed

- PDF をエディタで開くと文字化けする regression (PM-968)
- チャット画面でツール操作履歴が縦に長く連なり、ユーザー質問と Claude の
  回答が見つけづらい UX 問題 (PM-967)

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.1] - 2026-04-23

**Context Fix** — Claude Code CLI 相当のプロジェクトコンテキスト自動読込を実装。

### 🔧 Fixed: Claude がプロジェクト構造 / CLAUDE.md / skill を認識できない regression (PM-966 / DEC-055)

v1.4.0 まで、Sumi で project を開いても Claude が以下を認識できない重大な問題があった:
- `CLAUDE.md` のプロジェクトルール・指示が完全に無視され、Claude が「どのディレクトリですか？絶対パスを教えてください」と聞き返す
- `/ceo` などの skill が SlashPalette に表示されるのに、実行すると「そのスキルは登録されていません」と応答
- Claude が自身の `cwd` を Sumi インストールディレクトリ（`C:\Program Files\Sumi\...`）だと認識し、プロジェクトファイルが見えない

#### 根因（3 層の複合）
1. **sidecar cwd がプロジェクトパスでない** — `send_agent_prompt` が options JSON に `cwd` を含めず、sidecar が `process.cwd() = Sumi インストール dir` にフォールバックしていた
2. **`settingSources` が未指定** — Claude Agent SDK は `settingSources` 未設定のとき CLAUDE.md / .claude/settings.json / commands / skills / MCP を **一切自動読込しない**（Claude Code CLI との差異）
3. **skills 個別登録は実は不要** — SDK は `settingSources` 有効化で `~/.claude/skills/` + `<cwd>/.claude/skills/` を auto-discover する。個別 API 呼出は不要

#### 修正内容
- **`src-tauri/src/commands/agent.rs`**: `send_agent_prompt` の options JSON に以下 2 項目を毎回注入
  - `cwd: handle.cwd` — `SidecarHandle` に起動時保存したプロジェクトパス
  - `settingSources: ["user", "project", "local"]` — Claude Code CLI と同等の file-based 設定読込
- **`sidecar/src/index.ts`**: defense-in-depth として `settingSources` の default を `["user", "project", "local"]` に設定。debug stderr ログに `settingSources` を追加
- **`components/palette/SlashPalette.tsx`**: skill click の toast 文言を「セッションで自動で利用されます」（嘘だった）→「次のプロンプト送信時に Claude が自動で読み込みます」（DEC-055 で実際にそうなった）

#### 挙動変化
- **CLAUDE.md のルールに Claude が従い始める**（user + project 階層）
- **`/ceo` `/dev` 等の slash コマンドが実動作**
- **skills が auto-discover され呼出可能**
- **MCP servers が `.mcp.json` から自動 load**
- sidecar cwd がプロジェクト実パスに設定され、ファイル操作が project root 基準で動作

#### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed.

## [v1.4.0] - 2026-04-23

**The "Sumi" Rename Release** — `ccmux-ide` 改称 + ブランドアイデンティティ + 公式サイト公開。

### 🎨 Rebrand: ccmux-ide → Sumi (墨)

- **製品名を `ccmux-ide` から `Sumi (墨)` に改称** (PM-962 / DEC-053)。「墨の哲学 × モダンテック」をコンセプトに、侘寂 × 静謐 × 職人的 × 濃密の 4 軸で視覚言語を統一
- ロゴ / アプリアイコン / OG image / favicon を新ブランドで刷新。一筆ブラシストローク + 橙の墨滴を採用
- `productName`: `ccmux-ide` → `Sumi`、bundle identifier: `jp.improver.ccmux-ide` → `jp.improver.sumi`、crate name: `ccmux-ide` → `sumi`
- Tauri アイコン 40+ ファイル（desktop / iOS / Android）を 1024px master から再生成 (PM-963)

### 🌐 公式サイト公開

- **https://hironori-oi.github.io/ccmux-ide/** で landing + docs 5 ページ構成の公式サイトを公開 (PM-961)
- Next.js 15 + Tailwind + framer-motion で構築、GitHub Actions で自動デプロイ
- 日本語ファースト、ダークモード default、Hero `Claude Code を、墨でしたためる。`

### 🧹 汎用 Claude Code クライアント化

- claude-code-company 固有要素を完全撤去 (PM-959 / DEC-050)。「日本語ファースト + おしゃれな汎用 Claude Code クライアント」として再定義
- `cwd` scope を slash / skills / memory_tree から完全廃止し、Global / Project の 2 スコープに簡素化 (PM-960 / DEC-051)。デスクトップ IDE では process cwd はユーザー意図と無関係かつ、`~/` に walk して global コマンドが cwd ラベルに誤分類される regression を引き起こしていた

### 🔄 Transparent Migration（v1.3.x からアップグレード時に自動引継ぎ）

- **API Key**: OS keyring の service 名 `ccmux-ide` → `sumi`。旧 service に保存されていた鍵は起動時に自動で新 service へコピー + 旧削除 (PM-963 / DEC-054)
- **Project 一覧**: localStorage `ccmux-project-registry` → `sumi-project-registry`。zustand persist の初回 rehydrate でも空 state にならないよう、safeStorage.getItem を override して transparent 移行
- **UI 設定**（テーマ / アクセント / 壁紙 / フォントサイズ）: localStorage `ccmux-ide-gui:settings` → `sumi:settings`

### ✨ UX 改善

- 起動時に **ウィンドウを最大化** (PM-958)
- エディタ overlay 強度を terminal と同じ `rgba(0, 0, 0, 0.55)` に揃え、壁紙の視認性向上。`backdrop-filter: blur` は除去して壁紙の質感を保つ (PM-956 hotfix5)
- **1 pane エディタの高さが 0px に潰れる regression を修正** (PM-957)。Shell.tsx の viewMode container を `block` → `flex flex-col` に統一、SplitView 1 pane 分岐も `flex-1` → `h-full` で親 context 非依存化
- ブランド表示の重複を解消 (PM-964): Sidebar の `Sumi` ラベルと TitleBar の Sparkles アイコン、ProjectRail の Sparkles 装飾を削除。`Sumi` 表記は OS ウィンドウタイトル + アプリ TitleBar の 2 箇所に正規化
- **エディタタブ左クリックで切替できない regression を修正** (PM-964)。旧版は `DropdownMenuTrigger asChild` で tab div を包んでいたため全クリックが menu 起動を奪っていた。DropdownMenu を削除して純粋な `<div role="tab">` に戻す。閉じる導線は X ボタン + 中クリック（onAuxClick）で維持
- 1 pane チャットヘッダを固定 `Sumi` → `activeProject.title` 動的表示に (PM-965)

### ⚠️ Breaking changes

- **Auto-update 切断**: bundle identifier 変更のため v1.3.x からの auto-update は機能しない。v1.3.x ユーザーは Releases から Sumi バイナリを **手動ダウンロード** してインストールする必要あり
- **Windows install path 変更**: `%LOCALAPPDATA%\ccmux-ide\` → `\Sumi\`（旧版共存可能、手動アンインストールを推奨）
- **`~/.ccmux-ide-gui/` config dir は引き継がれない** — 初回起動は clean state。ただし localStorage + keyring は transparent migration で引継ぎ

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust modules (`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`) are derived from ccmux.

## [v1.3.1] - 2026-04-23

### Added
- **Claude Code MCP (Model Context Protocol) 対応** (PM-955)。5 scope (global / user / user-project / plugin / project-local) の `.mcp.json` / `settings.json` の `mcpServers` を統合走査、SlashPalette に MCP section (emerald accent + Plug icon) で表示。disable 機構 3 系統 (`disabledMcpServers` / `disabledMcpjsonServers` / `enabledPlugins`) も反映、secret (env) 漏洩防止。オーナー環境の stitch / aidesigner / vercel (plugin bundled) / supabase / github / playwright 等を実機認識

### Fixed
- Monaco Editor の背景が透過しすぎて text が壁紙に埋もれる bug を修正 (PM-956)。PM-870 の body `bg-transparent` 化の副作用で editor 背景が継承透過、可読性を失っていた。`bg-background/95` の div で wrap、壁紙は薄く透ける程度に抑制

### Claude Code ecosystem 3 層完成
v1.3.x で Cursor 上の Claude Code と同等の **Slash Command / Skill / Plugin / MCP** 4 層エコシステムに完全対応。

## [v1.3.0] - 2026-04-23

### Added
- **Claude Code skill 機能の可視化** (PM-953)。`~/.claude/skills/<name>/SKILL.md` を走査、SlashPalette に skill section (amber accent + Sparkles icon) で表示。global + project + cwd chain の走査、cwd > project > global override。Claude Agent SDK が session 起動時に first-class 機能として auto-discover するため、表示/preview のみで実機動作する
- **Claude Code plugin 機能の可視化** (PM-954)。`~/.claude/plugins/installed_plugins.json` index から各 plugin の `.claude-plugin/plugin.json` manifest を読込、SlashPalette に plugin section (sky accent + Package icon) で表示。`~/.claude/settings.json` の `enabledPlugins` に従って disabled plugin は dimm 表示。Agent SDK の `SdkPluginConfig` + `reloadPlugins()` first-class support により実行は SDK 側で担保。Cursor 上の Claude Code と同等の plugin ecosystem を ccmux-ide-gui で利用可能に

### Fixed
- E2E CI workflow が `apt-get update` で 20 分 timeout する問題を修正 (PM-952)。`npx playwright install --with-deps chromium` の `--with-deps` 削除 + cache hit 経路の `install-deps` step 撤去。ubuntu-24.04 runner の pre-installed deps で chromium 動作

### Known Issues
- Plugin の install/uninstall/enable toggle UI は v1.4+ で対応 (現状は CLI `claude plugin install` を使用)
- Skill / plugin の drill-down (内部 slash 一覧展開) は v1.4+ で検討
- Phase 2 として per-plugin enable/disable UI + MCP server 起動管理を v1.5+ で計画

### Credits
- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed
- Claude Code skill / plugin ecosystem integration は [Claude Code](https://docs.claude.com/en/docs/claude-code) 公式仕様に準拠

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

### Acceptance
- M3 AC チェックリストは [docs/m3-acceptance-criteria.md](./docs/m3-acceptance-criteria.md) を参照（起動時間 / バイナリサイズ / RAM / 7 日 dogfood / 画像 D&D 20 連続 / E2E 10 シナリオ / 友人配布テスト）
- リリース手順は [docs/release-checklist.md](./docs/release-checklist.md) を参照
