"use client";

import { useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";

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
import { useDialogStore } from "@/lib/stores/dialog";
import { useSessionStore } from "@/lib/stores/session";
import {
  selectSessionPreferences,
  useSessionPreferencesStore,
} from "@/lib/stores/session-preferences";
import { MODEL_CHOICES, type ModelId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.9.0 (DEC-053): TrayBar 用 **セッション別モデル picker**。
 *
 * - 選択値は session-preferences store (`perSession[sessionId].model`) に保存
 * - session 未選択時は disabled + `—` 表示
 * - model 未設定時は dialog store の global default を fallback として表示
 * - 値変更は per-query で sidecar に反映される（`send_agent_prompt` options）。
 *   argv 再起動は行わない（DEC-053）
 */
export function TrayModelPicker() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const pref = useSessionPreferencesStore((s) =>
    selectSessionPreferences(s, currentSessionId),
  );
  const setPreference = useSessionPreferencesStore((s) => s.setPreference);

  const dialogModel = useDialogStore((s) => s.selectedModel);

  const [open, setOpen] = useState(false);

  const disabled = !currentSessionId;
  const effective: ModelId = pref?.model ?? dialogModel;
  const meta =
    MODEL_CHOICES.find((m) => m.id === effective) ?? MODEL_CHOICES[0];

  function handleSelect(id: ModelId) {
    if (!currentSessionId) return;
    setOpen(false);
    if (id === effective) return;
    setPreference(currentSessionId, { model: id });
  }

  if (disabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex h-7 shrink-0 cursor-default items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 text-[11px] text-muted-foreground opacity-60"
              aria-label="モデル（セッション未選択）"
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              <span>M:</span>
              <span className="tabular-nums">—</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            セッションを選択するとモデルを切替できます
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
          aria-label={`モデル: ${meta.label}`}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 text-[11px] transition",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open && "bg-muted",
          )}
        >
          <Sparkles className="h-3 w-3 text-primary" aria-hidden />
          <span className="text-[10px] text-muted-foreground">M:</span>
          <span className="hidden tabular-nums font-medium text-foreground/80 md:inline">
            {shortLabel(meta.label)}
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
        aria-label="モデル選択"
      >
        <div
          role="radiogroup"
          aria-label="Claude モデル"
          className="flex flex-col gap-0.5"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            モデル（セッション別）
          </div>
          {MODEL_CHOICES.map((m) => {
            const selected = m.id === effective;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleSelect(m.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/70 text-foreground/90",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{m.label}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                  )}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** `Opus 4.7 (1M)` → `Opus4.7` 相当の超短縮（TrayBar 幅節約）。 */
function shortLabel(label: string): string {
  return label.replace(/\s+\(1M\)$/, "").replace(/\s/g, "");
}
