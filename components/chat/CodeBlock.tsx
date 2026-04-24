"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

/**
 * PRJ-012 v1.15.0 (DEC-061): Chat コードブロック (pre) のカスタムレンダラ。
 *
 * - react-markdown が `pre > code.language-xxx` の構造で渡してくる
 * - rehype-highlight が highlight.js の class を付与済み
 * - 右上に「コピー」ボタンを配置し、Tauri clipboard API でクリップボードに書込む
 * - コピー成功時は sonner toast で通知、ボタン自体も一時的に check icon に変わる
 * - 言語バッジ (language-xxx) も左上に小さく表示
 *
 * ## 設計メモ
 * - Tauri 環境以外 (Web preview / SSR) では `@tauri-apps/plugin-clipboard-manager`
 *   が利用不可のため、navigator.clipboard にフォールバックする。
 * - ボタンは `absolute` 配置、pre は `relative` + padding-right で干渉回避。
 * - children が ReactMarkdown から来る ReactNode なので、テキスト抽出は
 *   再帰 extractText で行う (code block は通常 1 つの <code> 子のみ)。
 */

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (node as any).props?.children;
    return extractText(child);
  }
  return "";
}

function extractLanguage(node: ReactNode): string | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const lang = extractLanguage(n);
      if (lang) return lang;
    }
    return null;
  }
  if ("props" in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const className: string | undefined = (node as any).props?.className;
    if (className) {
      const m = /language-([a-zA-Z0-9_+.-]+)/.exec(className);
      if (m) return m[1];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (node as any).props?.children;
    return extractLanguage(child);
  }
  return null;
}

async function copyToClipboard(text: string): Promise<void> {
  // Tauri 環境優先、失敗したら Web の navigator.clipboard にフォールバック
  try {
    const mod = await import("@tauri-apps/plugin-clipboard-manager");
    await mod.writeText(text);
    return;
  } catch (e) {
    logger.debug("CodeBlock", "Tauri clipboard unavailable, falling back", { error: String(e) });
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("clipboard unavailable");
}

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
}

export function CodeBlock({ className, children, ...rest }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => extractText(children), [children]);
  const language = useMemo(() => extractLanguage(children), [children]);

  const onCopy = useCallback(async () => {
    try {
      await copyToClipboard(code);
      setCopied(true);
      toast.success("コードをコピーしました");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      logger.warn("CodeBlock", "copy failed", { error: String(e) });
      toast.error("コピーに失敗しました");
    }
  }, [code]);

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border/50 bg-muted/60">
      {language && (
        <div className="pointer-events-none absolute left-2 top-1 select-none font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {language}
        </div>
      )}
      <button
        type="button"
        onClick={onCopy}
        aria-label="コードをコピー"
        className={cn(
          "absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded",
          "border border-border/50 bg-background/70 text-muted-foreground",
          "opacity-0 transition group-hover:opacity-100 focus:opacity-100",
          "hover:bg-background hover:text-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <pre
        className={cn(
          "overflow-x-auto p-3 pr-9 text-xs leading-relaxed",
          language ? "pt-5" : "pt-3",
          className,
        )}
        {...rest}
      >
        {children}
      </pre>
    </div>
  );
}
