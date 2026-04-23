"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Columns2, LayoutGrid, Rows2, Square } from "lucide-react";

import { TrayBar } from "@/components/workspace/TrayBar";
import { SlotContainer } from "@/components/workspace/SlotContainer";
import { Button } from "@/components/ui/button";
import {
  useWorkspaceLayoutStore,
  type SlotContentKind,
  type WorkspaceLayout,
} from "@/lib/stores/workspace-layout";
import { cn } from "@/lib/utils";

/**
 * PM-969: ヘテロ分割ワークスペースのルート view。
 *
 * 画面上部: TrayBar（開いている項目のドラッグソース）
 * 画面中央: layout に応じた 1 / 2 / 4 slot のグリッド
 * 画面右上: layout 切替ボタン（1 pane / 2h / 2v / 4）
 *
 * DndContext で全体を wrap し、drop 時に `setSlot` を発火する。
 */
export function WorkspaceView() {
  const layout = useWorkspaceLayoutStore((s) => s.layout);
  const setSlot = useWorkspaceLayoutStore((s) => s.setSlot);
  const setLayout = useWorkspaceLayoutStore((s) => s.setLayout);

  const [activeDrag, setActiveDrag] = useState<{
    kind: SlotContentKind;
    label: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function handleDragStart(ev: DragStartEvent) {
    const data = ev.active.data.current as
      | { kind: SlotContentKind; refId: string; label: string }
      | undefined;
    if (!data) return;
    setActiveDrag({ kind: data.kind, label: data.label });
  }

  function handleDragEnd(ev: DragEndEvent) {
    setActiveDrag(null);
    const over = ev.over;
    const active = ev.active;
    if (!over || !active) return;
    const overData = over.data.current as { slotIndex?: number } | undefined;
    const activeData = active.data.current as
      | { kind: SlotContentKind; refId: string; label: string }
      | undefined;
    if (
      !activeData ||
      !overData ||
      typeof overData.slotIndex !== "number"
    )
      return;
    setSlot(overData.slotIndex, {
      kind: activeData.kind,
      refId: activeData.refId,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <TrayBar />
        <LayoutSwitcher layout={layout} onChange={setLayout} />
        <div className="min-h-0 flex-1">
          <SlotGrid layout={layout} />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div className="pointer-events-none rounded-md border border-primary/60 bg-background px-3 py-1.5 text-xs shadow-lg">
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function LayoutSwitcher({
  layout,
  onChange,
}: {
  layout: WorkspaceLayout;
  onChange: (l: WorkspaceLayout) => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/10 px-2 text-[11px] text-muted-foreground">
      <span className="mr-1">レイアウト:</span>
      <LayoutBtn
        active={layout === "1"}
        icon={<Square className="h-3 w-3" aria-hidden />}
        label="1"
        onClick={() => onChange("1")}
      />
      <LayoutBtn
        active={layout === "2h"}
        icon={<Columns2 className="h-3 w-3" aria-hidden />}
        label="2 横"
        onClick={() => onChange("2h")}
      />
      <LayoutBtn
        active={layout === "2v"}
        icon={<Rows2 className="h-3 w-3" aria-hidden />}
        label="2 縦"
        onClick={() => onChange("2v")}
      />
      <LayoutBtn
        active={layout === "4"}
        icon={<LayoutGrid className="h-3 w-3" aria-hidden />}
        label="4 (2x2)"
        onClick={() => onChange("4")}
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
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className={cn("h-6 gap-1 px-2 text-[11px]", active && "text-foreground")}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * レイアウト別の slot grid。layout が変わると slot 数だけ描画し、残りは state に
 * 残ったまま（次に layout を戻したときも復元できる）。
 */
/**
 * SlotGrid は slots の実体を直接参照しない。各 SlotContainer が自身で
 * store から subscribe するため、ここでは layout のみが必要。
 */
function SlotGrid({ layout }: { layout: WorkspaceLayout }) {
  if (layout === "1") {
    return (
      <div className="flex h-full">
        <SlotContainer slotIndex={0} slotLabel="A" />
      </div>
    );
  }
  if (layout === "2h") {
    return (
      <div className="grid h-full grid-cols-2 gap-px bg-border/20">
        <SlotContainer slotIndex={0} slotLabel="A" />
        <SlotContainer slotIndex={1} slotLabel="B" />
      </div>
    );
  }
  if (layout === "2v") {
    return (
      <div className="grid h-full grid-rows-2 gap-px bg-border/20">
        <SlotContainer slotIndex={0} slotLabel="A" />
        <SlotContainer slotIndex={2} slotLabel="C" />
      </div>
    );
  }
  // layout === "4"
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-px bg-border/20">
      <SlotContainer slotIndex={0} slotLabel="A" />
      <SlotContainer slotIndex={1} slotLabel="B" />
      <SlotContainer slotIndex={2} slotLabel="C" />
      <SlotContainer slotIndex={3} slotLabel="D" />
    </div>
  );
}
