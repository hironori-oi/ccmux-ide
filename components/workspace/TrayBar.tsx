"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Columns2,
  FileText,
  LayoutGrid,
  MessageSquarePlus,
  Monitor,
  Plus,
  Rows2,
  Square,
  TerminalSquare,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStore } from "@/lib/stores/chat";
import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useWorkspaceLayoutStore,
  VISIBLE_SLOTS,
  type SlotContentKind,
  type WorkspaceLayout,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-970: workspace の上部 Tray Bar（全面再設計）。
 *
 * ## 責務
 *
 * 1. **チップ表示** — chat / editor / terminal / preview の開いている項目を
 *    icon-first のコンパクトチップで一覧する。label は最大 12 文字 truncate、
 *    tooltip で full name 表示。
 * 2. **新規作成ボタン** — チャット / ターミナル / プレビューを 1 クリックで追加。
 *    エディタは sidebar のファイルを slot 直接 D&D で開く設計のため button なし。
 * 3. **LayoutSwitcher 統合** — 1 / 2 横 / 2 縦 / 2x2 を右端に inline 配置。
 *
 * ## 旧 TrayBar との差分
 * - チップに "Chat (main)" のような長文を出さず、Chat は icon のみ。
 * - Editor は 12 文字でファイル名 truncate、tooltip で full path。
 * - 全体を 1 行に収め、縦スペース節約（従来 2 段 → 1 段 + 44px）。
 */
export function TrayBar() {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-muted/10 px-2">
      <TrayChips />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CreationButtons />
        <div className="mx-1 h-5 w-px bg-border/60" aria-hidden />
        <LayoutSwitcher />
      </div>
    </div>
  );
}

/* ─────────────────────────  チップ一覧  ───────────────────────── */

function TrayChips() {
  const chatPanes = useChatStore((s) => s.panes);
  const openFiles = useEditorStore((s) => s.openFiles);
  const terminals = useTerminalStore((s) => s.terminals);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const slots = useWorkspaceLayoutStore((s) => s.slots);
  const layout = useWorkspaceLayoutStore((s) => s.layout);

  const visibleSlotIndexes = useMemo(() => VISIBLE_SLOTS[layout], [layout]);
  const placedRefs = useMemo(() => {
    const m = new Set<string>();
    for (const idx of visibleSlotIndexes) {
      const c = slots[idx];
      if (c) m.add(`${c.kind}:${c.refId}`);
    }
    return m;
  }, [slots, visibleSlotIndexes]);

  const chatItems = useMemo(
    () =>
      Object.keys(chatPanes).map((paneId) => ({
        kind: "chat" as const,
        refId: paneId,
        label: paneId === "main" ? "Main" : paneId.replace(/^pane-/, ""),
        tooltip: paneId === "main" ? "Main chat" : `Chat pane (${paneId})`,
      })),
    [chatPanes]
  );

  const editorItems = useMemo(
    () =>
      openFiles.map((f) => ({
        kind: "editor" as const,
        refId: f.id,
        label: f.title,
        tooltip: f.path,
      })),
    [openFiles]
  );

  const terminalItems = useMemo(() => {
    if (!activeProjectId) return [];
    return Object.values(terminals)
      .filter((t) => t.projectId === activeProjectId && !t.exited)
      .map((t, i) => ({
        kind: "terminal" as const,
        refId: t.ptyId,
        label: `${i + 1}`,
        tooltip: t.title,
      }));
  }, [terminals, activeProjectId]);

  const previewItems = useMemo(() => {
    if (!activeProjectId) return [];
    return [
      {
        kind: "preview" as const,
        refId: activeProjectId,
        label: "",
        tooltip: "プレビュー (外部サイト / dev server)",
      },
    ];
  }, [activeProjectId]);

  const isEmpty =
    chatItems.length === 0 &&
    editorItems.length === 0 &&
    terminalItems.length === 0;

  if (isEmpty && previewItems.length === 0) {
    return (
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
        <span>右の「+」ボタンで追加するか、サイドバーのファイルを slot にドラッグしてください</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      <ChipGroup
        icon={<MessageSquare className="h-3 w-3" aria-hidden />}
        color="bg-blue-500/10 border-blue-500/40 text-blue-600 dark:text-blue-400"
        items={chatItems}
        placedRefs={placedRefs}
      />
      <ChipGroup
        icon={<FileText className="h-3 w-3" aria-hidden />}
        color="bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400"
        items={editorItems}
        placedRefs={placedRefs}
      />
      <ChipGroup
        icon={<TerminalSquare className="h-3 w-3" aria-hidden />}
        color="bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
        items={terminalItems}
        placedRefs={placedRefs}
      />
      <ChipGroup
        icon={<Monitor className="h-3 w-3" aria-hidden />}
        color="bg-sky-500/10 border-sky-500/40 text-sky-600 dark:text-sky-400"
        items={previewItems}
        placedRefs={placedRefs}
      />
    </div>
  );
}

function ChipGroup({
  icon,
  color,
  items,
  placedRefs,
}: {
  icon: React.ReactNode;
  color: string;
  items: Array<{
    kind: SlotContentKind;
    refId: string;
    label: string;
    tooltip: string;
  }>;
  placedRefs: Set<string>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((it) => (
        <TrayChip
          key={`${it.kind}:${it.refId}`}
          kind={it.kind}
          refId={it.refId}
          label={it.label}
          tooltip={it.tooltip}
          icon={icon}
          color={color}
          isPlaced={placedRefs.has(`${it.kind}:${it.refId}`)}
        />
      ))}
    </div>
  );
}

