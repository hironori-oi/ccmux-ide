type Mark = "yes" | "no" | "partial";

const rows: Array<{
  label: string;
  sumi: Mark;
  claudeDesktop: Mark;
  cursor: Mark;
  warp: Mark;
}> = [
  { label: "日本語 UI", sumi: "yes", claudeDesktop: "no", cursor: "partial", warp: "no" },
  { label: "おしゃれな見た目", sumi: "yes", claudeDesktop: "partial", cursor: "yes", warp: "yes" },
  { label: "壁紙背景", sumi: "yes", claudeDesktop: "no", cursor: "no", warp: "no" },
  {
    label: "Claude Code の Slash / Skills / Plugins / MCP 対応",
    sumi: "yes",
    claudeDesktop: "partial",
    cursor: "partial",
    warp: "partial",
  },
  { label: "ローカル永続化（会話履歴 SQLite + FTS5）", sumi: "yes", claudeDesktop: "no", cursor: "no", warp: "partial" },
  { label: "無料で全機能利用（OSS / MIT）", sumi: "yes", claudeDesktop: "yes", cursor: "partial", warp: "no" },
];

function Cell({ value, highlight = false }: { value: Mark; highlight?: boolean }) {
  const glyph = value === "yes" ? "✓" : value === "partial" ? "△" : "—";
  const color = highlight
    ? "text-brand-fg"
    : value === "yes"
    ? "text-emerald-400"
    : value === "partial"
    ? "text-yellow-500"
    : "text-zinc-600";
  return <span className={`font-mono text-base ${color}`}>{glyph}</span>;
}

export function CompareTable() {
  return (
    <section className="border-b border-zinc-800/60 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            他の選択肢と、比べてみる。
          </h2>
          <p className="mt-4 text-zinc-400">
            Sumi は日本語話者のデイリードライバーを目指して設計されています。
          </p>
        </div>

        <div className="mt-12 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="px-5 py-4 font-medium">機能</th>
                <th className="px-5 py-4 text-center font-semibold text-brand-fg">
                  Sumi
                </th>
                <th className="px-5 py-4 text-center font-medium">
                  Claude Code Desktop
                </th>
                <th className="px-5 py-4 text-center font-medium">Cursor</th>
                <th className="px-5 py-4 text-center font-medium">Warp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.label}
                  className={
                    i === rows.length - 1
                      ? "text-zinc-300"
                      : "border-b border-zinc-800/60 text-zinc-300"
                  }
                >
                  <td className="px-5 py-4 font-medium text-zinc-100">{row.label}</td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.sumi} highlight />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.claudeDesktop} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.cursor} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.warp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500">
          ✓ 対応　△ 部分対応　—  非対応 / 不明
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 text-sm text-zinc-400 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
            <h3 className="text-sm font-semibold text-zinc-100">
              Warp（Agentic Terminal）との違い
            </h3>
            <p className="mt-2 leading-relaxed">
              <a
                href="https://www.warp.dev/"
                target="_blank"
                rel="noreferrer"
                className="text-brand-fg hover:underline"
              >
                Warp
              </a>
              {" "}は Rust 製のモダンターミナル + エージェント環境で、英語圏の一般開発者を主対象に
              独自 AI（Build $20/月など）を提供します。Sumi は「Claude Code 公式 CLI をフル機能で
              そのまま GUI 化する」ことに絞った OSS クライアントで、日本語 UI・壁紙背景・MIT 無料・
              Slash / Skills / Plugins / MCP の完全対応に振り切っています。
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
            <h3 className="text-sm font-semibold text-zinc-100">
              Sumi が向いている人
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
              <li>日本語で Claude Code を毎日使いたい</li>
              <li>会話履歴をローカル端末のみに保持したい（外部送信ゼロ）</li>
              <li>Slash / Skills / MCP を GUI で一覧・編集したい</li>
              <li>無料かつ OSS（MIT）で導入・改造したい</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
