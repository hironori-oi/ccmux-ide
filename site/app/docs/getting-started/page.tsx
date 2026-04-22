import { DocsLayout } from "@/components/DocsLayout";

export const metadata = {
  title: "クイックスタート",
  description:
    "Sumi のダウンロード、インストール、初回起動、Claude Code 認証までの手順を日本語で解説。",
};

const toc = [
  { id: "requirements", label: "必要なもの" },
  { id: "install", label: "インストール" },
  { id: "first-run", label: "初回起動" },
  { id: "workflow", label: "基本ワークフロー" },
  { id: "auth", label: "Claude Code 認証" },
];

export default function GettingStartedPage() {
  return (
    <DocsLayout toc={toc}>
      <h1>クイックスタート</h1>
      <p>
        Sumi をダウンロードして、初回起動から最初の Claude Code セッションを
        開くまでを 5 分で案内します。
      </p>

      <h2 id="requirements">必要なもの</h2>
      <ul>
        <li>Windows 10 以降 / macOS 12 以降 / 主要な Linux ディストリビューション</li>
        <li>Node.js 20+（<code>claude-agent-sdk</code> sidecar 実行用）</li>
        <li>
          Claude アカウント（Max / Pro プラン）または Anthropic API Key のいずれか
        </li>
      </ul>

      <h2 id="install">インストール</h2>
      <p>
        <a href="https://github.com/hironori-oi/ccmux-ide/releases/latest" target="_blank" rel="noreferrer">
          GitHub Releases
        </a>{" "}
        から OS に合わせたバイナリを取得します。
      </p>
      <h3>Windows</h3>
      <p>
        <code>Sumi_x.y.z_x64_en-US.msi</code> または <code>Sumi_x.y.z_x64-setup.exe</code>{" "}
        を実行します。SmartScreen が出たら「詳細情報 → 実行」で続行してください
        （現時点では未署名配布です）。
      </p>
      <h3>macOS</h3>
      <p>
        <code>Sumi_x.y.z_aarch64.dmg</code>（Apple Silicon）または{" "}
        <code>_x64.dmg</code>（Intel）をマウントし、アプリを Applications
        フォルダにドラッグします。Gatekeeper 警告は「システム設定 → プライバシーと
        セキュリティ」から許可してください。
      </p>
      <h3>Linux</h3>
      <p>
        <code>.AppImage</code> は <code>chmod +x</code> して実行します。Debian / Ubuntu
        系なら <code>.deb</code> を <code>sudo dpkg -i</code> で導入できます。
      </p>

      <h2 id="first-run">初回起動（Welcome Wizard 4 ステップ）</h2>
      <ol>
        <li>
          <strong>ようこそ</strong> — 製品紹介と主要機能の概要。
        </li>
        <li>
          <strong>認証</strong> — Claude Max / Pro プランなら{" "}
          <code>~/.claude/.credentials.json</code> を自動検出。API Key 派はここで
          貼り付けると OS keyring に保存されます。
        </li>
        <li>
          <strong>テーマ選択</strong> — Tokyo Night / Catppuccin Mocha / Dracula /
          Nord / Claude Orange から好きなプリセットを選択。壁紙を設定することも
          できます。
        </li>
        <li>
          <strong>最初のプロジェクト登録</strong> — プロジェクトのルートフォルダを
          選ぶと <code>.claude/</code> 配下の Slash / Skills / Plugins / MCP を
          自動スキャンします。
        </li>
      </ol>

      <h2 id="workflow">基本ワークフロー</h2>
      <ol>
        <li>
          <strong>プロジェクトを選ぶ</strong> — 左サイドバーから登録済みプロジェクト
          をクリック、または Ctrl+P で切替。
        </li>
        <li>
          <strong>チャットで指示する</strong> — 中央のチャットビューで Claude に指示。
          画像は Ctrl+V ペースト、<code>@path</code> でファイル注入。
        </li>
        <li>
          <strong>差分を確認する</strong> — Edit tool が走ると Monaco DiffEditor
          で before/after を可視化。
        </li>
        <li>
          <strong>ターミナル / プレビュー</strong> — 下ペインで組込ターミナル、
          右ペインでブラウザプレビュー。1 / 2 / 4 分割に切替可能。
        </li>
      </ol>

      <h2 id="auth">Claude Code 認証</h2>
      <p>
        Sumi は次の 2 系統を自動で判別します。
      </p>
      <ul>
        <li>
          <strong>Claude Max / Pro プラン</strong> — 既存の Claude Code CLI が発行した{" "}
          <code>~/.claude/.credentials.json</code> をそのまま使用。Sumi 側での
          追加設定は不要です。
        </li>
        <li>
          <strong>Anthropic API Key</strong> — Wizard で貼り付けたキーは OS keyring
          （Windows Credential Manager / macOS Keychain / Linux Secret Service）
          に保存されます。プレーンテキスト設定ファイルには書き出されません。
        </li>
      </ul>
      <p>
        キーを後から差し替えたい場合は、アプリ右上の設定ダイアログ、または{" "}
        <code>Ctrl+,</code> で同じ画面を開けます。
      </p>
    </DocsLayout>
  );
}
