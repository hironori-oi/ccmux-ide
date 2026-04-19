"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckSquare, Circle, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMonitorStore, type TodoItem } from "@/lib/stores/monitor";

/**
 * サイドバー下段の Todo 一覧（PM-166）。
 *
 * Claude の TodoWrite ツールで管理される todos を表示。
 *   - pending      → lucide `Square`   + 通常文字色
 *   - in_progress  → lucide `Circle`   + 強調色（青系）
 *   - completed    → lucide `CheckSquare` + 取消線 + 弱色
 *
 * 0 件時は「Todo なし」placeholder。framer-motion の `layout` で追加/完了
 * アニメを滑らかに。
 */
export function TodosList() {
  const todos = useMonitorStore((s) => s.monitor?.todos ?? []);

  const stats = todos.reduce(
    (acc, t) => {
      if (t.status === "completed") acc.done += 1;
      else if (t.status === "in_progress") acc.active += 1;
      else acc.pending += 1;
      return acc;
    },
    { done: 0, active: 0, pending: 0 }
  );

  return (
    <section
      className="flex flex-col gap-1.5 px-2 py-2"
      aria-label="Todo 一覧"
    >
      <header className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">Todo</span>
        {todos.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {stats.done} / {todos.length}
          </span>
        )}
      </header>

      {todos.length === 0 ? (
        <div className="rounded-md border border-dashed px-2 py-2 text-[10px] text-muted-foreground">
          Todo なし
        </div>
      ) : (
        <motion.ul layout className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>
            {todos.map((todo) => (
              <motion.li
                key={todo.id}
                layout
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.12 }}
              >
                <TodoRow todo={todo} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const Icon = iconFor(todo.status);
  const iconColor = iconColorClass(todo.status);
  const textClass = textClassFor(todo.status);

  return (
    <div
      className="flex items-start gap-1.5 rounded px-1 py-0.5 text-xs"
      title={todo.content}
    >
      <Icon
        className={cn("mt-0.5 h-3 w-3 shrink-0", iconColor)}
        aria-hidden
      />
      <span className={cn("line-clamp-2 flex-1 leading-snug", textClass)}>
        {todo.content}
      </span>
    </div>
  );
}

function iconFor(status: string): typeof Square {
  switch (status) {
    case "completed":
      return CheckSquare;
    case "in_progress":
      return Circle;
    default:
      return Square;
  }
}

function iconColorClass(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-500";
    case "in_progress":
      return "text-sky-500 fill-sky-500/30";
    default:
      return "text-muted-foreground";
  }
}

function textClassFor(status: string): string {
  switch (status) {
    case "completed":
      return "text-muted-foreground line-through";
    case "in_progress":
      return "text-foreground font-medium";
    default:
      return "text-foreground/80";
  }
}
