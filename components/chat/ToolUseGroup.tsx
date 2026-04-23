"use client";

import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { ToolUseCard } from "@/components/chat/ToolUseCard";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { parseToolMessageContent } from "@/lib/tool-content-parser";
import type { ChatMessage } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

/**
 * PM-967: 連続する tool use を折り畳み表示する集約カード。
 *
 * Claude のレスポンス中に `Read` / `Edit` / `Bash` / `Grep` 等の tool 呼び出しが
 * 数十件続くことがあり、本質的な回答テキストが埋もれる問題の対策。
 *
 * ## 挙動
 * - デフォルト collapsed（一覧件数 + ツール種別サマリのみ表示）
 * - クリックで展開し個別 `ToolUseCard` を縦に並べる
 * - 展開状態は React state（永続化不要、再描画で初期化でよい）
 *
 * 呼出側（`MessageList`）は `showToolDetails === false` のときだけ本 component を
 * 使い、`true` のときは従来通り個別に `ToolUseCard` を直接レンダリングする。
 */
export function ToolUseGroup({ messages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) return null;

  // 1 件だけなら折り畳みする意味が薄いので通常表示（ToolUseCard 1 枚）
  if (messages.length === 1) {
    const m = messages[0];
    const tool =
      m.toolUse ?? parseToolMessageContent(m.content) ?? null;
    if (tool) return <ToolUseCard tool={tool} />;
    return <AssistantMessage message={m} />;
  }

  // 連続する tool の種別を集計（Read 3 / Edit 2 / Bash 1 のように）
  const typeCounts = new Map<string, number>();
  for (const m of messages) {
    const t = m.toolUse ?? parseToolMessageContent(m.content);
    const name = t?.name ?? "unknown";
    typeCounts.set(name, (typeCounts.get(name) ?? 0) + 1);
  }
  const typeSummary = Array.from(typeCounts.entries())
    .map(([name, count]) => (count > 1 ? `${name} × ${count}` : name))
    .join(" · ");

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          "hover:bg-muted/40",
          expanded && "border-b border-border/40"
        )}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `${messages.length} 件の tool 操作を折り畳む`
            : `${messages.length} 件の tool 操作を展開`
        }
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
          aria-hidden
        />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {messages.length} 件の tool 操作
        </span>
        <span className="truncate text-[11px] text-muted-foreground/70">
          {typeSummary}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 p-3">
              {messages.map((m) => {
                const tool =
                  m.toolUse ?? parseToolMessageContent(m.content) ?? null;
                if (tool) {
                  return <ToolUseCard key={m.id} tool={tool} />;
                }
                return <AssistantMessage key={m.id} message={m} />;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
