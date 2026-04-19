"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { useChatStore } from "@/lib/stores/chat";
import { UserMessage } from "@/components/chat/UserMessage";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { ToolUseCard } from "@/components/chat/ToolUseCard";

/**
 * PM-132: メッセージ一覧。
 *
 * framer-motion の `AnimatePresence` + `layout` で新規メッセージが下からふわっと
 * 生える演出。メッセージ追加時は自動で最下部へスクロール（smooth）。
 */
export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streaming = useChatStore((s) => s.streaming);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex flex-1 items-center justify-center overflow-y-auto p-6"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-lg font-medium">まだメッセージはありません</p>
          <p className="max-w-md text-sm text-muted-foreground">
            下の入力欄にメッセージを入力して Claude に話しかけてください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {m.role === "user" ? (
                <UserMessage message={m} />
              ) : m.role === "tool" && m.toolUse ? (
                <ToolUseCard tool={m.toolUse} />
              ) : (
                <AssistantMessage message={m} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {streaming &&
          !messages.some((m) => m.role === "assistant" && m.streaming) && (
            <motion.div
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              考え中...
            </motion.div>
          )}
      </div>
    </div>
  );
}
