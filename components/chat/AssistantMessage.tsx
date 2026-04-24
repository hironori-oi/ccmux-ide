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

export function AssistantMessage({ message }: { message: ChatMessage }) {
  // DEC-061: streaming 中も毎フレーム走るので memoize。
  // 入力が同一ならリファレンスが保たれ、ReactMarkdown の再パースを抑制できる。
  const normalized = useMemo(
    () => normalizeMarkdownForGfm(message.content || ""),
    [message.content],
  );

  return (
    <div className="flex justify-start">
      <Card className="mr-auto max-w-[85%] border-muted-foreground/10 bg-card p-4 text-card-foreground shadow-sm">
        {/* PM-951: text-sm ではなく親 MessageList の --app-font-size を継承。
            markdown body（p / li / blockquote 等）はこの div の font-size を継ぐ。
            PRJ-012 v1.15.0 (DEC-061): prose を適用し Cursor 相当の Markdown 整形。
            - `prose-sm` で chat UI に合う密度
            - `max-w-none` で吹き出し幅を制限しない
            - `dark:prose-invert` でダークテーマ対応
            - `prose-neutral` でベース色を neutral に固定 */}
        <div
          className={cn(
            "prose prose-sm prose-neutral max-w-none dark:prose-invert",
            "text-[length:inherit]",
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          >
            {normalized}
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
