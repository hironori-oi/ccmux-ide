"use client";

import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";

/**
 * PM-978: tool 詳細表示の切替トグル（Eye / EyeOff アイコン）。
 *
 * 元は ChatPanel.tsx 内の private helper だったが、workspace-first UI で
 * SlotHeader にも同じ toggle を置きたいため component に切り出した。
 *
 * OFF（default）: 連続する tool use を折り畳み表示（N 件の tool 操作）
 * ON: 各 tool use を個別カードで従来通り表示
 *
 * 状態は `useSettingsStore` 経由で localStorage 永続化（全 pane 共通）。
 */
export function ToolDetailsToggle({
  size = "default",
}: {
  /** "default" は 7x7 (チャット header 用)、"small" は 5x5 (slot header 用) */
  size?: "default" | "small";
}) {
  const show = useSettingsStore((s) => s.settings.chatDisplay.showToolDetails);
  const setShow = useSettingsStore((s) => s.setShowToolDetails);

  const btnClass = size === "small" ? "h-5 w-5" : "h-7 w-7";
  const iconClass = size === "small" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(btnClass, "shrink-0")}
            onClick={() => setShow(!show)}
            aria-label={show ? "tool 操作を折り畳む" : "tool 操作を展開"}
            aria-pressed={show}
          >
            {show ? (
              <Eye className={iconClass} aria-hidden />
            ) : (
              <EyeOff className={iconClass} aria-hidden />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {show ? "tool 詳細を隠す" : "tool 詳細を表示"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
