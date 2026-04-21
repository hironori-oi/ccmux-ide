"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BookText,
  FolderTree,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MemoryTreeView } from "@/components/inspector/MemoryTreeView";
import { ContextGauge } from "@/components/sidebar/ContextGauge";
import { ProjectTree } from "@/components/sidebar/ProjectTree";
import { SessionList } from "@/components/sidebar/SessionList";
import { SubAgentsList } from "@/components/sidebar/SubAgentsList";
import { TodosList } from "@/components/sidebar/TodosList";
import { UsageStatsCard } from "@/components/sidebar/UsageStatsCard";
import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * サイドバー左ペイン（v3.4.1: タブ切替 UI に再編成）。
 *
 * ## 設計（2026-04-20 改修）
 * 縦積み Collapsible 方式（Monitor + Git）を廃し、**4 タブの切替方式** に統一。
 * 1 度に 1 つのパネルだけ表示して圧迫 / ボタン重複を解消する。
 *
 * タブ構成（v3.5.8 で順序変更）:
 *  1. Sessions : SessionList（Chat セッション一覧 + 新規作成） ← default active
 *  2. Files    : ProjectTree（選択中 project のファイルツリー）
 *  3. Memory   : CLAUDE.md ツリー（Global / Project / Cwd の rule）
 *  4. Monitor  : ContextGauge + SubAgents + Todos + Usage
 *
 * ProjectSwitcher / ActiveProjectPanel はタブ上部に常設。
 *
 * ## 折畳み
 *  - 通常: 幅 240px、タブバーとパネル本体を表示
 *  - 折畳: 幅 48px、タブバーのみ縦並びで icon-only 表示（クリックで展開 + 該当タブ選択）
 */
// v3.5.3 (2026-04-20): CLAUDE.md タブを Sidebar に追加（右 Inspector を全削除したため移設）。
// v3.5.8 (2026-04-20): オーナー要望によりタブ順を「セッション / ファイル / ルール / 実行状態」
// に変更。default active tab も "sessions" に変更（ユーザー初回起動で最も使う導線のため）。
export type SidebarTabId = "sessions" | "files" | "memory" | "monitor";

const TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: typeof FolderTree;
  tooltip: string;
}> = [
  {
    id: "sessions",
    label: "セッション",
    icon: MessageSquare,
    tooltip: "チャットセッション一覧",
  },
  {
    id: "files",
    label: "ファイル",
    icon: FolderTree,
    tooltip: "プロジェクトのファイル一覧",
  },
  {
    id: "memory",
    label: "ルール",
    icon: BookText,
    tooltip: "CLAUDE.md ツリー（Global / Project / Cwd のプロジェクトルール）",
  },
  {
    id: "monitor",
    label: "実行状態",
    icon: Activity,
    tooltip: "コンテキスト・サブエージェント・TODO・使用量",
  },
];

