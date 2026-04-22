import { DocsLayout } from "@/components/DocsLayout";

export const metadata = {
  title: "キーバインド",
  description: "ccmux-ide の主要なキーボードショートカット一覧。",
};

const toc = [
  { id: "global", label: "グローバル" },
  { id: "navigation", label: "ナビゲーション" },
  { id: "editor", label: "エディタ / チャット" },
  { id: "palettes", label: "パレット / 検索" },
];

type KeyRow = { keys: string; label: string };

const globalKeys: KeyRow[] = [
  { keys: "Ctrl+K", label: "コマンドパレットを開く（全アクション横断）" },
  { keys: "Ctrl+,", label: "設定ダイアログを開く" },
  { keys: "Ctrl+Q", label: "アプリを終了" },
];

const navKeys: KeyRow[] = [
  { keys: "Ctrl+P", label: "プロジェクト切替" },
  { keys: "Ctrl+B", label: "サイドバー表示 / 非表示" },
  { keys: "Ctrl+1 / 2 / 3", label: "チャット / エディタ / ターミナルペインへフォーカス" },
  { keys: "Ctrl+\\", label: "レイアウト（1 / 2 / 4 ペイン）循環切替" },
];

const editorKeys: KeyRow[] = [
  { keys: "Ctrl+S", label: "エディタの変更を保存" },
  { keys: "Ctrl+V", label: "クリップボード画像をチャットに添付" },
  { keys: "Ctrl+Enter", label: "チャットメッセージを送信" },
  { keys: "Shift+Enter", label: "チャット入力内で改行" },
];

const paletteKeys: KeyRow[] = [
  { keys: "/", label: "Slash パレットを開く（チャット入力先頭）" },
  { keys: "Ctrl+Shift+F", label: "FTS5 横断検索（会話履歴 + ファイル + Skills）" },
  { keys: "Esc", label: "パレット / モーダルを閉じる" },
];

function Kbd({ k }: { k: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {k.split(" ").map((part, i) => (
        <kbd key={i}>{part}</kbd>
      ))}
    </span>
  );
}

function Table({ rows }: { rows: KeyRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th className="w-56">ショートカット</th>
          <th>動作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.keys}>
            <td>
              <Kbd k={r.keys} />
            </td>
            <td>{r.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function KeybindingsPage() {
  return (
    <DocsLayout toc={toc}>
      <h1>キーバインド</h1>
      <p>
        ccmux-ide はキーボードだけで完結することを目指しています。以下は主要な
        ショートカットの一覧です。macOS では <code>Ctrl</code> を <code>Cmd</code>{" "}
        に読み替えてください。
      </p>

      <h2 id="global">グローバル</h2>
      <Table rows={globalKeys} />

      <h2 id="navigation">ナビゲーション</h2>
      <Table rows={navKeys} />

      <h2 id="editor">エディタ / チャット</h2>
      <Table rows={editorKeys} />

      <h2 id="palettes">パレット / 検索</h2>
      <Table rows={paletteKeys} />

      <p className="mt-10">
        キーバインドはカスタマイズ可能にする予定です（ロードマップ）。現状は
        デフォルトバインドのみをサポートします。
      </p>
    </DocsLayout>
  );
}
