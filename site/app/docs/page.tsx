import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata = {
  title: "ドキュメント",
  description:
    "ccmux-ide のセットアップ・機能・キーバインド・アーキテクチャを日本語で解説するドキュメント。",
};

const toc = [
  { id: "overview", label: "ccmux-ide とは？" },
  { id: "why", label: "なぜ ccmux-ide？" },
  { id: "quickstart", label: "クイックスタート" },
  { id: "features", label: "主な機能" },
  { id: "learn-claude", label: "Claude Code を学ぶ" },
];

export default function DocsIndexPage() {
  return (
    <DocsLayout toc={toc}>
      <h1>ドキュメント</h1>
      <p>
        ccmux-ide は、日本語話者のために設計された汎用 Claude Code デスクトップ
        クライアントです。このドキュメントでは、インストールから日常的な使い方、
        そしてアプリを支える設計思想までを日本語でまとめています。
      </p>

      <h2 id="overview">ccmux-ide とは？</h2>
      <p>
        <strong>ccmux-ide</strong> は、Tauri 2 + Next.js 15 + React 19 + TypeScript で
        構築されたデスクトップクライアントです。Windows / macOS / Linux のいずれでも
        ネイティブバイナリとして動作し、Claude Code のエコシステム
        （Slash コマンド、Skills、Plugins、MCP）をそのまま扱えます。
      </p>
      <p>
        ccmux-ide は OSS プロジェクト <a href="https://github.com/Shin-sibainu/ccmux" target="_blank" rel="noreferrer">ccmux</a>
        （MIT, @Shin-sibainu）の Rust モジュール
        （<code>image_paste</code>, <code>memory_tree</code>, <code>worktree</code>,{" "}
        <code>config</code>, <code>search_fts</code>, <code>claude_monitor</code>,{" "}
        <code>slash_palette</code>）を再利用しています。ccmux が TUI のターミナル
        マルチプレクサであるのに対し、ccmux-ide はフル機能の GUI IDE であり、カテゴリ
        としては別製品です。
      </p>

      <h2 id="why">なぜ ccmux-ide？</h2>
      <ul>
        <li>
          <strong>日本語ファースト</strong> — 全 UI 日本語、IME 透過、ドキュメントも
          日本語優先。
        </li>
        <li>
          <strong>おしゃれ</strong> — shadcn/ui + framer-motion + Geist +
          lucide-react による Linear / Arc / Raycast 水準の UI。5 テーマプリセット +
          自由な壁紙背景。
        </li>
        <li>
          <strong>Claude Code エコシステム完全対応</strong> — Slash（project /
          global）、Skills、Plugins、MCP（5 スコープ）を自動検出。
        </li>
        <li>
          <strong>ローカル永続化 + プライバシー</strong> — 会話履歴は SQLite +
          FTS5 で端末ローカルのみ。外部送信ゼロ。API Key は OS keyring
          （Windows Credential Manager / macOS Keychain / Linux Secret Service）。
        </li>
      </ul>

      <h2 id="quickstart">クイックスタート</h2>
      <ol>
        <li>
          <Link href="/docs/getting-started">ダウンロードしてインストール</Link>
          する（Windows / macOS / Linux）。
        </li>
        <li>初回起動で Welcome Wizard が 4 ステップで設定を案内します。</li>
        <li>
          Claude Max / Pro プランなら <code>~/.claude/.credentials.json</code> を
          自動検出。API Key 派は keyring に保存します。
        </li>
        <li>プロジェクトを登録 → チャット / エディタ / ターミナルを使い始める。</li>
      </ol>

      <h2 id="features">主な機能</h2>
      <p>機能の全リストは <Link href="/docs/features">機能カタログ</Link> を参照してください。</p>
      <ul>
        <li>Welcome Wizard 4 ステップオンボーディング</li>
        <li>Markdown render + ToolUseCard + ストリーミング表示</li>
        <li>Monaco DiffEditor による Edit tool の before/after 差分</li>
        <li>Git worktree 切替 + worktree ごとの sidecar 再起動</li>
        <li>組込ターミナル / ブラウザプレビュー / 画面分割</li>
        <li>Ctrl+K コマンドパレット、`/` Slash パレット、Ctrl+Shift+F FTS5 検索</li>
      </ul>

      <h2 id="learn-claude">Claude Code を学ぶ</h2>
      <p>
        Claude Code 本体の使い方は
        <a href="https://docs.claude.com/en/docs/claude-code/overview" target="_blank" rel="noreferrer">
          {" "}Anthropic 公式ドキュメント
        </a>
        を参照してください。ccmux-ide はそれらの機能を GUI でアクセスしやすくする
        ラッパーです。
      </p>
    </DocsLayout>
  );
}
