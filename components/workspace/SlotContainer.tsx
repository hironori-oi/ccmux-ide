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
import { ChatStatusIndicator } from "@/components/chat/ChatStatusIndicator";
import { ToolDetailsToggle } from "@/components/chat/ToolDetailsToggle";
import { FileViewer } from "@/components/editor/FileViewer";
import {
  MarkdownEditorArea,
  type MarkdownViewMode,
} from "@/components/editor/EditorPaneItem";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { isMarkdownPath } from "@/lib/utils/file";
import { Button } from "@/components/ui/button";
import { CCMUX_FILE_PATH_MIME } from "@/lib/file-drag";
import { useEditorStore } from "@/lib/stores/editor";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useCurrentSlotContent,
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
  className,
}: {
  slotIndex: number;
  slotLabel: string;
  /** 外側から grid セル span 等を追加するための optional class。 */
  className?: string;
}) {
  // PM-981: current session の slot 内容を subscribe（session 切替で自動更新）
  const content = useCurrentSlotContent(slotIndex);
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
        isDragTarget && "border-primary/60 bg-primary/5",
        className
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
        <div className="flex shrink-0 items-center gap-1">
          {/* PM-978: chat slot のときだけ tool toggle + 接続状態を inline 表示 */}
          {content.kind === "chat" && (
            <>
              <ToolDetailsToggle size="small" />
              <ChatStatusIndicator compact />
            </>
          )}
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
        </div>
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
    return <SlotEditorRenderer openFileId={content.refId} />;
  }
  if (content.kind === "terminal") {
    // TerminalPane は 1 pane = 1 sub-tab group の責務だが、workspace slot では
    // 単一 pty (refId) 相当の slim 表示にしたい。TerminalPane 全体を組み込むと
    // sub-tabs が二重に出て UI が冗長になるため、現状は TerminalPane を埋め込む。
    // Phase 2 で single-pty slim renderer を検討（本 MVP では tolerable）。
    return <SlotTerminalRenderer ptyId={content.refId} />;
  }
  if (content.kind === "preview") {
    // PM-973: refId は previewInstance id（旧仕様では projectId だったが、複数
    // 独立インスタンス対応で instance 単位に）。PreviewPane は previewId 指定時、
    // インスタンス固有の URL 状態を読み書きする。
    return (
      <div className="flex h-full flex-col">
        <PreviewPane previewId={content.refId} />
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

/**
 * v1.25.6: Slot 内 Editor 描画のラッパ。
 *
 * 旧実装は `<FileViewer openFileId={...} />` を直接呼んでいたため、Workspace
 * 4 分割等で editor を slot 配置すると EditorPaneItem の MarkdownToolbar が
 * 完全にスキップされ、`.md` ファイルでも 編集/プレビュー/分割 切替が出ない
 * 不具合の根本原因だった。
 *
 * 本 wrapper は openFile.path を見て isMarkdownPath なら MarkdownEditorArea
 * (toolbar 付き) を、それ以外は FileViewer を呼び分ける。これで EditorPaneItem
 * 経路と Workspace slot 経路の両方で同じ Markdown プレビュー UX が得られる。
 */
function SlotEditorRenderer({ openFileId }: { openFileId: string }) {
  const openFile = useEditorStore((s) =>
    s.openFiles.find((f) => f.id === openFileId),
  );
  const [mdViewMode, setMdViewMode] = useState<MarkdownViewMode>("edit");

  if (openFile && isMarkdownPath(openFile.path)) {
    return (
      <div className="flex h-full flex-col">
        <MarkdownEditorArea
          openFileId={openFileId}
          viewMode={mdViewMode}
          onViewModeChange={setMdViewMode}
        />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <FileViewer openFileId={openFileId} />
    </div>
  );
}
