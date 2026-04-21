"use client";

import { useMemo } from "react";
import { FolderOpen, FileText } from "lucide-react";

import { EditorPaneItem } from "@/components/editor/EditorPaneItem";
import { SplitView } from "@/components/layout/SplitView";
import { useEditorStore } from "@/lib/stores/editor";

/**
 * PRJ-012 v3.4 Chunk A (DEC-034 Must 1) / PM-924 (2026-04-20): エディタ領域。
 *
 * ## PM-924 以前
 * - 上部: EditorTabs（開いているファイル一覧）
 * - 中央: activeFileId の FileEditor（Monaco）
 * - openFiles が空なら空状態カードを表示
 *
 * ## PM-924 以降
 * - `editorPanes` を SplitView で 1〜2 pane に分割表示。
 * - 各 pane は独立した openFileIds / activeFileId を持つ（`EditorPaneItem` が担当）。
 * - pane が 1 件かつ openFiles が 0 件なら従来通りの空状態カードを表示する
 *   （sidebar のプロジェクトツリーでファイルを選ぶ導線を残すため）。
 *
 * Shell.tsx 側で Chat / Editor / Terminal の切替 + 分割ボタンを管理する。
 */
export function EditorPane() {
  const editorPanes = useEditorStore((s) => s.editorPanes);
  const openFiles = useEditorStore((s) => s.openFiles);
  const paneIds = useMemo(() => Object.keys(editorPanes), [editorPanes]);

  // 全 pane が空 & pane が 1 件のときは従来の空状態カードを表示
  if (paneIds.length === 1 && openFiles.length === 0) {
    return <EmptyState />;
  }

  const items = paneIds.map((id) => ({
    id,
    content: (
      <EditorPaneItem
        paneId={id}
        showHeader={paneIds.length > 1}
        canClose={paneIds.length > 1}
      />
    ),
  }));

  return <SplitView panes={items} />;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium">ファイルを選んでください</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        左サイドバーのプロジェクトツリーからファイルをクリックすると、ここにエディタが開きます。
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" aria-hidden />
        <span>Sidebar → プロジェクト → ファイル</span>
      </div>
    </div>
  );
}
