type Mark = "yes" | "no" | "partial";

const rows: Array<{
  label: string;
  ccmuxIde: Mark;
  claudeDesktop: Mark;
  cursor: Mark;
  ccmux: Mark;
}> = [
  { label: "日本語 UI", ccmuxIde: "yes", claudeDesktop: "no", cursor: "partial", ccmux: "no" },
  { label: "おしゃれな見た目", ccmuxIde: "yes", claudeDesktop: "partial", cursor: "yes", ccmux: "no" },
  { label: "壁紙背景", ccmuxIde: "yes", claudeDesktop: "no", cursor: "no", ccmux: "no" },
  {
    label: "Slash / Skills / Plugins / MCP 対応",
    ccmuxIde: "yes",
    claudeDesktop: "partial",
    cursor: "partial",
    ccmux: "yes",
  },
  { label: "ローカル永続化", ccmuxIde: "yes", claudeDesktop: "no", cursor: "no", ccmux: "yes" },
  { label: "無料", ccmuxIde: "yes", claudeDesktop: "yes", cursor: "partial", ccmux: "yes" },
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
            ccmux-ide は日本語話者のデイリードライバーを目指して設計されています。
          </p>
        </div>

        <div className="mt-12 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="px-5 py-4 font-medium">機能</th>
                <th className="px-5 py-4 text-center font-semibold text-brand-fg">
                  ccmux-ide
                </th>
                <th className="px-5 py-4 text-center font-medium">
                  Claude Code Desktop
                </th>
                <th className="px-5 py-4 text-center font-medium">Cursor</th>
                <th className="px-5 py-4 text-center font-medium">ccmux (TUI)</th>
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
                    <Cell value={row.ccmuxIde} highlight />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.claudeDesktop} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.cursor} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Cell value={row.ccmux} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500">
          ✓ 対応　△ 部分対応　—  非対応 / 不明
        </p>
      </div>
    </section>
  );
}
