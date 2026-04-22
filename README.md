# Sumi（墨）

> Claude Code を、墨でしたためる。

[English below](#sumi-english)

![Sumi hero](./docs/screenshots/hero.png)

---

## コンセプト

Sumi は「Cursor でも公式 Claude Code Desktop でも満たせない、日本語話者向けのおしゃれな汎用 Claude Code デスクトップクライアント」です。墨の哲学（侘寂 × 静謐 × 職人的 × 濃密）をデザイン言語に据え、以下 4 軸で差別化します。

- **日本語ファースト** — 全 UI 日本語、Windows ネイティブビルドでの IME（MS-IME / Google 日本語入力）透過、日本語ドキュメント優先
- **おしゃれ** — shadcn/ui + framer-motion + Geist + lucide-react で Linear / Arc / Raycast 水準の洗練された UI、5 テーマプリセット（Tokyo Night / Catppuccin Mocha / Dracula / Nord / Claude Orange）、自由な壁紙背景
- **Claude Code エコシステム完全対応** — Slash コマンド（cwd / project / global 3 スコープ）、Skills、Plugins、MCP（5 スコープ）を自動検出。プロジェクトルート配下の `.claude/` 以下をそのまま尊重し、どんな組織体系・ワークフローでも差し込めば動く
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

Sumi は現在 **M3 MVP 段階**のため、バイナリは**未署名**で配布しています。Windows / macOS / Linux のそれぞれで OS の警告を回避する手順が必要です。v1.3.x まで「ccmux-ide」名義で配布していたものが v1.4.0 以降「Sumi」に改名されます（DEC-053 / 054、内部設定は transparent migration で引継ぎ可能）。

### Windows（推奨）

1. [Releases](https://github.com/hironori-oi/ccmux-ide/releases) から以下のいずれかをダウンロード
   - `Sumi_0.1.0_x64-setup.exe` — NSIS installer（一般ユーザー推奨）
   - `Sumi_0.1.0_x64_en-US.msi` — MSI installer（企業配布向け）
2. **Windows Defender SmartScreen が「PC を保護しました」と表示**される場合:
   - ポップアップの「詳細情報」をクリック
   - 「実行」ボタンが表示されるので押下
3. **Windows Defender ウイルス対策が検疫する**場合:
   - Windows セキュリティを開く → 「ウイルスと脅威の防止」 → 「ウイルスと脅威の防止の設定」 → 「設定の管理」
   - 「除外」セクションの「除外の追加または削除」 → 「除外の追加」 → 「フォルダー」
   - `C:\Program Files\Sumi\` または `%LOCALAPPDATA%\Sumi\` を追加
4. インストール完了後、スタートメニューから「Sumi」を起動
5. 詳細は [docs/screenshots/defender-bypass.png](./docs/screenshots/defender-bypass.png) のスクリーンショット参照（撮影予定）

> **なぜ未署名か**: 2026-03 の CA/B Forum 改定で EV コードサイニング証明書の有効期間が 1 年制限になり、Microsoft Azure Trusted Signing は日本個人事業主では利用不可のため、現時点で署名コストが過大です（DEC-013）。将来的に収益化すれば Extended Validation 証明書導入を検討します。

### macOS

1. `Sumi_0.1.0_aarch64.dmg`（Apple Silicon）または `Sumi_0.1.0_x64.dmg`（Intel）をダウンロード
2. Gatekeeper が「開発元を確認できないため開けません」と表示する場合:
   - システム設定 → プライバシーとセキュリティ → 下部の「このまま開く」をクリック
   - 管理者パスワードを入力
3. `.dmg` を開き、`Sumi.app` を `Applications` フォルダにドラッグ

### Linux

- `.AppImage` を `chmod +x Sumi_0.1.0_amd64.AppImage && ./Sumi_0.1.0_amd64.AppImage` で起動、または
- `.deb` を `sudo dpkg -i sumi_0.1.0_amd64.deb` でインストール

依存: `libwebkit2gtk-4.1-0`、`libsecret-1-0`、`wl-clipboard`（Wayland 環境）

---

## 使い方（Quick Start）

1. Sumi を起動 → Welcome Wizard で「始める」
2. **Step 2 API Key**: Claude Max / Pro プランを使っている場合は `~/.claude/.credentials.json` を自動検出するので「スキップ」。Anthropic API Key を直接入力することも可能
3. **Step 3 権限確認**: ファイル読取 / コマンド実行 / 画像保存先（`~/.claude/ccmux-images`）の説明を読んで「理解した、続ける」
4. **Step 4 サンプルプロジェクト**（任意）: `node-hello` または `python-hello` を任意の場所にコピー、または Skip で直接 Workspace へ
5. チャット欄で `/` を打つと `.claude/commands/` 配下のユーザー定義スラッシュが即選択可能（Claude Code 公式の slash / skill / plugin / MCP すべて自動検出）
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

Sumi に開発参加する場合:

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
sumi/   # repo ディレクトリ（現行 repo 名は ccmux-ide、将来 sumi へ改称予定）
├── app/                   # Next.js App Router（/ = 認証自動検出 redirect / Workspace / Settings）
├── components/
│   ├── chat/              # ChatPanel / MessageList / ToolUseCard / DiffViewer
│   ├── sidebar/           # ContextGauge / SubAgentsList / TodosList / ProjectTree
│   ├── inspector/         # MemoryTreeView / MemoryEditor / WorktreeTabs
│   ├── palette/           # CommandPalette / SlashPalette / SearchPalette
│   ├── onboarding/        # HelloBubble（初回訪問時の挨拶吹き出しのみ、v1.1 で Wizard は撤去）
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

## ライセンス

MIT License. 詳細は [LICENSE](./LICENSE) を参照。

---

<a name="sumi-english"></a>

# Sumi (English)

> Claude Code — inked in sumi.

## Concept

Sumi is a Japanese-first, polished general-purpose desktop client for [Claude Code](https://github.com/anthropics/claude-code). It differentiates on four axes the official Anthropic Claude Code Desktop and Cursor do not cover:

- **Japanese-first UI** — All strings in Japanese by default, Windows-native IME passthrough (MS-IME / Google IME), Japanese documentation priority
- **Polished aesthetics** — shadcn/ui + framer-motion + Geist + lucide-react at Linear / Arc / Raycast quality, 5 theme presets, free wallpaper background
- **Full Claude Code ecosystem support** — Slash commands (cwd / project / global 3 scopes), Skills, Plugins, and MCP (5 scopes) are auto-discovered. The app respects whatever `.claude/` tree the opened project defines, so any organizational scheme or personal workflow drops in unchanged.
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

1. Launch Sumi → click "Start" in the Welcome Wizard
2. Step 2: if you use Claude Max / Pro, click "Skip" (auto-detected from `~/.claude/.credentials.json`); otherwise paste your API key
3. Step 3 → 4: review permissions, optionally copy a sample project
4. In the chat input, type `/` to open the slash palette (user-defined commands under `.claude/commands/` are auto-discovered across cwd / project / global scopes)
5. Press `Ctrl+K` for the command palette, `Ctrl+Shift+F` for full-text search, `Ctrl+V` to paste an image

## Credits

- Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by [@Shin-sibainu](https://github.com/Shin-sibainu), MIT Licensed. Rust modules (`image_paste`, `memory_tree`, `worktree`, `config`, `search_fts`, `claude_monitor`, `slash_palette`) are derived from ccmux.

## License

MIT License. See [LICENSE](./LICENSE).
