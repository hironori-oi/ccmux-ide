"use client";

import { Check } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ACCENT_COLORS,
  getAccentChipBgClass,
  normalizeAccentColor,
  type AccentColor,
} from "@/lib/utils/project-colors";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.20.0 (DEC-066) — プロジェクトの accentColor を選択する Popover。
 *
 * 19 色プリセットの chip grid を表示し、クリックで即適用する。選択中の色には
 * Check アイコン overlay を表示する。
 *
 * 呼出側 (ProjectRail item の右クリックメニュー) が `<Popover>` の open 状態を
 * 管理し、本 component は trigger / content だけ担当する。
 */
export interface ProjectAccentColorPickerProps {
  /** 現在の accentColor (null / undefined = neutral)。 */
  value: string | null | undefined;
  /** 色選択時のコールバック。 */
  onChange: (color: AccentColor) => void;
  /** Popover の open 状態を親で管理する。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** trigger となる要素 (通常は非表示の 0-size span)。 */
  trigger: React.ReactNode;
  /** popover の表示位置 (default: right) */
  side?: "top" | "right" | "bottom" | "left";
}

export function ProjectAccentColorPicker({
  value,
  onChange,
  open,
  onOpenChange,
  trigger,
  side = "right",
}: ProjectAccentColorPickerProps) {
  const current = normalizeAccentColor(value);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="w-auto max-w-[220px] p-3"
      >
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
          プロジェクトの色
        </div>
        <div
          role="radiogroup"
          aria-label="プロジェクトの色を選択"
          className="grid grid-cols-5 gap-1.5"
        >
          {ACCENT_COLORS.map((c) => {
            const selected = current === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={c.label}
                title={c.label}
                onClick={() => {
                  onChange(c.id);
                  onOpenChange(false);
                }}
                className={cn(
                  "relative flex h-7 w-7 items-center justify-center rounded-md transition",
                  "hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 hover:ring-offset-background",
                  getAccentChipBgClass(c.id),
                  selected &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-background"
                )}
              >
                {selected && (
                  <Check
                    className="h-3.5 w-3.5 text-white drop-shadow"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