const MAX_CHIP_LABEL_CHARS = 12;

function TrayChip({
  kind,
  refId,
  label,
  tooltip,
  icon,
  color,
  isPlaced,
}: {
  kind: SlotContentKind;
  refId: string;
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  color: string;
  isPlaced: boolean;
}) {
  const id = `tray-${kind}-${refId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind, refId, label },
  });

  // 12 文字超はエリプシス
  const displayLabel =
    label.length > MAX_CHIP_LABEL_CHARS
      ? label.slice(0, MAX_CHIP_LABEL_CHARS) + "…"
      : label;

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
            {displayLabel && (
              <span className="max-w-[120px] truncate text-[11px]">
                {displayLabel}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[320px] text-xs">
          <p className="truncate">{tooltip}</p>
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

/* ─────────────────────────  新規作成ボタン  ───────────────────────── */

function CreationButtons() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProjectPath = useProjectStore((s) => {
    if (!s.activeProjectId) return null;
    return s.projects.find((p) => p.id === s.activeProjectId)?.path ?? null;
  });
  const addChatPane = useChatStore((s) => s.addPane);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const [spawning, setSpawning] = useState(false);

  const disabled = !activeProjectId;

  async function handleAddChat() {
    if (disabled) return;
    const id = addChatPane();
    if (!id) {
      toast.message("チャットペインは 4 つまでです");
      return;
    }
    toast.success("チャットを追加しました");
  }

  async function handleAddTerminal() {
    if (disabled || !activeProjectId || !activeProjectPath || spawning) return;
    setSpawning(true);
    try {
      const ptyId = await createTerminal(activeProjectId, activeProjectPath);
      if (ptyId) toast.success("ターミナルを追加しました");
    } catch (e) {
      toast.error(`ターミナル起動失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSpawning(false);
    }
  }

  return (
    <>
      <CreationButton
        icon={<MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />}
        label="チャット追加"
        colorClass="text-blue-500 hover:bg-blue-500/10"
        disabled={disabled}
        onClick={handleAddChat}
      />
      <CreationButton
        icon={<TerminalSquare className="h-3.5 w-3.5" aria-hidden />}
        label="ターミナル追加"
        colorClass="text-emerald-500 hover:bg-emerald-500/10"
        disabled={disabled || spawning}
        onClick={handleAddTerminal}
        indicator={
          spawning ? (
            <Plus className="h-3 w-3 animate-spin" aria-hidden />
          ) : undefined
        }
      />
      {/* Preview は project に 1 個、チップ自体が常時存在するため + ボタン不要。
          Editor は Sidebar のファイルを slot 直接 D&D で開く設計のため + ボタンなし。 */}
    </>
  );
}

function CreationButton({
  icon,
  label,
  colorClass,
  disabled,
  onClick,
  indicator,
}: {
  icon: React.ReactNode;
  label: string;
  colorClass: string;
  disabled: boolean;
  onClick: () => void | Promise<void>;
  indicator?: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7 shrink-0", colorClass)}
            disabled={disabled}
            onClick={() => void onClick()}
            aria-label={label}
          >
            {indicator ?? icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────  Layout Switcher  ───────────────────────── */

function LayoutSwitcher() {
  const layout = useWorkspaceLayoutStore((s) => s.layout);
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
// Unused suppression for WorkspaceLayout type (kept for future extension)
void ({} as WorkspaceLayout);
