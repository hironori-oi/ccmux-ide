"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Palette, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";
import {
  applyAccent,
  applyThemePreset,
  readPersistedAppearance,
  type ResolvedMode,
} from "@/lib/apply-accent";
import {
  ACCENT_DEFINITIONS,
  THEME_PRESETS,
  type AccentDefinition,
  type ThemePresetDefinition,
} from "@/lib/theme-presets";
import type {
  AccentColor,
  ThemeMode,
  ThemePreset,
} from "@/lib/types";

/**
 * Week 7 Chunk 2 / PM-250 + PM-251: Appearance 設定本実装。
 *
 * - AccentPicker: 5 プリセット（Orange / Blue / Green / Purple / Pink）を CSS
 *   variable `--primary` / `--primary-foreground` / `--ring` に即時反映。
 * - ThemePreset: 5 プリセット（Claude Orange / Tokyo Night Storm / Catppuccin
 *   Mocha / Dracula / Nord）でテーマ全体の CSS variable を上書き。dark-only
 *   プリセット選択時は next-themes を `dark` に切替。
 * - 初期化: マウント時に localStorage から保存値を同期読み出し、即時 DOM 適用。
 * - テーマ mode（light / dark）が変わった時も再適用（dep に resolvedTheme）。
 */

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
  { value: "system", label: "システム", icon: Monitor },
];

export function AppearanceSettings() {
  const { setTheme, theme: currentTheme, resolvedTheme } = useTheme();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const setThemePreset = useSettingsStore((s) => s.setThemePreset);
  const setFontSize = useSettingsStore((s) => s.setFontSize);

  const initializedRef = useRef(false);

  // store の theme と next-themes を同期（起動直後のみ store → next-themes に流す）
  useEffect(() => {
    if (appearance.theme && appearance.theme !== currentTheme) {
      setTheme(appearance.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 初回マウント: localStorage から同期読み出し、即時 DOM 適用 ----------
  //
  // 本来は layout.tsx で apply するのが望ましいが、Week 7 Chunk 2 の制約で
  // layout.tsx を触れないため、AppearanceSettings マウント時に初期適用する。
  // 他ページでテーマ変更が起きるケースは稀（Settings 以外から変更しない前提）
  // のため実用上問題ない。
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const persisted = readPersistedAppearance();
    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    if (persisted) {
      applyThemePreset(persisted.themePreset, mode);
      applyAccent(persisted.accentColor, mode);
    } else {
      applyThemePreset(appearance.themePreset, mode);
      applyAccent(appearance.accentColor, mode);
    }
  }, [appearance.accentColor, appearance.themePreset, resolvedTheme]);

  // --- mode（light/dark）切替時: 現在の accent / preset を再適用 -----------
  useEffect(() => {
    if (!initializedRef.current) return;
    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    applyThemePreset(appearance.themePreset, mode);
    applyAccent(appearance.accentColor, mode);
  }, [resolvedTheme, appearance.themePreset, appearance.accentColor]);

  const handleThemeChange = (value: ThemeMode) => {
    setAppearance({ theme: value });
    setTheme(value);
  };

  const handleAccentChange = (color: AccentColor) => {
    setAccentColor(color);
    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    applyAccent(color, mode);
  };

  const handlePresetChange = (preset: ThemePreset) => {
    const def = THEME_PRESETS[preset];
    setThemePreset(preset);

    // dark-only プリセットは next-themes を dark に強制
    let mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    if (def.darkOnly) {
      setTheme("dark");
      setAppearance({ theme: "dark" });
      mode = "dark";
    }

    // プリセット反映 + アクセントもプリセットの defaultAccent に追従
    applyThemePreset(preset, mode);
    setAccentColor(def.defaultAccent);
    applyAccent(def.defaultAccent, mode);
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

      {/* テーマプリセット（PM-251） */}
      <Card className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Palette className="h-4 w-4" aria-hidden />
              テーマプリセット
            </h3>
            <p className="text-xs text-muted-foreground">
              配色全体を一括切替。ダーク専用プリセットは自動でダークモードに切替わります。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.values(THEME_PRESETS) as ThemePresetDefinition[]).map(
            (def) => {
              const selected = appearance.themePreset === def.id;
              const vars = def.dark;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => handlePresetChange(def.id)}
                  aria-pressed={selected}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition",
                    selected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:bg-muted/40"
                  )}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border/40"
                    style={{
                      backgroundColor: `hsl(${vars.background})`,
                    }}
                    aria-hidden
                  >
                    <div
                      className="h-4 w-4 rounded-full"
                      style={{
                        backgroundColor: `hsl(${vars.primary})`,
                      }}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">
                      {def.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {def.darkOnly ? "Dark only" : "Light / Dark"}
                    </span>
                  </div>
                </button>
              );
            }
          )}
        </div>
      </Card>

      {/* アクセントカラー（PM-250） */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="text-sm font-semibold">アクセントカラー</h3>
          <p className="text-xs text-muted-foreground">
            UI のハイライト色。選択で即時反映されます（primary / ring を上書き）。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.values(ACCENT_DEFINITIONS) as AccentDefinition[]).map(
            (def) => {
              const selected = appearance.accentColor === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => handleAccentChange(def.id)}
                  aria-pressed={selected}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition",
                    selected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:bg-muted/40"
                  )}
                >
                  <span
                    className={cn("h-3 w-3 rounded-full", def.swatchClassName)}
                    aria-hidden
                  />
                  {def.label}
                </button>
              );
            }
          )}
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
          onClick={() => {
            useSettingsStore.getState().resetSettings();
            const mode: ResolvedMode =
              resolvedTheme === "dark" ? "dark" : "light";
            applyThemePreset("orange", mode);
            applyAccent("orange", mode);
          }}
        >
          デフォルトに戻す
        </Button>
      </div>
    </div>
  );
}
