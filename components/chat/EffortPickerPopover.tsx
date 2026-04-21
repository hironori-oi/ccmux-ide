"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Gauge } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDialogStore } from "@/lib/stores/dialog";
import { useProjectStore } from "@/lib/stores/project";
import { EFFORT_CHOICES, type EffortLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.4.9: StatusBar 向け Claude Desktop 風 **compact 工数 picker**。
 *
 * - trigger: `工数: 中 ▾` 形式の h-6 text-xs button
 * - content: 5 段階（低 / 中 / 高 / 超高 / 最大）を radiogroup 相当 button list で選ぶ
 * - 各アイテムに「推論トークン N,NNN」を補足（EFFORT_CHOICES.thinkingTokens）
 *
 * ## v3.5.16 PM-840 (Claude Desktop 風 Live 切替)
 *
 * Model picker と同じく **実態追従 + 自動再起動 + resume 継続** で Claude Desktop
 * 同等 UX を再現する。
 *
 * - **表示値**: active project の `runningEffort` があれば優先、なければ dialog
 *   store の `selectedEffort` を default として表示。
 * - **選択時**:
 *   - active + sidecar 起動中 → `restartSidecarWithModel(id, curModel, newEffort)`
 *     で sidecar を即再起動、会話 context は resume で継続
 *   - active + sidecar 停止中 → default 更新のみ（次回「起動」ボタンで反映）
 *   - active なし → default 更新のみ
 */
export function EffortPickerPopover() {
  const dialogEffort = useDialogStore((s) => s.selectedEffort);
  const setDialogEffort = useDialogStore((s) => s.setSelectedEffort);
  const dialogModel = useDialogStore((s) => s.selectedModel);

  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const restartSidecarWithModel = useProjectStore(
    (s) => s.restartSidecarWithModel
  );
  const getSidecarStatus = useProjectStore((s) => s.getSidecarStatus);

  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId) ?? null
    : null;

  const current: EffortLevel = activeProject?.runningEffort ?? dialogEffort;
  const modelForRestart = activeProject?.runningModel ?? dialogModel;

  const [open, setOpen] = useState(false);

  const currentMeta =
    EFFORT_CHOICES.find((e) => e.id === current) ?? EFFORT_CHOICES[1];

  async function handleSelect(id: EffortLevel) {
    if (id === current) {
      setOpen(false);
      return;
    }
    const meta = EFFORT_CHOICES.find((e) => e.id === id);
    setOpen(false);

    setDialogEffort(id);

    if (activeProject) {
      const status = getSidecarStatus(activeProject.id);
      if (status === "stopped") {
        toast.success(
          `推論工数を「${meta?.label ?? id}」に変更しました（次回 Claude 起動時から反映されます）`
        );
        return;
      }
      void restartSidecarWithModel(activeProject.id, modelForRestart, id);
      return;
    }

    toast.success(
      `推論工数 default を「${meta?.label ?? id}」に変更しました（次回 sidecar 起動時から反映）`
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`推論工数: ${currentMeta.label}`}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open && "bg-muted"
          )}
        >
          <Gauge
            className={cn("h-3 w-3", effortIconColor(currentMeta.id))}
            aria-hidden
          />
          <span className="hidden font-medium text-foreground/80 md:inline">
            工数: {currentMeta.label}
          </span>
          <span className="sr-only md:hidden">
            工数: {currentMeta.label}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-64 p-1"
        aria-label="推論工数選択"
      >
        <div
          role="radiogroup"
          aria-label="推論工数"
          className="flex flex-col gap-0.5"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            推論工数
            {activeProject ? (
              <span className="ml-1 font-normal normal-case text-muted-foreground/70">
                （{activeProject.title}）
              </span>
            ) : null}
          </div>
          {EFFORT_CHOICES.map((e) => {
            const selected = e.id === current;
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void handleSelect(e.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/70 text-foreground/90"
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{e.label}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                  )}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {e.description}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground/70">
                  推論トークン {e.thinkingTokens.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** effort レベル別の icon 色（低=緑 / 中=amber / 高=orange / 超高=orange-dark / max=赤）。 */
function effortIconColor(level: EffortLevel): string {
  switch (level) {
    case "low":
      return "text-emerald-500 dark:text-emerald-400";
    case "medium":
      return "text-amber-500 dark:text-amber-400";
    case "high":
      return "text-orange-500 dark:text-orange-400";
    case "xhigh":
      return "text-orange-600 dark:text-orange-500";
    case "max":
      return "text-red-500 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}
