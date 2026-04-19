"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
// NOTE(M3 切り分け Round 5): Project 無罪確定、Monitor 3 つ (ContextGauge /
// SubAgentsList / TodosList) を disable して SessionList 単独で検証。
// import { ContextGauge } from "@/components/sidebar/ContextGauge";
// import { ProjectSwitcher } from "@/components/sidebar/ProjectSwitcher";
// import { ProjectTree } from "@/components/sidebar/ProjectTree";
import { SessionList } from "@/components/sidebar/SessionList";
// import { SubAgentsList } from "@/components/sidebar/SubAgentsList";
// import { TodosList } from "@/components/sidebar/TodosList";
// import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * サイドバー左ペイン（PM-152 / PM-167）。
 *
 * レイアウト（上→下）:
 *   - TitleBar: ブランド表示 + 折畳ボタン
 *   - SessionList: 新規セッション + 一覧（flex-1 で伸縮 + 内部 overflow-y）
 *   - Separator
 *   - ContextGauge + SubAgentsList + TodosList を縦積み（ScrollArea 内）
 *
 * - 既定幅 240px、折畳時は 48px
 * - 折畳時はブランド名 / 本体 UI を全て非表示
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  // const activeProjectId = useProjectStore((s) => s.activeProjectId);

  return (
    <motion.aside
      layout
      aria-label="サイドバー"
      className={cn(
        "flex flex-col border-r bg-muted/30",
        collapsed ? "w-12" : "w-60"
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

      {/* 本体: 折畳時は非表示 */}
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Project セクション: M3 切り分け中 disable
          <div className="shrink-0">
            <ProjectSwitcher />
            {activeProjectId && <ProjectTree />}
          </div>
          <Separator />
          */}

          {/* セッション一覧（中央、伸縮） */}
          <SessionList />

          {/* M3 切り分け Round 5: Monitor 3 つ を一時 disable
          <Separator />
          <ScrollArea className="shrink-0 max-h-[45%] basis-auto">
            <ContextGauge />
            <Separator className="mx-2 my-1" />
            <SubAgentsList />
            <Separator className="mx-2 my-1" />
            <TodosList />
          </ScrollArea>
          */}
        </div>
      )}
    </motion.aside>
  );
}
