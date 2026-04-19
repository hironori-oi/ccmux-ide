"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useMonitorStore, type SubAgentInfo } from "@/lib/stores/monitor";

// React error #185 防止: Zustand selector が毎 render 新配列を返すと
// Object.is で差分ありと判定され無限 render ループになる。
// モジュール外に stable な空配列を 1 つだけ用意し、null 時はこれを返す。
const EMPTY_SUB_AGENTS: readonly SubAgentInfo[] = Object.freeze([]);

/**
 * サイドバー下段のサブエージェント一覧（PM-166）。
 *
 * - 1 件ごとに lucide `Bot` + 名前 + status Badge
 * - status: running=amber / done=emerald / error=rose
 * - 0 件時は「稼働中のサブエージェントはありません」
 * - framer-motion の `layout` で追加/削除をスムーズに。
 */
export function SubAgentsList() {
  const subAgents = useMonitorStore(
    (s) => s.monitor?.sub_agents ?? EMPTY_SUB_AGENTS
  );

  return (
    <section
      className="flex flex-col gap-1.5 px-2 py-2"
      aria-label="サブエージェント"
    >
      <header className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">
          サブエージェント
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {subAgents.length}
        </span>
      </header>

      {subAgents.length === 0 ? (
        <div className="rounded-md border border-dashed px-2 py-2 text-[10px] text-muted-foreground">
          稼働中のサブエージェントはありません
        </div>
      ) : (
        <motion.ul layout className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {subAgents.map((agent) => (
              <motion.li
                key={agent.id}
                layout
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
              >
                <SubAgentItem agent={agent} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}

function SubAgentItem({ agent }: { agent: SubAgentInfo }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5">
      <Bot
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span
        className="flex-1 truncate text-xs font-medium"
        title={agent.name}
      >
        {agent.name}
      </span>
      <Badge
        variant="secondary"
        className={cn(
          "px-1.5 py-0 text-[10px] font-normal",
          statusClass(agent.status)
        )}
      >
        {statusLabel(agent.status)}
      </Badge>
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return "border-yellow-500/40 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300";
    case "done":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "error":
      return "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300";
    default:
      return "";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "実行中";
    case "done":
      return "完了";
    case "error":
      return "失敗";
    default:
      return status;
  }
}
