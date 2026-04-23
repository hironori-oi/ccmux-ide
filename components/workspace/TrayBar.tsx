"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Columns2,
  FileText,
  FolderOpen,
  LayoutGrid,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Plus,
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
import { useChatStore } from "@/lib/stores/chat";
import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useWorkspaceLayoutStore,
  VISIBLE_SLOTS,
  type SlotContentKind,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-971: workspace の上部 Tray Bar（削除ボタン + エディタ追加ボタン + 簡潔命名）。
 *
 * ## v1.6.0 → v1.6.1 の差分
 * - 各チップに小さな ✕ ボタンを追加: クリックで chat pane / editor file / terminal pty
 *   を閉じる（同時に slot に配置中なら slot も空にする）
 * - 📝+ エディタ追加ボタンを Tray 右側に追加: Tauri dialog で file picker を開く
 * - チャットチップを「Chat 1」「Chat 2」...の連番表示に変更（旧 "Main" / pane-id 抜粋）
 * - Preview は project 依存で 1 つのみ、かつ削除ボタン非表示（project を切替で自動変化）
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

  // PM-971: チャット pane を追加順で並べ、「Chat 1」「Chat 2」と連番表示。
  // Object.keys の順は追加順が保証される（JS spec）。
  const chatItems = useMemo(() => {
    const paneIds = Object.keys(chatPanes);
    return paneIds.map((paneId, idx) => ({
      kind: "chat" as const,
      refId: paneId,
      label: `Chat ${idx + 1}`,
      tooltip:
        paneId === "main"
          ? `Chat ${idx + 1}（メインチャット）`
          : `Chat ${idx + 1}（pane-id: ${paneId}）`,
      // main は削除不可（chat は常に 1 個以上必要）。他 pane は削除可。
      deletable: paneId !== "main",
    }));
  }, [chatPanes]);

  const editorItems = useMemo(
    () =>
      openFiles.map((f) => ({
        kind: "editor" as const,
        refId: f.id,
        label: f.title,
        tooltip: f.path,
        deletable: true,
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
        label: `Terminal ${i + 1}`,
        tooltip: t.title,
        deletable: true,
      }));
  }, [terminals, activeProjectId]);

  const previewItems = useMemo(() => {
    if (!activeProjectId) return [];
    return [
      {
        kind: "preview" as const,
        refId: activeProjectId,
        label: "Preview",
        tooltip: "プレビュー（外部サイト / dev server）",
        deletable: false,
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
        <span>
          右の「+」ボタンで追加するか、サイドバーのファイルを slot にドラッグしてください
        </span>
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

interface TrayChipItem {
  kind: SlotContentKind;
  refId: string;
  label: string;
  tooltip: string;
  deletable: boolean;
}

function ChipGroup({
  icon,
  color,
  items,
  placedRefs,
}: {
  icon: React.ReactNode;
  color: string;
  items: TrayChipItem[];
  placedRefs: Set<string>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {items.map((it) => (
        <TrayChip
          key={`${it.kind}:${it.refId}`}
          item={it}
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
  item,
  icon,
  color,
  isPlaced,
}: {
  item: TrayChipItem;
  icon: React.ReactNode;
  color: string;
  isPlaced: boolean;
}) {
  const { kind, refId, label, tooltip, deletable } = item;
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
    <div
      className={cn(
        "relative flex h-6 shrink-0 items-center gap-0 rounded border text-[11px] transition-all",
        isDragging && "opacity-40",
        isPlaced ? "opacity-50" : color
      )}
    >
      {/* ドラッグハンドル領域 = チップ本体 */}
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={setNodeRef}
              type="button"
              {...listeners}
              {...attributes}
              className={cn(
                "flex h-full cursor-grab items-center gap-1 rounded-l pl-1.5",
                !deletable && "rounded-r pr-1.5",
                deletable && "pr-1",
                "active:cursor-grabbing"
              )}
              aria-label={tooltip}
            >
              {icon}
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

      {/* 削除ボタン */}
      {deletable && (
        <DeleteChipButton kind={kind} refId={refId} label={label} />
      )}
    </div>
  );
}

function DeleteChipButton({
  kind,
  refId,
  label,
}: {
  kind: SlotContentKind;
  refId: string;
  label: string;
}) {
  const removeChatPane = useChatStore((s) => s.removePane);
  const closeFile = useEditorStore((s) => s.closeFile);
  const closeTerminal = useTerminalStore((s) => s.closeTerminal);
  const removeByRefId = useWorkspaceLayoutStore((s) => s.removeByRefId);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (kind === "chat") {
        removeChatPane(refId);
      } else if (kind === "editor") {
        closeFile(refId);
      } else if (kind === "terminal") {
        await closeTerminal(refId);
      }
      // slot に配置済なら slot も空に
      removeByRefId(kind, refId);
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
            onClick={(e) => void handleDelete(e)}
            className={cn(
              "ml-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm",
              "opacity-60 transition-all hover:bg-destructive/20 hover:text-destructive hover:opacity-100",
              "mr-1"
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

/* ─────────────────────────  新規作成ボタン  ───────────────────────── */

function CreationButtons() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProjectPath = useProjectStore((s) => {
    if (!s.activeProjectId) return null;
    return s.projects.find((p) => p.id === s.activeProjectId)?.path ?? null;
  });
  const addChatPane = useChatStore((s) => s.addPane);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const openFile = useEditorStore((s) => s.openFile);
  const [spawning, setSpawning] = useState(false);

  const disabled = !activeProjectId;

  async function handleAddChat() {
    if (disabled) return;
    const id = addChatPane();
    if (!id) {
      toast.message("チャットは 4 個までです");
      return;
    }
    toast.success("チャットを追加しました");
  }

  async function handleAddEditor() {
    if (disabled || !activeProjectPath) return;
    try {
      // Tauri native file picker。defaultPath でプロジェクトルートから開始。
      const selected = await openDialog({
        multiple: false,
        directory: false,
        defaultPath: activeProjectPath,
        title: "エディタで開くファイルを選択",
      });
      if (!selected || typeof selected !== "string") return;
      await openFile(selected);
      toast.success("ファイルを開きました");
    } catch (e) {
      toast.error(
        `ファイルを開けませんでした: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async function handleAddTerminal() {
    if (disabled || !activeProjectId || !activeProjectPath || spawning) return;
    setSpawning(true);
    try {
      const ptyId = await createTerminal(activeProjectId, activeProjectPath);
      if (ptyId) toast.success("ターミナルを追加しました");
    } catch (e) {
      toast.error(
        `ターミナル起動失敗: ${e instanceof Error ? e.message : String(e)}`
      );
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
        icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden />}
        label="エディタでファイルを開く"
        colorClass="text-amber-500 hover:bg-amber-500/10"
        disabled={disabled}
        onClick={handleAddEditor}
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
      {/* Preview は project に 1 個、チップ自体が常時存在するため + ボタン不要。 */}
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
