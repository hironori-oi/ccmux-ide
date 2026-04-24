"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import {
  useChatStore,
  DEFAULT_PANE_ID,
  selectMessagesForPane,
  selectStreamingForSession,
  type ChatMessage,
} from "@/lib/stores/chat";
// ChatMessage は groupConsecutiveTools 内で使用
import { useSettingsStore } from "@/lib/stores/settings";
import { UserMessage } from "@/components/chat/UserMessage";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { ToolUseCard } from "@/components/chat/ToolUseCard";
import { ToolUseGroup } from "@/components/chat/ToolUseGroup";
import { parseToolMessageContent } from "@/lib/tool-content-parser";

// React 19 + zustand: selector が新しい配列/オブジェクトを返すと
// getSnapshot cache が効かず "should be cached to avoid an infinite loop" になる。
// selectMessagesForPane は store 内部で同じ参照を返すよう作ってあるため、
// 本コンポーネントでは追加の EMPTY_MESSAGES fallback は不要。

/**
 * PM-967: `showToolDetails === false` のとき連続する tool メッセージを 1 グループに
 * まとめる。ストリーム中の最新 tool も同じグループに入れる（展開すれば見える）。
 *
 * 出力は display 用の「単一メッセージ or tool グループ」のフラット配列。
 */
type DisplayItem =
  | { kind: "single"; message: ChatMessage }
  | { kind: "tool-group"; id: string; messages: ChatMessage[] };

function groupConsecutiveTools(messages: ChatMessage[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let buffer: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      buffer.push(m);
      continue;
    }
    if (buffer.length > 0) {
      out.push({
        kind: "tool-group",
        id: `tg-${buffer[0].id}`,
        messages: buffer,
      });
      buffer = [];
    }
    out.push({ kind: "single", message: m });
  }
  if (buffer.length > 0) {
    out.push({
      kind: "tool-group",
      id: `tg-${buffer[0].id}`,
      messages: buffer,
    });
  }
  return out;
}

/**
 * PM-132: メッセージ一覧。
 *
 * v3.5 Chunk B (Split Sessions): `paneId` prop を受け、当該 pane の messages /
 * streaming / scroll target / highlight を chat store から subscribe する。
 * paneId 未指定時は DEFAULT_PANE_ID ("main") にフォールバックするため、旧
 * 1 pane 前提の呼出元（SearchPalette 経由のジャンプ等）も動く。
 */
export function MessageList({ paneId = DEFAULT_PANE_ID }: { paneId?: string }) {
  // v1.18.0 (DEC-064): messages / streaming は session 単位 store から引く。
  // pane は viewport として currentSessionId を持つだけ。
  const currentSessionId = useChatStore(
    (s) => s.panes[paneId]?.currentSessionId ?? null
  );
  const messages = useChatStore((s) => selectMessagesForPane(s, paneId));
  const streaming = useChatStore((s) =>
    selectStreamingForSession(s, currentSessionId)
  );
  const scrollTargetMessageId = useChatStore(
    (s) => s.panes[paneId]?.scrollTargetMessageId ?? null
  );
  const highlightedMessageId = useChatStore(
    (s) => s.panes[paneId]?.highlightedMessageId ?? null
  );
  const clearScrollTarget = useChatStore((s) => s.clearScrollTarget);
  const clearHighlight = useChatStore((s) => s.clearHighlight);
  // PM-967: showToolDetails === false のとき tool 連続を折り畳み表示する
  const showToolDetails = useSettingsStore(
    (s) => s.settings.chatDisplay.showToolDetails
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // PM-967: grouping は純粋関数で memo 化。messages 参照が変わった時だけ再計算。
  const displayItems = useMemo(
    () =>
      showToolDetails
        ? messages.map<DisplayItem>((m) => ({ kind: "single", message: m }))
        : groupConsecutiveTools(messages),
    [messages, showToolDetails]
  );

  // 通常の末尾スクロール（streaming 中 or 新規メッセージ追加時）。
  // 検索ジャンプ中は効かせたくないので scrollTargetMessageId がある間は抑制。
  useEffect(() => {
    if (scrollTargetMessageId) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, scrollTargetMessageId]);

  // PM-232: 検索ジャンプ処理。
  useEffect(() => {
    if (!scrollTargetMessageId) return;
    const id = scrollTargetMessageId;
    const t = window.setTimeout(() => {
      // v3.5 Chunk B: 複数 pane が同じ message id を持つ可能性があるため、
      // 自 pane の scrollRef 配下に限定して query する。
      const root = scrollRef.current ?? document;
      const target = (root as ParentNode).querySelector(
        `[data-msg-id="${CSS.escape(id)}"]`
      ) as HTMLElement | null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      clearScrollTarget(paneId);
    }, 120);
    return () => window.clearTimeout(t);
  }, [scrollTargetMessageId, messages, clearScrollTarget, paneId]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const t = window.setTimeout(() => {
      clearHighlight(paneId);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [highlightedMessageId, clearHighlight, paneId]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex flex-1 items-center justify-center overflow-y-auto p-6"
        // PM-951: 設定画面「フォントサイズ」を chat root に適用。
        // 子要素の Tailwind `text-sm` 等は rem ベースだが inline font-size が
        // 優先されないため、UserMessage / AssistantMessage 側で `text-[length:inherit]`
        // ないし em 基準を使う必要がある。ここでは chat root のデフォルト
        // fontSize として設定しておき、empty state のテキストも合わせる。
        style={{ fontSize: "var(--app-font-size)" }}
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
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      // PM-951: 設定画面「フォントサイズ」を chat scroll container に適用。
      // UserMessage / AssistantMessage の本文は `text-[length:inherit]` を
      // 後続で導入し、このコンテナの font-size を継承する。Tailwind の
      // text-sm 指定（= 0.875rem）が効いている既存子孫は変更しない。
      style={{ fontSize: "var(--app-font-size)" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <AnimatePresence initial={false}>
          {displayItems.map((item) => {
            if (item.kind === "tool-group") {
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="scroll-mt-16"
                >
                  <ToolUseGroup messages={item.messages} />
                </motion.div>
              );
            }
            const m = item.message;
            const isHighlighted = highlightedMessageId === m.id;
            return (
              <motion.div
                key={m.id}
                // v3.5 Chunk B: 複数 pane で同じ message id が DOM に併存する
                // 可能性があるため、id 属性ではなく data-msg-id + pane scoped query
                // で scroll jump する。id 属性は 1 document に 1 個の制約があるため。
                data-msg-id={m.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={
                  isHighlighted
                    ? "scroll-mt-16 rounded-lg ring-2 ring-orange-400/60 ring-offset-2 ring-offset-background transition-shadow duration-500"
                    : "scroll-mt-16 transition-shadow duration-500"
                }
              >
                {m.role === "user" ? (
                  <UserMessage message={m} />
                ) : m.role === "tool" ? (
                  // showToolDetails=true のときだけこのパスに来る
                  // （false のときは groupConsecutiveTools で tool-group に集約）
                  m.toolUse ? (
                    <ToolUseCard tool={m.toolUse} />
                  ) : (() => {
                    const restored = parseToolMessageContent(m.content);
                    return restored ? (
                      <ToolUseCard tool={restored} />
                    ) : (
                      <AssistantMessage message={m} />
                    );
                  })()
                ) : (
                  <AssistantMessage message={m} />
                )}
              </motion.div>
            );
          })}
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
