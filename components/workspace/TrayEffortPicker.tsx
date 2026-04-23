"use client";

import { useState } from "react";
import { Check, ChevronDown, Gauge } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import {
  selectProjectPreferences,
  selectSessionPreferences,
  useSessionPreferencesStore,
} from "@/lib/stores/session-preferences";
import { EFFORT_CHOICES, type EffortLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.11.0 (DEC-057): TrayBar 用 **セッション別 推論工数 picker**。
 *
 * - 選択値は session-preferences store (`perSession[sessionId].effort`)
 * - 変更時は `perProject[projectId].effort` にも sticky に記録
 * - session 未選択時は disabled + `—`
 * - 未設定時は **当該 project の perProject** を fallback 表示（dialog 参照なし）
 * - 値変更は per-query で `send_agent_prompt` options.maxThinkingTokens に反映
 */
export function TrayEffortPicker() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const pref = useSessionPreferencesStore((s) =>
    selectSessionPreferences(s, currentSessionId),
  );
  const projectPref = useSessionPreferencesStore((s) =>
    selectProjectPreferences(s, activeProjectId),
  );
  const setPreference = useSessionPreferencesStore((s) => s.setPreference);

  const [open, setOpen] = useState(false);

  const disabled = !currentSessionId;
  const effective: EffortLevel | null =
    pref?.effort ?? projectPref?.effort ?? null;
  // 未設定 (null) 時は medium (index 1) を表示上の既定とする（従来互換）
  const meta =
    EFFORT_CHOICES.find((e) => e.id === effective) ?? EFFORT_CHOICES[1];

  function handleSelect(id: EffortLevel) {
    if (!currentSessionId) return;
    setOpen(false);
    if (id === effective) return;
    const owningProjectId =
      useSessionStore
        .getState()
        .sessions.find((s) => s.id === currentSessionId)?.projectId ??
      activeProjectId;
    setPreference(currentSessionId, owningProjectId ?? null, { effort: id });
  }

  if (disabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex h-7 shrink-0 cursor-default items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 text-[11px] text-muted-foreground opacity-60"
              aria-label="推論工数（セッション未選択）"
            >
              <Gauge className="h-3 w-3" aria-hidden />
              <span>E:</span>
              <span className="tabular-nums">—</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            セッションを選択すると推論工数を切替できます
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`推論工数: ${meta.label}`}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 text-[11px] transition",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open && "bg-muted",
          )}
        >
          <Gauge
            className={cn("h-3 w-3", effortIconColor(meta.id))}
            aria-hidden
          />
          <span className="text-[10px] text-muted-foreground">E:</span>
          <span className="hidden font-medium text-foreground/80 md:inline">
            {meta.label}
          </span>
          <span className="sr-only md:hidden">{meta.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
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
            推論工数（セッション別）
          </div>
          {EFFORT_CHOICES.map((e) => {
            const selected = e.id === effective;
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleSelect(e.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/70 text-foreground/90",
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
