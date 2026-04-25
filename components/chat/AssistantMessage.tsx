"use client";

import { useMemo, type AnchorHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";

import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/chat/CodeBlock";
import type { ChatMessage } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { normalizeMarkdownForGfm } from "@/lib/utils/markdown";
import "highlight.js/styles/github-dark.css";

/**
 * PM-132 / PRJ-012 v1.15.0 (DEC-061): Claude の返答メッセージ。
 *
 * - react-markdown + remark-gfm + remark-breaks + rehype-highlight
 * - v1.15.0 より @tailwindcss/typography (`prose`) ベースに刷新。手書き
 *   mdComponents は最小化し、a / code / pre (CodeBlock) / img のみ残す。
 * - streaming 中は末尾に点滅カーソル `▍` を表示する（差別化軸 B のおしゃれポイント）。
 * - Markdown source は `normalizeMarkdownForGfm` で事前正規化し、Claude が
 *   table 直前の blank line を忘れた場合も defensive に補完する（DEC-061 真因対応）。
 *
 * ## v1.25.1
 * Editor pane の Markdown プレビューでも同じ resources（remark / rehype plugins、
 * 外部リンクの shell.open、prose 設定）を再利用できるよう、renderer 部分を
 * `MarkdownRenderer` として export 切り出し。AssistantMessage 自体の挙動 / 見た目は
 * 変更なし（streaming カーソル + Card 包装のみ本 component に残る）。
 */

/**
 * 外部リンクを Tauri shell API でシステムの既定ブラウザに開く。
 * href が `#anchor` / 空 / 相対パスの場合は default 挙動 (preventDefault しない)。
 */
async function openExternal(href: string): Promise<void> {
  try {
    const mod = await import("@tauri-apps/plugin-shell");
    await mod.open(href);
  } catch (e) {
    logger.debug("AssistantMessage", "shell.open failed, falling back to window.open", {
      href,
      error: String(e),
    });
    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }
}

function ExternalLink({
  href,
  children,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal =
    typeof href === "string" &&
    /^(https?:|mailto:|tel:)/i.test(href) &&
    !href.startsWith("#");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("text-primary underline underline-offset-4", className)}
      onClick={(ev) => {
        if (!isExternal || !href) return;
        ev.preventDefault();
        void openExternal(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

const mdComponents: Components = {
  // リンクは Tauri shell.open で外部ブラウザ起動
  a: ExternalLink,
  // pre はカスタム CodeBlock でコピーボタン付きに置換
  pre: ({ children, className }) => (
    <CodeBlock className={className}>{children}</CodeBlock>
  ),
  // inline code は prose デフォルト + tailwind typography extend の styling で OK。
  // ただし rehype-highlight が付与する `hljs` class をコピー機能から独立させるため、
  // 特に handler は書かない (prose の code styling を尊重)。
  img: ({ className, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      loading="lazy"
      className={cn("max-w-full rounded-md", className)}
      {...props}
    />
  ),
};

/**
 * v1.25.1: prose 包装 + ReactMarkdown 描画を切り出した再利用可能 component。
 *
 * - Chat の AssistantMessage と Editor pane の MarkdownPreview から共有利用される
 * - `normalizeMarkdownForGfm` で source を defensive 正規化
 * - prose / dark mode / max-w-none は呼出側で `className` 上書き可能
 *
 * 入力 `source` の memo 化（React.memo / useMemo）は呼出側で行うこと。
 */
export function MarkdownRenderer({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const normalized = useMemo(
    () => normalizeMarkdownForGfm(source || ""),
    [source],
  );

  return (
    <div
      className={cn(
        "prose prose-sm prose-neutral max-w-none dark:prose-invert",
        "text-[length:inherit]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-start">
      <Card className="mr-auto max-w-[85%] border-muted-foreground/10 bg-card p-4 text-card-foreground shadow-sm">
        {/* PM-951: text-sm ではなく親 MessageList の --app-font-size を継承。
            markdown body（p / li / blockquote 等）はこの div の font-size を継ぐ。
            PRJ-012 v1.15.0 (DEC-061): prose を適用し Cursor 相当の Markdown 整形。
            v1.25.1: MarkdownRenderer に切り出し、streaming カーソルだけ残す。 */}
        <div className="relative">
          <MarkdownRenderer source={message.content || ""} />
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
