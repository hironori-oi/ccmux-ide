"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";
import type { AccentColor, ThemeMode } from "@/lib/types";

/**
 * Week 6 Chunk 3 / PM-211: Appearance 設定。
 *
 * - テーマ切替 (Light / Dark / System): next-themes の `setTheme` と連動
 * - アクセントカラー: 5 プリセット（state 保存のみ、実際の CSS 変数切替は M3 PM-250/251）
 * - フォントサイズ: 12〜16px（range 入力、shadcn Slider 未導入のため native input）
 */
const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
  { value: "system", label: "システム", icon: Monitor },
];

const ACCENT_OPTIONS: { value: AccentColor; label: string; className: string }[] = [
  { value: "orange", label: "Orange", className: "bg-orange-500" },
  { value: "blue", label: "Blue", className: "bg-blue-500" },
  { value: "green", label: "Green", className: "bg-emerald-500" },
  { value: "purple", label: "Purple", className: "bg-purple-500" },
  { value: "pink", label: "Pink", className: "bg-pink-500" },
];

export function AppearanceSettings() {
  const { setTheme, theme: currentTheme } = useTheme();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  // store の theme と next-themes を同期（起動直後のみ store → next-themes に流す）
  useEffect(() => {
    if (appearance.theme && appearance.theme !== currentTheme) {
      setTheme(appearance.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleThemeChange = (value: ThemeMode) => {
    setAppearance({ theme: value });
    setTheme(value);
  };

  return (
    <div className="space-y-6">
      {/* テーマ */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">テーマ</h3>
          <p className="text-xs text-muted-foreground">
            ライト / ダーク / システム設定に従う から選択します。
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="テーマ"
          className="flex flex-wrap gap-2"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = appearance.theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleThemeChange(value)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* アクセントカラー */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">アクセントカラー</h3>
          <p className="text-xs text-muted-foreground">
            UI のハイライトカラー。値は保存されますが、実際の反映は M3 リリース
            以降（再起動で有効化）。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map(({ value, label, className }) => {
            const selected = appearance.accentColor === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAppearance({ accentColor: value })}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition",
                  selected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border hover:bg-muted/40"
                )}
              >
                <span
                  className={cn("h-3 w-3 rounded-full", className)}
                  aria-hidden
                />
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* フォントサイズ */}
      <Card className="space-y-3 p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">フォントサイズ</h3>
            <p className="text-xs text-muted-foreground">
              ベースフォントサイズ（12〜16px、既定 14px）。
            </p>
          </div>
          <div className="font-mono text-sm tabular-nums">
            {appearance.fontSize}px
          </div>
        </div>
        <input
          type="range"
          min={12}
          max={16}
          step={1}
          value={appearance.fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="フォントサイズ"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>12</span>
          <span>13</span>
          <span>14</span>
          <span>15</span>
          <span>16</span>
        </div>
      </Card>

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useSettingsStore.getState().resetSettings()}
        >
          デフォルトに戻す
        </Button>
      </div>
    </div>
  );
}