const ACTIVE_TAB_STORAGE_KEY = "ccmux-sidebar-tab";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTabId>("sessions");
  const openInEditor = useEditorStore((s) => s.openFile);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath = useMemo<string | undefined>(() => {
    const id = useProjectStore.getState().activeProjectId;
    if (!id) return undefined;
    return projects.find((p) => p.id === id)?.path ?? undefined;
  }, [projects]);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // 前回のタブを localStorage から復元。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (stored && TABS.some((t) => t.id === stored)) {
        setActiveTab(stored as SidebarTabId);
      }
    } catch {
      // ignore
    }
  }, []);

  // タブ変更時に保存。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  function handleTabClick(id: SidebarTabId) {
    setActiveTab(id);
    if (collapsed) setCollapsed(false);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <motion.aside
        layout
        aria-label="サイドバー"
        className={cn(
          "flex flex-col border-r bg-muted/30",
          // v3.5.7 (2026-04-20): 240px → 256px に拡幅。4 タブ（ファイル/セッション/ルール/実行状態）が
          // 60px 幅の grid で詰まってアイコン + ラベルが欠ける問題の解消。
          collapsed ? "w-12" : "w-64"
        )}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {/* TitleBar */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b px-2">
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                key="brand"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs font-semibold tracking-tight"
              >
                ccmux-ide
              </motion.span>
            )}
          </AnimatePresence>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>

        {collapsed ? (
          /* 折畳み: タブバーのみ縦並び（icon-only）、クリックで展開 + タブ選択 */
          <nav
            aria-label="サイドバータブ（折畳み）"
            className="flex flex-1 flex-col items-center gap-1 py-2"
          >
            {TABS.map((tab) => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleTabClick(tab.id)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md transition",
                      activeTab === tab.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                    aria-label={tab.tooltip}
                    aria-current={activeTab === tab.id ? "true" : undefined}
                  >
                    <tab.icon className="h-4 w-4" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {tab.tooltip}
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>
        ) : (
          /* 展開時: ProjectSwitcher + ActiveProjectPanel 常設、下にタブバー + パネル */
          <div className="flex min-h-0 flex-1 flex-col">
            {/*
             * v3.4.10 (2026-04-20): ProjectSwitcher を廃止。
             * プロジェクトの追加 / 切替 / 停止はすべて最左端 ProjectRail
             * + TitleBar 停止ボタンに集約済（スペース節約）。
             * Sidebar はタブ切替 UI から即スタート。
             */}

            {/* タブバー（水平、アイコン + ラベル） */}
            <div
              role="tablist"
              aria-label="サイドバーセクション切替"
              className="grid shrink-0 grid-cols-4 border-b bg-background/50"
            >
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <Tooltip key={tab.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`sidebar-panel-${tab.id}`}
                        onClick={() => handleTabClick(tab.id)}
                        className={cn(
                          "relative flex h-9 flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition",
                          isActive
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <tab.icon className="h-3.5 w-3.5" aria-hidden />
                        <span>{tab.label}</span>
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-tab-indicator"
                            className="absolute inset-x-1 bottom-0 h-0.5 rounded-t bg-primary"
                            transition={{
                              duration: 0.18,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            aria-hidden
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {tab.tooltip}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            {/* タブコンテンツ（flex-1 で伸縮、overflow-y 各パネル側で制御） */}
            <div className="flex min-h-0 flex-1 flex-col">
              {activeTab === "files" && (
                <div
                  id="sidebar-panel-files"
                  role="tabpanel"
                  aria-labelledby="sidebar-tab-files"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {activeProjectId ? (
                    <ProjectTree />
                  ) : (
                    <EmptyPanel message="プロジェクトを選択するとファイルが表示されます" />
                  )}
                </div>
              )}

              {activeTab === "sessions" && (
                <div
                  id="sidebar-panel-sessions"
                  role="tabpanel"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <SessionList />
                </div>
              )}

              {/* v3.5.1: Git タブは撤去済（UI 層から Git 管理機能を削除） */}

              {activeTab === "memory" && (
                <div
                  id="sidebar-panel-memory"
                  role="tabpanel"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {activeProjectId ? (
                    <ScrollArea className="flex-1 p-2">
                      <MemoryTreeView
                        key={activeProjectId}
                        repoRoot={activeProjectPath}
                        onEdit={(path) => void openInEditor(path)}
                      />
                    </ScrollArea>
                  ) : (
                    <EmptyPanel message="プロジェクトを選択すると CLAUDE.md ツリーが表示されます" />
                  )}
                </div>
              )}

              {activeTab === "monitor" && (
                <div
                  id="sidebar-panel-monitor"
                  role="tabpanel"
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <ScrollArea className="flex-1">
                    <ContextGauge />
                    <Separator className="mx-2 my-1" />
                    <SubAgentsList />
                    <Separator className="mx-2 my-1" />
                    <TodosList />
                    <Separator className="mx-2 my-1" />
                    <UsageStatsCard />
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.aside>
    </TooltipProvider>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
