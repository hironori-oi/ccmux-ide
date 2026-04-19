"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * HelloBubble — 初回ワークスペース訪問時のみ表示する挨拶バブル（PM-126）。
 *
 * 仕様:
 *  - `localStorage.getItem('hasSeenWelcome') === null` のとき表示。
 *  - 300ms fade-in、5 秒後に自動 fade-out（ユーザ操作がなければ）。
 *  - × クリックで `localStorage.setItem('hasSeenWelcome', 'true')` を書いて即時閉じる。
 *
 * 配置について:
 *  - **このコンポーネント自体は配置しない**。Chunk A が `app/(workspace)/workspace/page.tsx`
 *    を改築中のため、配置の差し込みは Chunk A 側の責務とする。
 *  - 想定配置は画面右上もしくは中央上部。
 *
 * 使い方（Chunk A 向けメモ）:
 * ```tsx
 * import { HelloBubble } from "@/components/onboarding/HelloBubble";
 * // Workspace 最上位に <HelloBubble /> を 1 回置くだけ。
 * ```
 */
export interface HelloBubbleProps {
  /** 追加クラス（位置調整用） */
  className?: string;
  /** 自動フェードアウトまでのミリ秒（default 5000） */
  autoDismissMs?: number;
  /** 表示メッセージ（default 「こんにちは！何から始めますか？」） */
  message?: string;
}

const STORAGE_KEY = "hasSeenWelcome";

export function HelloBubble({
  className,
  autoDismissMs = 5000,
  message = "こんにちは！何から始めますか？",
}: HelloBubbleProps) {
  // SSR 回避のため、初期 false でマウント後に判定する。
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (seen === null) {
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      dismiss();
    }, autoDismissMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoDismissMs]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-3 rounded-full border bg-card/95 px-4 py-2 shadow-md backdrop-blur",
            className
          )}
          role="status"
          aria-live="polite"
        >
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <p className="text-sm">{message}</p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="閉じる"
            className="ml-1 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
