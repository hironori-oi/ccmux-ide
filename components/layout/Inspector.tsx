"use client";

import { useState } from "react";

import { MemoryEditorPanel } from "@/components/inspector/MemoryEditorPanel";
import { MemoryTreeView } from "@/components/inspector/MemoryTreeView";
import { WorktreeTabs } from "@/components/inspector/WorktreeTabs";

/**
 * インスペクタ右ペイン（PM-167 基底 + PM-205 + Week 7 Chunk 2 PM-240/241
 *   + Week 7 Chunk 3 PM-260/261/262）。
 *
 * ## 構成
 * - 通常モード: MemoryTreeView（Week 6 Chunk 3）+ WorktreeTabs（Week 7 Chunk 3）
 *   を縦に並べる。
 * - 編集モード: MemoryTreeView のノードの編集ボタンが押されたら `editingPath` を
 *   set し、ツリー / WorktreeTabs を隠して `MemoryEditorPanel` を描画する。
 */
export function Inspector() {
  const [editingPath, setEditingPath] = useState<string | null>(null);

  return (
    <aside
      aria-label="インスペクタ"
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l bg-muted/30"
    >
      {editingPath ? (
        <section
          aria-label="CLAUDE.md 編集"
          className="flex min-h-0 flex-1 flex-col p-3"
        >
          <MemoryEditorPanel
            filePath={editingPath}
            onClose={() => setEditingPath(null)}
          />
        </section>
      ) : (
        <div className="flex flex-1 flex-col overflow-y-auto">
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
            <MemoryTreeView onEdit={setEditingPath} />
          </section>

          {/* Week 7 Chunk 3 / PM-260〜262: git worktree 一覧・切替 */}
          <section
            aria-labelledby="inspector-worktree-heading"
            className="flex flex-col gap-2 border-b p-3"
          >
            <h2 id="inspector-worktree-heading" className="sr-only">
              Worktree
            </h2>
            <WorktreeTabs />
          </section>
        </div>
      )}
    </aside>
  );
}
