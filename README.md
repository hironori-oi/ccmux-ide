# ccmux-ide

> 日本語ファーストな Claude Code デスクトップクライアント + 組織運営統合 IDE

[English below](#ccmux-ide-english)

![ccmux-ide hero](./docs/screenshots/hero.png)

---

## コンセプト

ccmux-ide は「Cursor でも公式 Claude Code Desktop でも満たせない、日本語話者・組織運営ワークフロー特化の Claude IDE」を目指したオープンソースのデスクトップクライアントです。以下 4 軸で差別化します。

- **日本語ファースト** — 全 UI 日本語、Windows ネイティブビルドでの IME（MS-IME / Google 日本語入力）透過、日本語ドキュメント優先
- **おしゃれ** — shadcn/ui + framer-motion + Geist + lucide-react で Linear / Arc / Raycast 水準の洗練された UI、5 テーマプリセット（Tokyo Night / Catppuccin Mocha / Dracula / Nord / Claude Orange）
- **組織運営統合** — `claude-code-company` の 8 組織ロール（`/ceo` `/dev` `/pm` `/research` `/review` `/secretary` `/marketing` `/web-ops`）をスラッシュコマンドでワンクリック実行。`projects/PRJ-XXX/` ツリー、`CLAUDE.md` 3 スコープ（Global / Project / Cwd）を直接閲覧・編集
- **ローカル永続化 + プライバシー** — 会話履歴は SQLite + FTS5 で端末ローカルのみ保存、外部送信ゼロ、テレメトリゼロ、API Key は OS keyring（Windows Credential Manager / macOS Keychain / Linux Secret Service）経由

---

## 主要機能

- Welcome Wizard 4 ステップオンボーディング（ブランド紹介 → API Key 入力 → 権限確認 → サンプル体験）
- Claude Max / Pro プランの `~/.claude/.credentials.json` 自動検出、または Anthropic API Key 直接入力
- Markdown render（react-markdown + remark-gfm + rehype-highlight）+ ToolUseCard + streaming 表示
- 画像ペースト（Ctrl+V） + D&D + `@path` 注入で Vision 対応
- Monaco DiffEditor による Edit tool の before/after ビジュアル差分
- ContextGauge / SubAgentsList / TodosList をサイドバー常設、`claude_monitor` event 直結の 500ms throttle ライブ更新
- Ctrl+K CommandPalette、`/` SlashPalette、Ctrl+Shift+F FTS5 横断検索（snippet ハイライト付き）
- Inspector で CLAUDE.md 3 スコープ（Global `~/.claude/CLAUDE.md` / Project / Cwd）ツリー表示、Monaco で編集
- Git worktree 切替 UI、worktree ごとに sidecar を cwd 連動で再起動
- 自動更新（`tauri-plugin-updater`、GitHub Release の `latest.json` ポーリング）

---

## インストール

ccmux-ide は現在 **M3 MVP 段階**のため、バイナリは**未署名**で配布しています。Windows / macOS / Linux のそれぞれで OS の警告を回避する手順が必要です。

### Windows（推奨）

1. [Releases](https://github.com/hironori-oi/ccmux-ide/releases) から以下のいずれかをダウンロード
   - `ccmux-ide_0.1.0_x64-setup.exe` — NSIS installer（一般ユーザー推奨）
   - `ccmux-ide_0.1.0_x64_en-US.msi` — MSI installer（企業配布向け）
2. **Windows Defender SmartScreen が「PC を保護しました」と表示**される場合:
   - ポップアップの「詳細情報」をクリック
   - 「実行」ボタンが表示されるので押下
3. **Windows Defender ウイルス対策が検疫する**場合:
   - Windows セキュリティを開く → 「ウイルスと脅威の防止」 → 「ウイルスと脅威の防止の設定」 → 「設定の管理」
   - 「除外」セクションの「除外の追加または削除」 → 「除外の追加」 → 「フォルダー」
   - `C:\Program Files\ccmux-ide\` または `%LOCALAPPDATA%\ccmux-ide\` を追加
4. インストール完了後、スタートメニューから「ccmux-ide」を起動
5. 詳細は [docs/screenshots/defender-bypass.png](./docs/screenshots/defender-bypass.png) のスクリーンショット参照（撮影予定）

> **なぜ未署名か**: 2026-03 の CA/B Forum 改定で EV コードサイニング証明書の有効期間が 1 年制限になり、Microsoft Azure Trusted Signing は日本個人事業主では利用不可のため、現時点で署名コストが過大です（DEC-013）。将来的に収益化すれば Extended Validation 証明書導入を検討します。

### macOS

1. `ccmux-ide_0.1.0_aarch64.dmg`（Apple Silicon）または `ccmux-ide_0.1.0_x64.dmg`（Intel）をダウンロード
2. Gatekeeper が「開発元を確認できないため開けません」と表示する場合:
   - システム設定 → プライバシーとセキュリティ → 下部の「このまま開く」をクリック
   - 管理者パスワードを入力
3. `.dmg` を開き、`ccmux-ide.app` を `Applications` フォルダにドラッグ

### Linux

- `.AppImage` を `chmod +x ccmux-ide_0.1.0_amd64.AppImage && ./ccmux-ide_0.1.0_amd64.AppImage` で起動、または
- `.deb` を `sudo dpkg -i ccmux-ide_0.1.0_amd64.deb` でインストール

依存: `libwebkit2gtk-4.1-0`、`libsecret-1-0`、`wl-clipboard`（Wayland 環境）

---

## 使い方（Quick Start）

1. ccmux-ide を起動 → Welcome Wizard で「始める」
2. **Step 2 API Key**: Claude Max / Pro プランを使っている場合は `~/.claude/.credentials.json` を自動検出するので「スキップ」。Anthropic API Key を直接入力することも可能
3. **Step 3 権限確認**: ファイル読取 / コマンド実行 / 画像保存先（`~/.claude/ccmux-images`）の説明を読んで「理解した、続ける」
4. **Step 4 サンプルプロジェクト**（任意）: `node-hello` または `python-hello` を任意の場所にコピー、または Skip で直接 Workspace へ
5. チャット欄で `/` を打つと `/ceo` `/dev` `/pm` などの組織スラッシュが即選択可能
6. `Ctrl+K` で全機能コマンドパレット、`Ctrl+Shift+F` で会話全文検索、`Ctrl+V` で画像ペースト

---

## 動作要件

- **OS**: Windows 10 以降 / macOS 13 以降 / Linux（webkit2gtk 4.1 対応）
- **Claude Code CLI** が同一マシンにインストールされていること（`npm install -g @anthropic-ai/claude-code`）
- **Claude Pro / Max プラン** または **Anthropic API Key**（Console で取得）
- ディスク容量: 約 150 MB（本体 20〜50 MB + Claude CLI native binary 約 100 MB）
- RAM: idle 時 30〜80 MB、会話中 150〜300 MB

---

## スクリーンショット

| 画面 | 画像 |
|---|---|
| Welcome Wizard Step 1 | ![hero](./docs/screenshots/hero.png) |
| Workspace チャット | ![chat](./docs/screenshots/chat.png) |
| Monaco Diff 展開 | ![diff](./docs/screenshots/diff.png) |
| Sidebar（Project + Session + Gauge） | ![sidebar](./docs/screenshots/sidebar.png) |
| Ctrl+K CommandPalette | ![palette](./docs/screenshots/palette.png) |

> スクリーンショットは Windows ネイティブビルドで撮影します。撮影要領は [docs/screenshots/SCREENSHOTS-TODO.md](./docs/screenshots/SCREENSHOTS-TODO.md) を参照。

---

## 開発環境セットアップ

ccmux-ide に開発参加する場合:

```bash
# WSL2 Ubuntu-24.04 または Linux ネイティブ
git clone https://github.com/hironori-oi/ccmux-ide.git
cd ccmux-ide

# 依存 (apt)
sudo apt install -y build-essential pkg-config libssl-dev \
  libx11-dev libxcb1-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libxkbcommon-dev libwayland-dev libsecret-1-dev libdbus-1-dev \
  wl-clipboard libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev

# Next.js + Tauri
pnpm install

# Node sidecar (Agent SDK)
cd sidecar && pnpm install && cd ..

# 開発起動
pnpm tauri dev
```

Windows ネイティブビルド（`.exe` / `.msi` 生成）は GitHub Actions 経由で実行します（WSL 不要）。詳細は [docs/release-checklist.md](./docs/release-checklist.md) を参照。

---

## プロジェクト構造

```
ccmux-ide/
├── app/                   # Next.js App Router（Welcome / Setup / Workspace / Settings）
├── components/
│   ├── chat/              # ChatPanel / MessageList / ToolUseCard / DiffViewer
│   ├── sidebar/           # ContextGauge / SubAgentsList / TodosList / ProjectTree
│   ├── inspector/         # MemoryTreeView / MemoryEditor / WorktreeTabs
│   ├── palette/           # CommandPalette / SlashPalette / SearchPalette
│   ├── onboarding/        # WelcomeWizard 4 step
│   └── ui/                # shadcn/ui 手書き実装
├── lib/                   # Tauri IPC ラッパー / Zustand stores / 型定義
├── hooks/                 # useClaudeMonitor / useHotkeys など
├── src-tauri/             # Rust backend
│   ├── src/commands/      # image / memory / worktree / config / history / slash / search
│   ├── src/events/        # monitor.rs (claude_monitor 500ms throttle emit)
│   └── capabilities/      # Tauri 2 permissions
├── sidecar/               # Node.js Agent SDK sidecar（esbuild で inline bundle）
└── docs/                  # m3-acceptance-criteria / release-checklist / screenshots
```

---

## クレジット

- **Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu)** (MIT License). 元 ccmux は Rust TUI ベースの Claude Code multiplexer で、本プロジェクトは以下の Rust モジュールを継承しています（DEC-008 / DEC-022）:
  - `image_paste.rs`（arboard + `wl-paste` fallback、Windows / macOS / Linux / WSLg 対応）
  - `memory_tree.rs`（walkdir による `CLAUDE.md` 3 スコープスキャン）
  - `worktree.rs`（`git worktree` 操作ラッパー）
  - `config.rs`（keyring 経由の API Key 管理）
  - `search_fts.rs`（rusqlite FTS5 snippet ハイライト）
  - `claude_monitor.rs`（Agent SDK stream イベントから tokens / tool_use / todos 抽出）
  - `slash_palette.rs`（`.claude/commands/` スキャン + fuzzy match）
- 組織運営統合は [claude-code-company](https://github.com/hironori-oi/claude-code-company) のメタ設計に基づきます

## ライセンス

MIT License. 詳細は [LICENSE](./LICENSE) を参照。

---

<a name="ccmux-ide-english"></a>

# ccmux-ide (English)

> Japanese-first desktop client for Claude Code, with organization-oriented developer workflow integration.

## Concept

ccmux-ide is an open-source desktop client for [Claude Code](https://github.com/anthropics/claude-code), targeting Japanese-speaking developers and teams that manage software projects with a structured organizational workflow. It differentiates on four axes the official Anthropic Claude Code Desktop and Cursor do not cover:

- **Japanese-first UI** — All strings in Japanese by default, Windows-native IME passthrough (MS-IME / Google IME), Japanese documentation priority
- **Polished aesthetics** — shadcn/ui + framer-motion + Geist + lucide-react at Linear / Arc / Raycast quality, 5 theme presets
- **Organization workflow integration** — One-click slash commands for 8 `claude-code-company` roles (`/ceo` `/dev` `/pm` `/research` `/review` `/secretary` `/marketing` `/web-ops`), `projects/PRJ-XXX/` tree navigation, `CLAUDE.md` 3-scope (Global / Project / Cwd) viewer and Monaco editor
- **Local persistence + privacy** — All conversations stored locally in SQLite + FTS5, zero telemetry, API keys via OS keyring

## Key Features

- 4-step onboarding wizard (Brand intro → API key → Permissions → Sample project)
- Claude Max / Pro plan auto-detection via `~/.claude/.credentials.json`, or direct Anthropic API key input
- Markdown rendering + ToolUseCard + streaming display
- Image paste (Ctrl+V) + drag-and-drop + `@path` injection for Vision
- Monaco DiffEditor for Edit tool before/after visualization
- ContextGauge / SubAgents / Todos always-on sidebar
- Ctrl+K command palette, `/` slash palette, Ctrl+Shift+F FTS5 full-text search
- `CLAUDE.md` inspector with Monaco editor
- Git worktree switcher with cwd-aware sidecar restart
- Auto-updater via `tauri-plugin-updater` + GitHub Releases

## Install

Download from [Releases](https://github.com/hironori-oi/ccmux-ide/releases):

- **Windows**: `.exe` (NSIS) or `.msi`. Since the binary is unsigned, bypass SmartScreen by clicking "More info" → "Run anyway", and add the install folder to Windows Defender exclusions. See [Japanese section above](#windows) for screenshots.
- **macOS**: `.dmg` (Apple Silicon / Intel). Gatekeeper will block it; go to System Settings → Privacy & Security → "Open Anyway".
- **Linux**: `.AppImage` or `.deb`. Requires `libwebkit2gtk-4.1-0`, `libsecret-1-0`, and `wl-clipboard` on Wayland.

## Requirements

- Windows 10+ / macOS 13+ / Linux (webkit2gtk 4.1)
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- Claude Pro / Max plan or Anthropic API Key

## Quick Start

1. Launch ccmux-ide → click "Start" in the Welcome Wizard
2. Step 2: if you use Claude Max / Pro, click "Skip" (auto-detected from `~/.claude/.credentials.json`); otherwise paste your API key
3. Step 3 → 4: review permissions, optionally copy a sample project
4. In the chat input, type `/` to instantly select slash commands like `/ceo` `/dev` `/pm`
5. Press `Ctrl+K` for the command palette, `Ctrl+Shift+F` for full-text search, `Ctrl+V` to paste an image

## Credits

- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust modules (`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`) are derived from ccmux.
- Organization workflow integration is based on [claude-code-company](https://github.com/hironori-oi/claude-code-company).

## License

MIT License. See [LICENSE](./LICENSE).
