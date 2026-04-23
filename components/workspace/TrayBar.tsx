"use client";

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  FileText,
  LayoutGrid,
  MessageSquare,
  Monitor,
  TerminalSquare,
} from "lucide-react";

import { useChatStore } from "@/lib/stores/chat";
import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useWorkspaceLayoutStore,
  type SlotContentKind,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-969: workspace mode の上部ドラッグトレイバー。
 *
 * 既存 store から開いている pane / file / pty / preview を導出し、種類別にグループ化した
 * ドラッグ可能チップとして表示する。ユーザーがチップを slot にドロップすると
 * `useWorkspaceLayoutStore.setSlot` が発火して、対応する slot にコンテンツが入る。
 *
 * ## drag data payload
 *
 * `useDraggable` の `data` に `{ kind, refId, label }` を入れ、WorkspaceView の
 * `onDragEnd` で拾って `setSlot` を呼ぶ。
 */
export function TrayBar() {
  const chatPanes = useChatStore((s) => s.panes);
  const openFiles = useEditorStore((s) => s.openFiles);
  const terminals = useTerminalStore((s) => s.terminals);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProjectTitle = useProjectStore((s) => {
    if (!s.activeProjectId) return null;
    return s.projects.find((p) => p.id === s.activeProjectId)?.title ?? null;
  });
  const slots = useWorkspaceLayoutStore((s) => s.slots);

  // どの refId がすでに slot に入っているか（チップを dim 表示するため）
  const placedRefs = useMemo(() => {
    const m = new Set<string>();
    for (const c of slots) {
      if (c) m.add(`${c.kind}:${c.refId}`);
    }
    return m;
  }, [slots]);

  const chatItems = useMemo(() => {
    return Object.entries(chatPanes).map(([paneId]) => ({
      kind: "chat" as const,
      refId: paneId,
      label: paneId === "main" ? "Chat" : `Chat (${paneId})`,
    }));
  }, [chatPanes]);

  const editorItems = useMemo(() => {
    return openFiles.map((f) => ({
      kind: "editor" as const,
      refId: f.id,
      label: f.title,
    }));
  }, [openFiles]);

  const terminalItems = useMemo(() => {
    if (!activeProjectId) return [];
    return Object.values(terminals)
      .filter((t) => t.projectId === activeProjectId && !t.exited)
      .map((t) => ({
        kind: "terminal" as const,
        refId: t.ptyId,
        label: t.title,
      }));
  }, [terminals, activeProjectId]);

  const previewItems = useMemo(() => {
    if (!activeProjectId) return [];
    return [
      {
        kind: "preview" as const,
        refId: activeProjectId,
        label: `${activeProjectTitle ?? "Preview"} Preview`,
      },
    ];
  }, [activeProjectId, activeProjectTitle]);

  const isEmpty =
    chatItems.length === 0 &&
    editorItems.length === 0 &&
    terminalItems.length === 0 &&
    previewItems.length === 0;

  return (
    <div className="flex min-h-[56px] shrink-0 items-start gap-3 overflow-x-auto border-b bg-muted/10 px-3 py-2">
      <div className="flex shrink-0 items-center gap-1 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <LayoutGrid className="h-3 w-3" aria-hidden />
        <span>トレイ</span>
      </div>
      {isEmpty ? (
        <div className="flex items-center text-xs text-muted-foreground">
          開いている項目がありません。チャット / エディタ / ターミナル / プレビュー
          をそれぞれのタブで開くと、ここに表示されます。
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-2">
          <TrayGroup
            icon={<MessageSquare className="h-3 w-3" aria-hidden />}
            label="Chat"
            items={chatItems}
            placedRefs={placedRefs}
            color="text-blue-500"
          />
          <TrayGroup
            icon={<FileText className="h-3 w-3" aria-hidden />}
            label="Editor"
            items={editorItems}
            placedRefs={placedRefs}
            color="text-amber-500"
          />
          <TrayGroup
            icon={<TerminalSquare className="h-3 w-3" aria-hidden />}
            label="Terminal"
            items={terminalItems}
            placedRefs={placedRefs}
            color="text-emerald-500"
          />
          <TrayGroup
            icon={<Monitor className="h-3 w-3" aria-hidden />}
            label="Preview"
            items={previewItems}
            placedRefs={placedRefs}
            color="text-sky-500"
          />
        </div>
      )}
    </div>
  );
}

function TrayGroup({
  icon,
  label,
  items,
  placedRefs,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  items: Array<{ kind: SlotContentKind; refId: string; label: string }>;
  placedRefs: Set<string>;
  color: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 text-[10px] font-medium",
          color
        )}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <TrayChip
            key={`${it.kind}:${it.refId}`}
            kind={it.kind}
            refId={it.refId}
            label={it.label}
            isPlaced={placedRefs.has(`${it.kind}:${it.refId}`)}
          />
        ))}
      </div>
    </div>
  );
}

function TrayChip({
  kind,
  refId,
  label,
  isPlaced,
}: {
  kind: SlotContentKind;
  refId: string;
  label: string;
  isPlaced: boolean;
}) {
  const id = `tray-${kind}-${refId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind, refId, label },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={cn(
        "flex h-6 shrink-0 max-w-[200px] cursor-grab items-center gap-1 rounded border px-2 text-[11px] transition-colors",
        "hover:bg-accent/40 hover:border-border",
        isDragging && "cursor-grabbing opacity-50",
        isPlaced
          ? "border-border/30 bg-muted/30 text-muted-foreground/70"
          : "border-border/60 bg-background text-foreground"
      )}
      title={isPlaced ? `${label}（すでに配置済）` : `${label}（ドラッグで slot へ）`}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
