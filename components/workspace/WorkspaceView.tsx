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

import { TrayBar } from "@/components/workspace/TrayBar";
import { SlotContainer } from "@/components/workspace/SlotContainer";
import {
  useWorkspaceLayoutStore,
  type SlotContentKind,
  type WorkspaceLayout,
} from "@/lib/stores/workspace-layout";

/**
 * PM-970: ヘテロ分割ワークスペースのルート view。
 *
 * 構成:
 *   ┌─ TrayBar (チップ + 新規作成 + LayoutSwitcher inline) ─┐
 *   └─ SlotGrid (layout に応じて 1 / 2h / 2v / 4)        ─┘
 *
 * DndContext で wrap し、drop 時に `setSlot` を発火。DragOverlay でドラッグ中の
 * ghost chip を表示。Sidebar の ProjectTree からの HTML5 native drop は SlotContainer
 * 内で個別に処理する（@dnd-kit をバイパス）。
 */
export function WorkspaceView() {
  const layout = useWorkspaceLayoutStore((s) => s.layout);
  const setSlot = useWorkspaceLayoutStore((s) => s.setSlot);

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
        <div className="min-h-0 flex-1">
          <SlotGrid layout={layout} />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div className="pointer-events-none rounded-md border border-primary/60 bg-background px-3 py-1.5 text-xs shadow-lg">
            {activeDrag.label || activeDrag.kind}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

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
