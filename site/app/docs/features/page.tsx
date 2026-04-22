import { DocsLayout } from "@/components/DocsLayout";

export const metadata = {
  title: "機能カタログ",
  description: "ccmux-ide の主な機能を、スクリーンショット付きで日本語解説します。",
};

const toc = [
  { id: "onboarding", label: "オンボーディング" },
  { id: "chat", label: "チャット / Markdown" },
  { id: "images", label: "画像ペースト + Vision" },
  { id: "diff", label: "Monaco DiffEditor" },
  { id: "context", label: "コンテキスト / サブエージェント" },
  { id: "palettes", label: "コマンドパレット / 検索" },
  { id: "claudemd", label: "CLAUDE.md エディタ" },
  { id: "worktree", label: "Git worktree 連携" },
  { id: "terminal", label: "組込ターミナル / プレビュー" },
  { id: "layout", label: "画面分割" },
  { id: "updater", label: "自動更新" },
];

export default function FeaturesPage() {
  return (
    <DocsLayout toc={toc}>
      <h1>機能カタログ</h1>
      <p>
        ランディングページで紹介した 6 つの主要機能を含む、ccmux-ide の全機能を
        ひととおり解説します。スクリーンショットは順次追加予定です。
      </p>

      <h2 id="onboarding">オンボーディング</h2>
      <p>
        Welcome Wizard が 4 ステップで案内します（ようこそ / 認証 / テーマ / 最初の
        プロジェクト登録）。Claude Max / Pro プランの{" "}
        <code>~/.claude/.credentials.json</code> は自動検出します。
      </p>
      <blockquote>TODO: スクリーンショット（Wizard の 4 画面）</blockquote>

      <h2 id="chat">チャット / Markdown レンダリング</h2>
      <p>
        <code>react-markdown</code> + <code>remark-gfm</code> + <code>rehype-highlight</code>{" "}
        でコードブロックをシンタックスハイライト付きで描画します。ストリーミング
        表示に対応し、Tool Use は <strong>ToolUseCard</strong> としてカード化されます。
      </p>
      <blockquote>TODO: スクリーンショット（ストリーミング中のチャット）</blockquote>

      <h2 id="images">画像ペースト + Vision</h2>
      <p>
        Ctrl+V でクリップボード画像をペースト、またはドラッグ&ドロップで添付。
        <code>@path</code> 記法でローカルファイルを注入できます。Vision モデルに
        そのまま渡せます。
      </p>

      <h2 id="diff">Monaco DiffEditor</h2>
      <p>
        Edit tool の変更は Monaco DiffEditor で before / after を視覚化。承認／
        却下のアクションが直接 UI から行えます。
      </p>
      <blockquote>TODO: スクリーンショット（DiffEditor）</blockquote>

      <h2 id="context">コンテキスト / サブエージェント</h2>
      <p>
        右サイドバーに <strong>ContextGauge</strong>（現在の使用トークン /
        モデル上限）、<strong>SubAgentsList</strong>、<strong>TodosList</strong>{" "}
        を常設。セッション全体の状態がひと目で分かります。
      </p>

      <h2 id="palettes">コマンドパレット / 検索</h2>
      <ul>
        <li>
          <strong>Ctrl+K</strong> — CommandPalette（全アクション横断）
        </li>
        <li>
          <strong>/</strong> — SlashPalette（project / global 両スコープの Slash
          コマンド）
        </li>
        <li>
          <strong>Ctrl+Shift+F</strong> — FTS5 横断検索（会話履歴、プロジェクト
          ファイル、Slash / Skills / Plugins）
        </li>
      </ul>

      <h2 id="claudemd">CLAUDE.md エディタ</h2>
      <p>
        Global（<code>~/.claude/CLAUDE.md</code>）と Project（プロジェクトルートの{" "}
        <code>.claude/CLAUDE.md</code>）を 2 スコープのツリーで一覧表示。Monaco で
        編集でき、ライブで Claude のコンテキストに反映されます。
      </p>

      <h2 id="worktree">Git worktree 連携</h2>
      <p>
        左サイドバーに worktree セレクタを配置。切替えるたびに sidecar（Claude Agent
        SDK プロセス）が cwd 連動で再起動されるため、ブランチごとに独立した Claude
        セッションを保持できます。
      </p>

      <h2 id="terminal">組込ターミナル / ブラウザプレビュー</h2>
      <ul>
        <li>
          <strong>組込ターミナル</strong> — xterm.js + Rust PTY。ログイン shell を
          そのまま起動し、シェル初期化スクリプトや alias も効きます。
        </li>
        <li>
          <strong>ブラウザプレビュー</strong> — iframe に URL をロード。iframe で
          読み込めないサイトは自動で外部ブラウザにフォールバックします。
        </li>
      </ul>

      <h2 id="layout">画面分割</h2>
      <p>
        1 / 2 / 4 ペインで自由にレイアウト可能。各ペインに Chat / Editor / Terminal
        のいずれかを割り当てできます。
      </p>

      <h2 id="updater">自動更新</h2>
      <p>
        <code>tauri-plugin-updater</code> が GitHub Release の{" "}
        <code>latest.json</code> を定期ポーリング。新バージョンを検出すると
        バックグラウンドでダウンロードし、次回起動時に適用します。
      </p>
    </DocsLayout>
  );
}
