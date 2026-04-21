"use client";

import { useMemo } from "react";

import { SplitView } from "@/components/layout/SplitView";
import { TerminalPaneItem } from "@/components/terminal/TerminalPaneItem";
import { useProjectStore } from "@/lib/stores/project";
import { useTerminalStore } from "@/lib/stores/terminal";

/**
 * PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル container。
 * PRJ-012 PM-924 (2026-04-20): Terminal を SplitView 対応。
 *
 * ## PM-924 以前
 * - active project に紐づく pty の sub-tab 表示（複数 pty 切替）
 * - 「+新規」ボタンで `createTerminal(projectId, cwd)` 呼出
 * - pty の close 操作
 * - 初回表示時に pty が 0 件なら auto-spawn
 *
 * ## PM-924 以降
 * - `terminalPanes` を SplitView で 1〜2 pane に分割表示
 * - 各 pane は独自の sub-tab 群（pty）を持つ（`TerminalPaneItem` が担当）
 * - 全 pane で共有されるのは pty の map + project 情報のみ（pty は paneId field で所属を識別）
 *
 * 複数 pty がある場合は display:none で非 active を隠すことで xterm 状態を保持する
 * 挙動は `TerminalPaneItem` 内部で pane ごとに継続。
 */
export function TerminalView() {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const terminalPanes = useTerminalStore((s) => s.terminalPanes);
  const paneIds = useMemo(
    () => Object.keys(terminalPanes),
    [terminalPanes]
  );

  if (!activeProject) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        プロジェクトを選択するとターミナルが使えます
      </div>
    );
  }

  const items = paneIds.map((id) => ({
    id,
    content: (
      <TerminalPaneItem
        paneId={id}
        showHeader={paneIds.length > 1}
        canClose={paneIds.length > 1}
      />
    ),
  }));

  return <SplitView panes={items} />;
}
