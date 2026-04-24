import { DocsLayout } from "@/components/DocsLayout";

export const metadata = {
  title: "アーキテクチャ",
  description:
    "Sumi の 3 層アーキテクチャ（Tauri 2 フロント + Rust バックエンド + Node.js sidecar）と Rust モジュールの概要。",
};

const toc = [
  { id: "overview", label: "全体構成" },
  { id: "frontend", label: "フロントエンド" },
  { id: "backend", label: "Rust バックエンド" },
  { id: "sidecar", label: "Node.js sidecar" },
  { id: "rust-modules", label: "Rust モジュール一覧" },
  { id: "data", label: "データ保存とプライバシー" },
];

const modules: Array<{ name: string; desc: string }> = [
  {
    name: "image_paste",
    desc: "クリップボード画像の取得・PNG/JPEG 正規化。Ctrl+V ペーストに使用。",
  },
  {
    name: "memory_tree",
    desc: "Global / Project 2 スコープの CLAUDE.md ツリー構築と読み書き。",
  },
  {
    name: "worktree",
    desc: "Git worktree 一覧 / 切替 / 作成。sidecar 再起動トリガを発火。",
  },
  {
    name: "config",
    desc: "ユーザー設定 / プロジェクト設定の読み書き・マイグレーション。",
  },
  {
    name: "search_fts",
    desc: "SQLite FTS5 による会話履歴 / ファイル / Skills の横断検索。",
  },
  {
    name: "claude_monitor",
    desc: "Claude CLI プロセスの監視。`~/.claude/` 配下の変更検知を含む。",
  },
  {
    name: "slash_palette",
    desc: "project / global の Slash コマンドをスキャンしてパレットに供給。",
  },
  {
    name: "keyring_auth",
    desc: "OS keyring（Credential Manager / Keychain / Secret Service）経由で API Key を保管。",
  },
  {
    name: "sidecar_supervisor",
    desc: "Claude Agent SDK の Node.js sidecar プロセスを起動・cwd 連動で再起動。",
  },
  {
    name: "pty_terminal",
    desc: "Rust PTY。xterm.js と双方向ブリッジし組込ターミナルを実現。",
  },
  {
    name: "updater_channel",
    desc: "tauri-plugin-updater のラッパー。GitHub Release `latest.json` ポーリング。",
  },
];

export default function ArchitecturePage() {
  return (
    <DocsLayout toc={toc}>
      <h1>アーキテクチャ</h1>
      <p>
        Sumi は 3 層構成のアプリケーションです。軽量なネイティブバイナリと
        Claude Code エコシステムとの互換性を両立させるため、Tauri 2 による WebView
        ベースの GUI、Rust によるバックエンド、そして Claude Agent SDK を内包した
        Node.js sidecar に役割を分割しています。
      </p>

      <h2 id="overview">全体構成</h2>
      <pre>{`┌──────────────────────────────────────────────┐
│  Frontend (Next.js 15 + React 19)            │
│  shadcn/ui, framer-motion, Monaco, xterm.js  │
└──────────────────┬───────────────────────────┘
                   │ Tauri commands / events
┌──────────────────┴───────────────────────────┐
│  Rust backend (Tauri 2)                      │
│  image_paste / memory_tree / worktree /      │
│  config / search_fts / claude_monitor /      │
│  slash_palette / keyring_auth / pty_terminal │
└──────────────────┬───────────────────────────┘
                   │ stdio JSON-RPC
┌──────────────────┴───────────────────────────┐
│  Node.js sidecar                             │
│  @anthropic-ai/claude-agent-sdk              │
│  MCP servers (5 scopes)                      │
└──────────────────────────────────────────────┘`}</pre>

      <h2 id="frontend">フロントエンド</h2>
      <p>
        Next.js 15 App Router + React 19 + TypeScript。UI コンポーネントは shadcn/ui
        を土台に、アニメーションは framer-motion、アイコンは lucide-react、コード
        編集は Monaco、ターミナル描画は xterm.js を用います。
      </p>

      <h2 id="backend">Rust バックエンド</h2>
      <p>
        Tauri 2 を中核に、OS ネイティブ機能（keyring、PTY、ファイル監視、
        クリップボード画像、FTS5 検索）を Rust 側で実装し、フロントエンドには
        Tauri のコマンド / イベントブリッジ経由で公開します。
      </p>

      <h2 id="sidecar">Node.js sidecar</h2>
      <p>
        Anthropic 公式の <code>@anthropic-ai/claude-agent-sdk</code> は Node.js
        ランタイムを前提としています。Sumi では、この SDK を独立した Node
        プロセス（sidecar）として起動し、stdio JSON-RPC 経由で Rust 側と会話します。
        MCP サーバーは sidecar から生やす形で扱います。
      </p>

      <h2 id="rust-modules">Rust モジュール一覧</h2>
      <p>下表は Rust 側の主要モジュールとその役割です。</p>
      <table>
        <thead>
          <tr>
            <th>モジュール</th>
            <th>説明</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.name}>
              <td>
                <code>{m.name}</code>
              </td>
              <td>{m.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="data">データ保存とプライバシー</h2>
      <ul>
        <li>
          <strong>会話履歴 / 検索インデックス</strong> — SQLite + FTS5。端末ローカル
          のみに保存され、外部送信はありません。
        </li>
        <li>
          <strong>API Key</strong> — OS keyring に暗号化保存（Windows Credential
          Manager / macOS Keychain / Linux Secret Service）。
        </li>
        <li>
          <strong>テレメトリ</strong> — 送信していません。
        </li>
        <li>
          <strong>自動更新チェック</strong> — GitHub Release の{" "}
          <code>latest.json</code> のみ取得。追加の識別情報は送信しません。
        </li>
      </ul>
    </DocsLayout>
  );
}
