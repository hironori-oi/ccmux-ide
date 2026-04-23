"use client";

import { useState } from "react";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";

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
import { useSessionStore } from "@/lib/stores/session";
import {
  selectSessionPreferences,
  useSessionPreferencesStore,
} from "@/lib/stores/session-preferences";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_CHOICES,
  type PermissionMode,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.9.0 (DEC-053): TrayBar 用 **セッション別 permission-mode picker**。
 *
 * - 選択値は session-preferences store (`perSession[sessionId].permissionMode`)
 * - session 未選択時は disabled + `—`
 * - 未設定時は `DEFAULT_PERMISSION_MODE = "default"` fallback
 * - 値変更は per-query で `send_agent_prompt` options.permissionMode に反映
 *
 * UX 注意: `bypassPermissions` は全操作自動承認のためリスクが高い。trigger ボタン
 * にはモードごとの色分け（safe=neutral / edits=amber / bypass=red / plan=blue）を
 * 入れて誤選択を抑止する。
 */
export function TrayPermissionModePicker() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const pref = useSessionPreferencesStore((s) =>
    selectSessionPreferences(s, currentSessionId),
  );
  const setPreference = useSessionPreferencesStore((s) => s.setPreference);

  const [open, setOpen] = useState(false);

  const disabled = !currentSessionId;
  const effective: PermissionMode =
    pref?.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const meta =
    PERMISSION_MODE_CHOICES.find((c) => c.value === effective) ??
    PERMISSION_MODE_CHOICES[0];

  function handleSelect(value: PermissionMode) {
    if (!currentSessionId) return;
    setOpen(false);
    if (value === effective) return;
    setPreference(currentSessionId, { permissionMode: value });
  }

  if (disabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex h-7 shrink-0 cursor-default items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 text-[11px] text-muted-foreground opacity-60"
              aria-label="権限モード（セッション未選択）"
            >
              <ShieldCheck className="h-3 w-3" aria-hidden />
              <span>P:</span>
              <span className="tabular-nums">—</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            セッションを選択すると権限モードを切替できます
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
          aria-label={`権限モード: ${meta.label}`}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded border px-2 text-[11px] transition",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            permissionTriggerColor(effective),
            open && "bg-muted",
          )}
        >
          <ShieldCheck
            className={cn("h-3 w-3", permissionIconColor(effective))}
            aria-hidden
          />
          <span className="text-[10px] text-muted-foreground">P:</span>
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
        aria-label="権限モード選択"
      >
        <div
          role="radiogroup"
          aria-label="権限モード"
          className="flex flex-col gap-0.5"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            権限モード（セッション別）
          </div>
          {PERMISSION_MODE_CHOICES.map((c) => {
            const selected = c.value === effective;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleSelect(c.value)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/70 text-foreground/90",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{c.label}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                  )}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {c.description}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** trigger の枠線色（bypass は注意喚起のため赤寄り）。 */
function permissionTriggerColor(mode: PermissionMode): string {
  switch (mode) {
    case "bypassPermissions":
      return "border-red-500/50 bg-red-500/5";
    case "acceptEdits":
      return "border-amber-500/40 bg-amber-500/5";
    case "plan":
      return "border-sky-500/40 bg-sky-500/5";
    case "default":
    default:
      return "border-border/40 bg-muted/20";
  }
}

function permissionIconColor(mode: PermissionMode): string {
  switch (mode) {
    case "bypassPermissions":
      return "text-red-500 dark:text-red-400";
    case "acceptEdits":
      return "text-amber-500 dark:text-amber-400";
    case "plan":
      return "text-sky-500 dark:text-sky-400";
    case "default":
    default:
      return "text-emerald-500 dark:text-emerald-400";
  }
}
