"use client";

import type { ReactNode } from "react";

// NOTE(M3 切り分け): Inspector (MemoryTreeView watchImmediate + polling / WorktreeTabs)
// を一時 disable。bypass-Shell 試験で error は Shell 子に特定済、次は Inspector を
// 除外した状態で再検証する。
// import { Inspector } from "@/components/layout/Inspector";
import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
// import { UpdateNotifier } from "@/components/updates/UpdateNotifier";  // 依然 disable
import { useClaudeMonitor } from "@/hooks/useClaudeMonitor";

/**
 * Workspace 全体の統合 Shell（PM-167）。
 *
 * 構造（縦 flex）:
 *   ┌─────────────────────────────────────────┐
 *   │              TitleBar (36px)           │
 *   ├──────────┬───────────────────┬──────────┤
 *   │ Sidebar  │       main        │Inspector │
 *   │ 240/48px │     flex-1        │  320px   │
 *   ├──────────┴───────────────────┴──────────┤
 *   │             StatusBar (28px)           │
 *   └─────────────────────────────────────────┘
 *
 * - `useClaudeMonitor` をここで 1 回だけ起動し、`monitor:tick` event を store に接続。
 * - `TitleBar` / `StatusBar` は Chunk 3 の本実装を直接 import（stub 作成不要）。
 * - `Sidebar` は Chunk B で実装済、下段に Chunk 2 の ContextGauge 系を追加済。
 * - `Inspector` は M2 まで stub。
 */
export function Shell({ children }: { children: ReactNode }) {
  // モニタ listener をアプリ全体で 1 度だけマウント。
  // `Shell` はワークスペース 1 画面に 1 インスタンスなので安全。
  useClaudeMonitor();

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main
          aria-label="メインチャット"
          className="flex min-w-0 flex-1 flex-col"
        >
          {children}
        </main>
        {/* <Inspector />  ← M3 切り分け中 disable */}
      </div>
      <StatusBar />
      {/* PM-283: UpdateNotifier を一時 disable（M3 緊急対応、React error #185 切り分け中） */}
      {/* <UpdateNotifier /> */}
    </div>
  );
}
