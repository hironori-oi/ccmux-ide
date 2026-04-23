"use client";

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Columns2,
  FileText,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Rows2,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_PANE_ID } from "@/lib/stores/chat";
import { useEditorStore } from "@/lib/stores/editor";
import { usePreviewInstances } from "@/lib/stores/preview-instances";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useCurrentLayout,
  useCurrentSlots,
  useWorkspaceLayoutStore,
  type SlotContentKind,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-982: Tray Bar — Fixed 3 chips + 動的 editor chips + LayoutSwitcher。
 *
 * ## 設計方針（PM-982 で簡素化）
 *
 * 1 session = 1 chat / 1 terminal / 1 preview に制限。エディタのみ複数可。
 * Tray には:
 * - Chat（1 固定、refId="main"）
 * - Terminal（1 固定、session ごと lazy 生成）
 * - Preview（1 固定、session ごと lazy 生成）
 * - Editor（動的、openFiles の各 file）
 *
 * 追加ボタン (+) は廃止。ユーザーは固定チップをドラッグするだけ。Terminal/Preview
 * が session に未作成の場合、WorkspaceView の onDragEnd で自動生成する。
 *
 * ## Drag data payload
 *
 * - `{ kind: "chat",     refId: "main" }`
 * - `{ kind: "terminal", refId: <session terminal ptyId> | null }`
 *   null の場合は drop 時に lazy 生成
 * - `{ kind: "preview",  refId: <session preview id> | null }`
 * - `{ kind: "editor",   refId: <fileId> }`（sidebar D&D または openFiles 経由）
 */
export function TrayBar() {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-muted/10 px-2">
      <TrayChips />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <LayoutSwitcher />
      </div>
    </div>
  );
}

/* ─────────────────────────  チップ一覧  ───────────────────────── */

function TrayChips() {
  const openFiles = useEditorStore((s) => s.openFiles);
  const terminals = useTerminalStore((s) => s.terminals);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const slots = useCurrentSlots();
  const layout = useCurrentLayout();
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const previewInstancesMap = usePreviewInstances((s) => s.instances);

  // どの chip がすでに visible な slot に配置済か（dim 表示用）
  const placedRefs = useMemo(() => {
    const m = new Set<string>();
    const visibleIndexes =
      layout === "1"
        ? [0]
        : layout === "2h"
          ? [0, 1]
          : layout === "2v"
            ? [0, 2]
            : [0, 1, 2, 3];
    for (const idx of visibleIndexes) {
      const c = slots[idx];
      if (c) m.add(`${c.kind}:${c.refId}`);
    }
    return m;
  }, [slots, layout]);

  // ─── 固定チャットチップ ─────
  // main pane が current session の「唯一のチャット」。refId は常に "main"。
  const chatChip: TrayChipItem = {
    kind: "chat",
    refId: DEFAULT_PANE_ID,
    label: "Chat",
    tooltip: "チャット（session ごと 1 つ）",
  };

  // ─── 固定ターミナルチップ ─────
  // current session に既存 pty があればその refId、なければ null（drop 時に生成）
  const sessionTerminalPtyId = useMemo(() => {
    if (!activeProjectId) return null;
    const found = Object.values(terminals).find(
      (t) =>
        !t.exited &&
        t.projectId === activeProjectId &&
        t.creatingSessionId === currentSessionId
    );
    return found?.ptyId ?? null;
  }, [terminals, activeProjectId, currentSessionId]);

  const terminalChip: TrayChipItem = {
    kind: "terminal",
    refId: sessionTerminalPtyId ?? null,
    label: "Terminal",
    tooltip: sessionTerminalPtyId
      ? "ターミナル（session ごと 1 つ）"
      : "ターミナル（ドラッグすると自動生成）",
  };

  // ─── 固定プレビューチップ ─────
  const sessionPreviewId = useMemo(() => {
    if (!activeProjectId) return null;
    const found = Object.values(previewInstancesMap).find(
      (inst) =>
        inst.projectId === activeProjectId &&
        inst.creatingSessionId === currentSessionId
    );
    return found?.id ?? null;
  }, [previewInstancesMap, activeProjectId, currentSessionId]);

  const previewChip: TrayChipItem = {
    kind: "preview",
    refId: sessionPreviewId ?? null,
    label: "Preview",
    tooltip: sessionPreviewId
      ? "プレビュー（session ごと 1 つ）"
      : "プレビュー（ドラッグすると自動生成）",
  };

  // ─── 動的エディタチップ ─────
  // openFiles プール全体を session filter（creatingSessionId）で絞る
  const editorItems = useMemo<TrayChipItem[]>(
    () =>
      openFiles
        .filter((f) => {
          if (!f.creatingSessionId) return true; // legacy: 常時表示
          if (!currentSessionId) return true;
          return f.creatingSessionId === currentSessionId;
        })
        .map((f) => ({
          kind: "editor" as const,
          refId: f.id,
          label: f.title,
          tooltip: f.path,
        })),
    [openFiles, currentSessionId]
  );

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {/* 固定 3 チップ（chat / terminal / preview） */}
      <div className="flex shrink-0 items-center gap-1">
        <FixedChip
          icon={<MessageSquare className="h-3 w-3" aria-hidden />}
          color="bg-blue-500/10 border-blue-500/40 text-blue-600 dark:text-blue-400"
          item={chatChip}
          isPlaced={placedRefs.has(`chat:${chatChip.refId}`)}
        />
        <FixedChip
          icon={<TerminalSquare className="h-3 w-3" aria-hidden />}
          color="bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          item={terminalChip}
          isPlaced={
            !!terminalChip.refId &&
            placedRefs.has(`terminal:${terminalChip.refId}`)
          }
        />
        <FixedChip
          icon={<Monitor className="h-3 w-3" aria-hidden />}
          color="bg-sky-500/10 border-sky-500/40 text-sky-600 dark:text-sky-400"
          item={previewChip}
          isPlaced={
            !!previewChip.refId &&
            placedRefs.has(`preview:${previewChip.refId}`)
          }
        />
      </div>

      {/* 区切り */}
      {editorItems.length > 0 && (
        <div className="h-5 w-px shrink-0 bg-border/60" aria-hidden />
      )}

      {/* 動的エディタチップ */}
      <EditorChipGroup items={editorItems} placedRefs={placedRefs} />
    </div>
  );
}

