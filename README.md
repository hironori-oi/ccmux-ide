# ccmux-ide

日本語ファースト + 組織運営特化の Claude Code デスクトップクライアント。

## 継承

本プロジェクトは [Shin-sibainu/ccmux](https://github.com/Shin-sibainu/ccmux) (MIT License) の fork、`ccmux-ide`（Rust TUI、v0.1.0 で archive 済）を経て、**Tauri 2 + Next.js 15 + shadcn/ui** による GUI デスクトップアプリとして新規構築されたものです。Rust backend の画像クリップボード処理 (`image_paste.rs`) / CLAUDE.md ツリー (`memory_tree.rs`) / git worktree 操作 (`worktree.rs`) / keyring 設定 (`config.rs`) / FTS5 検索スケルトン (`search_fts.rs`) は ccmux-ide から資産移植しています。

ライセンス / クレジット: `LICENSE` および各 Rust ソース冒頭の `//! Derived from ccmux-ide, MIT Licensed` を参照してください。

## 差別化軸 (DEC-023)

1. **日本語 UI + 日本語ユーザファースト** — 公式 Claude Code Desktop は英語中心
2. **Linear / Arc / Raycast 水準の洗練された UI** — shadcn/ui + framer-motion + sonner
3. **claude-code-company 組織運営との統合** — `/ceo` `/dev` `/pm` 等のスラッシュコマンド、案件管理 (`projects/PRJ-XXX`)、組織ルール連携
4. **ローカル永続化 + プライバシー重視 + FTS5 横断検索**

## 技術スタック

| 層 | 採用 |
|---|---|
| Shell | Tauri 2.1 (Rust 1.94.0 pin) |
| Frontend | Next.js 15.0.3 (App Router, static export) + React 19 + TypeScript 5.6 |
| Styling | Tailwind CSS 3.4 + shadcn/ui |
| Icon | lucide-react 0.456 |
| Font | Geist Sans + Geist Mono |
| Animation | framer-motion 11.11 |
| Toast | sonner 1.7 |
| Command Palette | cmdk 1.0.4 |
| Agent | `@anthropic-ai/claude-agent-sdk` v0.2.112+ (Node sidecar 経由) |
| Editor | Monaco 0.52 (M2 で DiffViewer として) |
| Terminal | xterm 5.5 (M3) |
| Backend | Rust (arboard / rusqlite / keyring / notify / walkdir / tokio) |

## 開発環境

- Rust 1.94.0（`rust-toolchain.toml` で固定）
- Node.js 24 LTS（nvm 推奨、v2 で実績あり）
- WSL2 Ubuntu-24.04（Windows ネイティブは WDAC 制約でビルド不可、DEC-018）

WSL2 で必要な apt パッケージ（v2 実績と同じ）:

```bash
sudo apt install -y build-essential pkg-config libssl-dev \
  libx11-dev libxcb1-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libxkbcommon-dev libwayland-dev libsecret-1-dev libdbus-1-dev \
  wl-clipboard libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev
```

## 初回セットアップ

```bash
# WSL2 Ubuntu-24.04 で作業
cd ~/
git clone https://github.com/hironori-oi/ccmux-ide.git  # TBD (現状 private)
cd ccmux-ide

# Next.js + Tauri 側
npm install

# Node sidecar (Agent SDK)
cd sidecar && npm install && cd ..

# 開発起動（Tauri + Next.js dev server）
npm run tauri:dev
```

### 環境変数

`.env.example` を `.env.local` にコピーして `ANTHROPIC_API_KEY` を埋める、または起動後の Welcome Wizard で GUI 入力してください。API Key は Rust backend の keyring (`ccmux-ide` service) に保存されます。

## プロジェクト構造

```
ccmux-ide/
├── app/                   # Next.js App Router（Welcome / Setup / Workspace）
├── components/
│   ├── ui/                # shadcn/ui コンポーネント手書き
│   └── ...
├── lib/                   # Tauri IPC ラッパー / ユーティリティ
├── hooks/                 # React hooks（use-toast 等）
├── src-tauri/             # Rust backend
│   ├── src/commands/      # ccmux-ide 由来の Tauri command 群
│   └── capabilities/      # Tauri 2 permissions
└── sidecar/               # Node.js Agent SDK sidecar
```

詳細: `projects/PRJ-012/reports/dev-pm-report-v3.md` 付録B を参照。

## Windows ネイティブビルド（CI 経由）

WSL2 の WebKitGTK では Linux IME (fcitx5/ibus) 統合が難しく日本語入力がコピペでしか不可のため、Windows ネイティブの `.exe` / `.msi` を GitHub Actions で生成します。Windows 10 以降なら WebView2 の OS IME が透過し、MS-IME / Google 日本語入力がそのまま使えます。WSL 不要。

### ビルド手順

1. リポジトリを GitHub に push（private で可）
2. GitHub UI → **Actions** タブ → **Build Windows** → **Run workflow** を押す
3. 15〜30 分程度でビルド完了（初回は Rust キャッシュ無しで時間がかかる）
4. 完了した run 画面下部の **Artifacts** から以下をダウンロード:
   - `ccmux-ide-nsis-installer` — NSIS installer `.exe`（推奨）
   - `ccmux-ide-msi-installer` — MSI installer `.msi`（企業配布向け）
   - `ccmux-ide-portable` — ポータブル実行ファイル（インストール不要）
5. 解凍して Windows 10+ 上でダブルクリック実行。API Key は初回起動時の Welcome Wizard で設定（keyring に保存）

### Sidecar のローカルビルド（任意）

CI と同じ bundle を手元で生成する場合:

```bash
cd sidecar
npm install
npm run build
# → sidecar/dist/index.mjs が生成される
```

bundle された sidecar があれば `npm run tauri:dev` も bundled mode で起動（dist が無ければ自動で dev mode の `tsx` fallback）。

## 現状ステータス

- **DEC-021**: v3 方針転換（2026-04-18）
- **DEC-022**: ccmux-ide (TUI) v0.1.0 でアーカイブ、本リポジトリが後継
- **DEC-023**: Node sidecar + Claude Agent SDK TypeScript primary
- **DEC-024**: `ccmux-ide` 仮称、正式名は M1 達成時に決定
- **現在**: 雛形作成段階（Next.js + Tauri skeleton + Rust 資産移植）

## ライセンス

MIT License（`LICENSE` 参照）。Based on [ccmux](https://github.com/Shin-sibainu/ccmux) by @Shin-sibainu, MIT Licensed.
