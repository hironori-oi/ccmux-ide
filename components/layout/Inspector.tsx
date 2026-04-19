"use client";

import { MemoryTreeView } from "@/components/inspector/MemoryTreeView";

/**
 * インスペクタ右ペイン（PM-167 基底 + PM-205 統合、Week 6 Chunk 3）。
 *
 * ## 構成（縦 flex、将来 Accordion 化予定）
 * 1. MemoryTreeView（PM-205、本 Chunk で追加）
 * 2. WorktreeTabs（PM-260、M3 Week 7 追加予定）
 * 3. MemoryEditor（PM-240、M3 Week 7 追加予定）
 *
 * shadcn `Accordion` が `components/ui/` に未導入のため、当面はシンプルな縦
 * スタックで配置する。各セクションは `<section>` 単位で border-b を引いて
 * 視覚的に区切る（統合コンポーネント側の実装でアクセシブルな折畳は PM-260
 * と合わせて検討）。
 */
export function Inspector() {
  return (
    <aside
      aria-label="インスペクタ"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-muted/30"
    >
      <section
        aria-labelledby="inspector-memory-tree-heading"
        className="flex flex-col gap-2 border-b p-3"
      >
        <h2
          id="inspector-memory-tree-heading"
          className="sr-only"
        >
          CLAUDE.md ツリー
        </h2>
        <MemoryTreeView />
      </section>

      {/* M3 で WorktreeTabs / MemoryEditor が入るプレースホルダ */}
      <section
        aria-label="今後の拡張（M3 予定）"
        className="p-3 text-[11px] text-muted-foreground/60"
      >
        <p>Worktree / Memory Editor は M3 で追加予定</p>
      </section>
    </aside>
  );
}
