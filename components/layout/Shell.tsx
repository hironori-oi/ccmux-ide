"use client";

import type { ReactNode } from "react";

import { Inspector } from "@/components/layout/Inspector";
import { ProjectRail } from "@/components/layout/ProjectRail";
import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
// NOTE(M3): UpdateNotifier は dogfood に不要かつ挙動不明なので disable 継続。
// 復活は v0.2.0 以降で updater 鍵発行 (PM-304) と併せて検証予定。
// import { UpdateNotifier } from "@/components/updates/UpdateNotifier";
import { useClaudeMonitor } from "@/hooks/useClaudeMonitor";

/**
 * Workspace 全体の統合 Shell（PM-167）。
 *
 * 構造（縦 flex）:
 *   ┌──────────────────────────────────────────────────┐
 *   │                TitleBar (36px)                   │
 *   ├─────┬──────────┬───────────────────┬────────────┤
 *   │Rail │ Sidebar  │       main        │ Inspector  │
 *   │48px │ 240/48px │     flex-1        │   320px    │
 *   ├─────┴──────────┴───────────────────┴────────────┤
 *   │                StatusBar (28px)                  │
 *   └──────────────────────────────────────────────────┘
 *
 * ※ ProjectRail は PRJ-012 Round B で追加（Discord/Slack 風の
 *   縦アイコン列、ワンクリックでプロジェクト切替）。
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
        <ProjectRail />
        <Sidebar />
        <main
          aria-label="メインチャット"
          className="flex min-w-0 flex-1 flex-col"
        >
          {children}
        </main>
        <Inspector />
      </div>
      <StatusBar />
      {/* PM-283: UpdateNotifier を一時 disable（M3 緊急対応、React error #185 切り分け中） */}
      {/* <UpdateNotifier /> */}
    </div>
  );
}
