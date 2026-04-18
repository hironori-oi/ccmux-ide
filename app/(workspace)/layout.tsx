import type { ReactNode } from "react";

/**
 * ワークスペース全体の 3 ペインレイアウト (stub)。
 *
 * - 左サイドバー: ContextGauge / SubAgentsList / ProjectTree （M1 Must）
 * - 中央: チャット (MessageList + InputArea)
 * - 右インスペクタ: MemoryTreeView / WorktreeTabs （M2 Should）
 *
 * 実装は PM-100 系タスクで進める。現段階は骨格の CSS grid のみ。
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen grid-cols-[260px_1fr_320px] bg-background">
      <aside
        aria-label="サイドバー"
        className="flex flex-col border-r bg-muted/30 p-4"
      >
        <div className="text-sm font-semibold">ccmux-ide</div>
        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p>Context Gauge (stub)</p>
          <p>Sub-Agents (stub)</p>
          <p>Project Tree (stub)</p>
        </div>
      </aside>

      <section aria-label="メインチャット" className="flex min-w-0 flex-col">
        {children}
      </section>

      <aside
        aria-label="インスペクタ"
        className="flex flex-col border-l bg-muted/30 p-4"
      >
        <div className="text-sm font-semibold">Inspector</div>
        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p>CLAUDE.md Tree (stub)</p>
          <p>Worktree Tabs (stub)</p>
        </div>
      </aside>
    </div>
  );
}
