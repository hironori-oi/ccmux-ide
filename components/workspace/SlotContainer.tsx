"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  FileText,
  MessageSquare,
  Monitor,
  MoveDown,
  TerminalSquare,
  X,
} from "lucide-react";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { FileViewer } from "@/components/editor/FileViewer";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { Button } from "@/components/ui/button";
import { CCMUX_FILE_PATH_MIME } from "@/lib/file-drag";
import { useEditorStore } from "@/lib/stores/editor";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useWorkspaceLayoutStore,
  type SlotContent,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-969: workspace の 1 slot。
 *
 * - ドロップターゲットとして `useDroppable` を登録
 * - `slot.content` が null ならプレースホルダ表示
 * - null でなければ kind に応じて ChatPanel / FileViewer / TerminalContent /
 *   PreviewPane をレンダリング
 * - ヘッダで slot name + ✕（空にする）ボタン
 */
export function SlotContainer({
  slotIndex,
  slotLabel,
}: {
  slotIndex: number;
  slotLabel: string;
}) {
  const content = useWorkspaceLayoutStore((s) => s.slots[slotIndex]);
  const setSlot = useWorkspaceLayoutStore((s) => s.setSlot);
  const openFile = useEditorStore((s) => s.openFile);

  // @dnd-kit (Tray チップ ドロップ用)
  const { setNodeRef, isOver, active } = useDroppable({
    id: `slot-${slotIndex}`,
    data: { slotIndex },
  });

  // HTML5 native drop (Sidebar ProjectTree ファイル用)
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // CCMUX_FILE_PATH_MIME が含まれているときだけ accept
    if (e.dataTransfer.types.includes(CCMUX_FILE_PATH_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isFileDragOver) setIsFileDragOver(true);
    }
  }

  function handleDragLeave() {
    setIsFileDragOver(false);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    const path = e.dataTransfer.getData(CCMUX_FILE_PATH_MIME);
    setIsFileDragOver(false);
    if (!path) return;
    e.preventDefault();
    // openFile は void Promise なので、完了後に state から id を拾う
    await openFile(path);
    const file = useEditorStore
      .getState()
      .openFiles.find((f) => f.path === path);
    if (file) {
      setSlot(slotIndex, { kind: "editor", refId: file.id });
    }
  }

  const isDragTarget = (isOver && !!active) || isFileDragOver;

  return (
    <div
      ref={setNodeRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      className={cn(
        "flex min-h-0 flex-1 flex-col border border-border/40 transition-colors",
        isDragTarget && "border-primary/60 bg-primary/5"
      )}
    >
      <SlotHeader
        slotLabel={slotLabel}
        content={content ?? null}
        onClear={() => setSlot(slotIndex, null)}
      />
      <div className="min-h-0 flex-1">
        {content ? (
          <SlotContentRenderer content={content} />
        ) : (
          <SlotEmptyPlaceholder isDropTarget={isDragTarget} />
        )}
      </div>
    </div>
  );
}

function SlotHeader({
  slotLabel,
  content,
  onClear,
}: {
  slotLabel: string;
  content: SlotContent | null;
  onClear: () => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-2 text-[11px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
          {slotLabel}
        </span>
        {content && <SlotContentLabel content={content} />}
      </div>
      {content && (
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 shrink-0"
          onClick={onClear}
          aria-label={`Slot ${slotLabel} を空にする`}
          title="この slot を空にする"
        >
          <X className="h-3 w-3" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function SlotContentLabel({ content }: { content: SlotContent }) {
  if (content.kind === "chat") {
    return (
      <div className="flex min-w-0 items-center gap-1 text-blue-500">
        <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate text-foreground">Chat</span>
      </div>
    );
  }
  if (content.kind === "editor") {
    return <EditorSlotLabel fileId={content.refId} />;
  }
  if (content.kind === "terminal") {
    return <TerminalSlotLabel ptyId={content.refId} />;
  }
  return (
    <div className="flex min-w-0 items-center gap-1 text-sky-500">
      <Monitor className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate text-foreground">Preview</span>
    </div>
  );
}

function EditorSlotLabel({ fileId }: { fileId: string }) {
  const title = useEditorStore(
    (s) => s.openFiles.find((f) => f.id === fileId)?.title ?? "(不明なファイル)"
  );
  return (
    <div className="flex min-w-0 items-center gap-1 text-amber-500">
      <FileText className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate text-foreground">{title}</span>
    </div>
  );
}

function TerminalSlotLabel({ ptyId }: { ptyId: string }) {
  const title = useTerminalStore(
    (s) => s.terminals[ptyId]?.title ?? "(Terminal)"
  );
  return (
    <div className="flex min-w-0 items-center gap-1 text-emerald-500">
      <TerminalSquare className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate text-foreground">{title}</span>
    </div>
  );
}

function SlotEmptyPlaceholder({ isDropTarget }: { isDropTarget: boolean }) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs transition-colors",
        isDropTarget
          ? "bg-primary/5 text-primary"
          : "bg-muted/10 text-muted-foreground"
      )}
    >
      <MoveDown
        className={cn(
          "h-5 w-5",
          isDropTarget ? "text-primary" : "text-muted-foreground/60"
        )}
        aria-hidden
      />
      <span className="font-medium">
        {isDropTarget ? "ここにドロップして表示" : "ドラッグして配置"}
      </span>
      {!isDropTarget && (
        <span className="max-w-[320px] text-[10px] leading-relaxed text-muted-foreground/70">
          上のトレイからチップをドラッグ、またはサイドバーのファイルを直接ここへドロップ
        </span>
      )}
    </div>
  );
}

/** slot の kind に応じて実際の pane コンポーネントを描画する。 */
function SlotContentRenderer({ content }: { content: SlotContent }) {
  if (content.kind === "chat") {
    // 既存 ChatPanel は paneId prop で pane 単位に instance 化できる設計。
    return (
      <div className="flex h-full flex-col">
        <ChatPanel
          paneId={content.refId}
          showHeader={false}
          canClose={false}
        />
      </div>
    );
  }
  if (content.kind === "editor") {
    return (
      <div className="flex h-full flex-col">
        <FileViewer openFileId={content.refId} />
      </div>
    );
  }
  if (content.kind === "terminal") {
    // TerminalPane は 1 pane = 1 sub-tab group の責務だが、workspace slot では
    // 単一 pty (refId) 相当の slim 表示にしたい。TerminalPane 全体を組み込むと
    // sub-tabs が二重に出て UI が冗長になるため、現状は TerminalPane を埋め込む。
    // Phase 2 で single-pty slim renderer を検討（本 MVP では tolerable）。
    return <SlotTerminalRenderer ptyId={content.refId} />;
  }
  if (content.kind === "preview") {
    return (
      <div className="flex h-full flex-col">
        <PreviewPane />
      </div>
    );
  }
  return null;
}

/**
 * Slot 内 Terminal 描画のラッパ。TerminalPane は ptyId を受けて該当 pty の
 * xterm を描画する設計になっているため slot から直接 instance 化可能。
 */
function SlotTerminalRenderer({ ptyId }: { ptyId: string }) {
  return (
    <div className="flex h-full flex-col">
      <TerminalPane ptyId={ptyId} />
    </div>
  );
}
