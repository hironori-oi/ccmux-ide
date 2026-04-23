"use client";

import { useEffect, useState } from "react";
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

import { toast } from "sonner";

import { TrayBar } from "@/components/workspace/TrayBar";
import { SlotContainer } from "@/components/workspace/SlotContainer";
import { DEFAULT_PANE_ID } from "@/lib/stores/chat";
import { usePreviewInstances } from "@/lib/stores/preview-instances";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import { useTerminalStore } from "@/lib/stores/terminal";
import {
  useCurrentLayout,
  useCurrentSlots,
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
  // PM-981: current session の layout / slots を subscribe
  const layout = useCurrentLayout();
  const setSlot = useWorkspaceLayoutStore((s) => s.setSlot);
  const slots = useCurrentSlots();
  // PM-981: session 切替を検知して auto-provision を再実行する
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  // PM-977 / PM-981: 初回起動 UX + session 切替 UX。
  // Current session の全 slot が空なら main chat を slot 0 に自動配置する。
  // - 初回起動時: session 未選択 or 初めての session で slot が空 → 自動配置
  // - session 切替時: 新 session の slot が空 → 自動配置
  // - ユーザーが明示的に全 slot を空にした状態でも session を切替えて戻すと
  //   再配置される（「空っぽで戸惑う」を回避）
  useEffect(() => {
    const allEmpty = slots.every((s) => s === null);
    if (allEmpty) {
      setSlot(0, { kind: "chat", refId: DEFAULT_PANE_ID });
    }
    // currentSessionId の変化で再評価（session 切替で新 session が空なら
    // 自動配置）。slots の変化では発火させない（ユーザーの手動操作を尊重）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

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
      | { kind: SlotContentKind; refId: string | null; label: string }
      | undefined;
    if (!data) return;
    setActiveDrag({ kind: data.kind, label: data.label });
  }

  /**
   * PM-982: refId が null の場合（terminal / preview の未作成状態）は drop 時に
   * lazy 生成してから setSlot する。chat と editor は常に refId がある前提。
   */
  async function handleDragEnd(ev: DragEndEvent) {
    setActiveDrag(null);
    const over = ev.over;
    const active = ev.active;
    if (!over || !active) return;
    const overData = over.data.current as { slotIndex?: number } | undefined;
    const activeData = active.data.current as
      | { kind: SlotContentKind; refId: string | null; label: string }
      | undefined;
    if (
      !activeData ||
      !overData ||
      typeof overData.slotIndex !== "number"
    )
      return;

    const slotIndex = overData.slotIndex;

    // refId が既にあれば即 setSlot
    if (activeData.refId) {
      setSlot(slotIndex, {
        kind: activeData.kind,
        refId: activeData.refId,
      });
      return;
    }

    // 以下 lazy 生成経路（terminal / preview のみ）
    if (activeData.kind === "terminal") {
      const { activeProjectId, projects } = useProjectStore.getState();
      if (!activeProjectId) {
        toast.error("プロジェクトが選択されていません");
        return;
      }
      const projectPath =
        projects.find((p) => p.id === activeProjectId)?.path ?? null;
      if (!projectPath) {
        toast.error("プロジェクトパスが取得できません");
        return;
      }
      try {
        const ptyId = await useTerminalStore
          .getState()
          .createTerminal(activeProjectId, projectPath);
        if (!ptyId) {
          toast.error("ターミナルの起動に失敗しました");
          return;
        }
        setSlot(slotIndex, { kind: "terminal", refId: ptyId });
      } catch (e) {
        toast.error(
          `ターミナル起動失敗: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      return;
    }

    if (activeData.kind === "preview") {
      const { activeProjectId } = useProjectStore.getState();
      if (!activeProjectId) {
        toast.error("プロジェクトが選択されていません");
        return;
      }
      const sessionId = useSessionStore.getState().currentSessionId;
      const id = usePreviewInstances
        .getState()
        .addInstance(activeProjectId, { sessionId });
      setSlot(slotIndex, { kind: "preview", refId: id });
      return;
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={(ev) => void handleDragEnd(ev)}
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
