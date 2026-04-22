"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Card } from "@/components/ui/card";
import type { ChatMessage } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

/**
 * PM-132: Claude の返答メッセージ。
 *
 * react-markdown + remark-gfm + rehype-highlight で GitHub Flavored Markdown と
 * シンタックスハイライトに対応。streaming 中は末尾に点滅カーソル `▍` を表示する
 * （差別化軸 B のおしゃれポイント）。
 *
 * @tailwindcss/typography (prose) は未導入なので、`components` props で各要素を
 * 手書きクラスで描画する（shadcn 公式 chat example と同等の最小実装）。
 */

const mdComponents: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("my-2 leading-relaxed", className)} {...props} />
  ),
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-3 mb-2 text-xl font-semibold", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-3 mb-2 text-lg font-semibold", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-3 mb-2 text-base font-semibold", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("my-2 list-disc pl-5", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("my-2 list-decimal pl-5", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("my-0.5", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("text-primary underline underline-offset-4", className)}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-2 border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground",
        className
      )}
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className && className.startsWith("language-"));
    if (isBlock) {
      return (
        <code className={cn("text-xs", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          "rounded bg-muted px-1 py-0.5 font-mono text-xs",
          className
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-2 overflow-x-auto rounded-md bg-muted p-3 text-foreground",
        className
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border-b border-border px-2 py-1 text-left font-medium",
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border-b border-border/50 px-2 py-1", className)} {...props} />
  ),
};

export function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-start">
      <Card className="mr-auto max-w-[85%] border-muted-foreground/10 bg-card p-4 text-card-foreground shadow-sm">
        {/* PM-951: text-sm ではなく親 MessageList の --app-font-size を継承。
            markdown body（p / li / blockquote 等）はこの div の font-size を継ぐ。 */}
        <div className="text-[length:inherit]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          >
            {message.content || ""}
          </ReactMarkdown>
          {message.streaming && (
            <span
              aria-hidden
              className="ml-0.5 inline-block animate-pulse text-primary"
            >
              ▍
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
