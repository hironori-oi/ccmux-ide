"use client";

import { type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.5 Chunk B (Split Sessions) / SplitView。
 *
 * `react-resizable-panels` の薄いラッパー。
 *
 * - `panes` は 1 / 2 / 4 件（PM-937 で 4 pane 対応）
 * - 初期比率は均等、最小 20% / 20%
 * - 1 pane のときは PanelGroup を張らずに素通し（resize ハンドル不要）
 * - 2 pane のときは水平 (左右) 分割
 * - 4 pane のときは 2x2 grid（vertical PanelGroup の中に horizontal PanelGroup 2 つ）
 *
 * autoSaveId を指定すると pane 比率が localStorage に保存される。pane 数（≒ layout）
 * に応じて autoSaveId を切替え、1↔2↔4 切替時に旧 layout の比率が混入しないようにする。
 */
export function SplitView({
  panes,
  className,
}: {
  panes: Array<{ id: string; content: ReactNode }>;
  className?: string;
}) {
  if (panes.length === 0) return null;
  if (panes.length === 1) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {panes[0].content}
      </div>
    );
  }

  if (panes.length === 2) {
    return (
      <PanelGroup
        direction="horizontal"
        autoSaveId="ccmux-ide-gui:splitview-2"
        className={cn("flex min-h-0 flex-1", className)}
      >
        {panes.map((pane, idx) => (
          <PanelGroupItem
            key={pane.id}
            paneId={pane.id}
            isLast={idx === panes.length - 1}
            order={idx}
          >
            {pane.content}
          </PanelGroupItem>
        ))}
      </PanelGroup>
    );
  }

  // 4 pane (2x2 grid): panes[0..1] = top row, panes[2..3] = bottom row
  // 5 件以上は想定外だが、先頭 4 件だけ描画して落とさない（fail-safe）。
  const quad = panes.slice(0, 4);
  // 不足分は空で埋める。通常は store 側で 4 件揃える運用。
  while (quad.length < 4) {
    quad.push({ id: `__empty-${quad.length}`, content: null });
  }

  return (
    <PanelGroup
      direction="vertical"
      autoSaveId="ccmux-ide-gui:splitview-4-outer"
      className={cn("flex min-h-0 flex-1", className)}
    >
      <Panel
        id="quad-row-top"
        order={1}
        defaultSize={50}
        minSize={20}
        className="flex min-h-0 flex-col"
      >
        <PanelGroup
          direction="horizontal"
          autoSaveId="ccmux-ide-gui:splitview-4-top"
          className="flex min-h-0 flex-1"
        >
          <PanelGroupItem paneId={quad[0].id} isLast={false} order={0}>
            {quad[0].content}
          </PanelGroupItem>
          <PanelGroupItem paneId={quad[1].id} isLast={true} order={1}>
            {quad[1].content}
          </PanelGroupItem>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle
        className={cn(
          "relative h-1 bg-border transition-colors",
          "hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60",
          "after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']"
        )}
        aria-label="ペインの境界をドラッグして高さを変更"
      />
      <Panel
        id="quad-row-bottom"
        order={2}
        defaultSize={50}
        minSize={20}
        className="flex min-h-0 flex-col"
      >
        <PanelGroup
          direction="horizontal"
          autoSaveId="ccmux-ide-gui:splitview-4-bottom"
          className="flex min-h-0 flex-1"
        >
          <PanelGroupItem paneId={quad[2].id} isLast={false} order={0}>
            {quad[2].content}
          </PanelGroupItem>
          <PanelGroupItem paneId={quad[3].id} isLast={true} order={1}>
            {quad[3].content}
          </PanelGroupItem>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}

/**
 * PanelGroup の子 = Panel + 必要なら ResizeHandle。
 * 最後の Panel には ResizeHandle を付けない（右端に不要）。
 */
function PanelGroupItem({
  paneId,
  isLast,
  order,
  children,
}: {
  paneId: string;
  isLast: boolean;
  order: number;
  children: ReactNode;
}) {
  return (
    <>
      <Panel
        id={paneId}
        order={order}
        defaultSize={50}
        minSize={20}
        className="flex min-h-0 flex-col"
      >
        {children}
      </Panel>
      {!isLast && (
        <PanelResizeHandle
          className={cn(
            "relative w-1 bg-border transition-colors",
            "hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60",
            // 中央に細いグリップを疑似表示
            "after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']"
          )}
          aria-label="ペインの境界をドラッグして幅を変更"
        />
      )}
    </>
  );
}
