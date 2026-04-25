"use client";

import { memo } from "react";

import { MarkdownRenderer } from "@/components/chat/AssistantMessage";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.25.1: Editor pane 内 Markdown プレビュー。
 *
 * `.md` / `.mdx` / `.markdown` を Monaco で開いている時に、ペイン上部の toolbar から
 * 編集 / プレビュー / 分割の 3 モードに切替えられる。本 component は「プレビュー」描画担当。
 *
 * ## 設計
 * - Chat 側 AssistantMessage と同じ `MarkdownRenderer` を再利用
 *   （remark-gfm + remark-breaks + rehype-highlight + prose + 外部リンク shell.open）
 * - Monaco の onChange で渡ってくる source を 200ms debounce した上で props に流す
 *   （debounce は呼出側 EditorPaneItem で実施）
 * - Split mode で同時表示されるため、独立スクロール領域 (`overflow-auto`) を確保
 * - 大規模 Markdown でも軽快に動くよう React.memo で props 同一参照時の再描画を回避
 *
 * ## v1.26+ Could
 * - スクロール同期（左右の cursor 位置追従）。本リリースでは複雑性を理由に見送り
 */
export const MarkdownPreview = memo(function MarkdownPreview({
  source,
  className,
}: {
  /** Monaco エディタの現在 buffer（debounce 後の値を渡す） */
  source: string;
  className?: string;
}) {
  return (
    <div
      // overflow-auto: Monaco 側と独立してスクロール
      // bg-background: ダーク / ライトテーマで Monaco と背景が揃う
      // p-4: prose に余白を与える（chat の Card padding と同等）
      className={cn(
        "h-full w-full min-h-0 overflow-auto bg-background px-6 py-4",
        className,
      )}
    >
      <MarkdownRenderer source={source} />
    </div>
  );
});