interface TrayChipItem {
  kind: SlotContentKind;
  /** null の場合は drop 時に lazy 生成（terminal / preview のみ） */
  refId: string | null;
  label: string;
  tooltip: string;
}

/* ─────────────────────────  固定チップ（✕ なし）  ───────────────────────── */

function FixedChip({
  icon,
  color,
  item,
  isPlaced,
}: {
  icon: React.ReactNode;
  color: string;
  item: TrayChipItem;
  isPlaced: boolean;
}) {
  const { kind, refId, label, tooltip } = item;
  const id = `tray-${kind}-${refId ?? "new"}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind, refId, label },
  });

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={setNodeRef}
            type="button"
            {...listeners}
            {...attributes}
            className={cn(
              "flex h-6 shrink-0 cursor-grab items-center gap-1 rounded border px-1.5 text-[11px] transition-all",
              "active:cursor-grabbing",
              isDragging && "opacity-40",
              isPlaced ? "opacity-50" : color
            )}
            aria-label={tooltip}
          >
            {icon}
            <span className="text-[11px]">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[320px] text-xs">
          <p>{tooltip}</p>
          {isPlaced ? (
            <p className="text-[10px] text-muted-foreground">配置済</p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Slot にドラッグして表示
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────  エディタチップ（削除ボタン付）  ───────────────────────── */

function EditorChipGroup({
  items,
  placedRefs,
}: {
  items: TrayChipItem[];
  placedRefs: Set<string>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((it) => (
        <EditorChip
          key={`editor:${it.refId}`}
          item={it}
          isPlaced={it.refId !== null && placedRefs.has(`editor:${it.refId}`)}
        />
      ))}
    </div>
  );
}

const MAX_CHIP_LABEL_CHARS = 12;
const EDITOR_COLOR =
  "bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400";

function EditorChip({
  item,
  isPlaced,
}: {
  item: TrayChipItem;
  isPlaced: boolean;
}) {
  const { refId, label, tooltip } = item;
  const id = `tray-editor-${refId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind: "editor" as const, refId, label },
  });

  const displayLabel =
    label.length > MAX_CHIP_LABEL_CHARS
      ? label.slice(0, MAX_CHIP_LABEL_CHARS) + "…"
      : label;

  return (
    <div
      className={cn(
        "relative flex h-6 shrink-0 items-center gap-0 rounded border text-[11px] transition-all",
        isDragging && "opacity-40",
        isPlaced ? "opacity-50" : EDITOR_COLOR
      )}
    >
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={setNodeRef}
              type="button"
              {...listeners}
              {...attributes}
              className={cn(
                "flex h-full cursor-grab items-center gap-1 rounded-l pl-1.5 pr-1",
                "active:cursor-grabbing"
              )}
              aria-label={tooltip}
            >
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              <span className="max-w-[120px] truncate text-[11px]">
                {displayLabel}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[320px] text-xs">
            <p className="truncate">{tooltip}</p>
            {isPlaced ? (
              <p className="text-[10px] text-muted-foreground">
                配置済（✕ でも削除可）
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Slot にドラッグして表示
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {refId && <EditorDeleteButton refId={refId} label={label} />}
    </div>
  );
}

function EditorDeleteButton({
  refId,
  label,
}: {
  refId: string;
  label: string;
}) {
  const purgeFile = useEditorStore((s) => s.purgeFile);
  const removeByRefId = useWorkspaceLayoutStore((s) => s.removeByRefId);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      purgeFile(refId);
      removeByRefId("editor", refId);
      toast.message(`${label} を削除しました`);
    } catch (err) {
      toast.error(
        `削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleDelete}
            className={cn(
              "ml-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm mr-1",
              "opacity-60 transition-all hover:bg-destructive/20 hover:text-destructive hover:opacity-100"
            )}
            aria-label={`${label} を削除`}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          削除
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────  Layout Switcher  ───────────────────────── */

function LayoutSwitcher() {
  const layout = useCurrentLayout();
  const setLayout = useWorkspaceLayoutStore((s) => s.setLayout);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <LayoutBtn
        active={layout === "1"}
        icon={<Square className="h-3.5 w-3.5" aria-hidden />}
        label="1 分割なし"
        onClick={() => setLayout("1")}
      />
      <LayoutBtn
        active={layout === "2h"}
        icon={<Columns2 className="h-3.5 w-3.5" aria-hidden />}
        label="2 横分割"
        onClick={() => setLayout("2h")}
      />
      <LayoutBtn
        active={layout === "2v"}
        icon={<Rows2 className="h-3.5 w-3.5" aria-hidden />}
        label="2 縦分割"
        onClick={() => setLayout("2v")}
      />
      <LayoutBtn
        active={layout === "4"}
        icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
        label="2x2 分割"
        onClick={() => setLayout("4")}
      />
    </div>
  );
}

function LayoutBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className={cn("h-7 w-7 shrink-0", active && "text-foreground")}
            onClick={onClick}
            aria-pressed={active}
            aria-label={label}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
