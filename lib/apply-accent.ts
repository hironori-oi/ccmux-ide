/**
 * Week 7 Chunk 2 / PM-250 + PM-251: アクセントカラー / テーマプリセットを
 * document.documentElement に CSS variable として反映するユーティリティ。
 *
 * ## 責務
 * - `applyAccent(color, mode)`: `--primary` / `--primary-foreground` / `--ring`
 *   の 3 変数を上書き。現在の `mode`（"light" | "dark"）に応じた HSL を選択。
 * - `applyThemePreset(preset, mode)`: テーマプリセット全体（background /
 *   foreground / primary / accent / muted / border / input 等）を上書き。
 * - どちらも副作用として `document.documentElement.style.setProperty` を呼ぶ
 *   だけで zustand store や next-themes には依存しない（ユニットで単体利用可）。
 *
 * ## 初期化（layout.tsx / theme-provider.tsx を触らない代替戦略）
 * `readPersistedAppearance()` で `localStorage["ccmux-ide-gui:settings"]` から
 * 保存済み設定を同期読み出し、AppearanceSettings の `useEffect` 初回と
 * onChange の両方で `applyAccent` / `applyThemePreset` を呼ぶ構成。
 * settings ページに入った瞬間に DOM が同期されるため、別ページから戻った
 * 場合も `next-themes` の mode 変更を受けて再適用する（AppearanceSettings
 * 側で `resolvedTheme` を dep に入れる）。
 */

import {
  ACCENT_DEFINITIONS,
  THEME_PRESETS,
  type AccentVariables,
  type ThemePresetVariables,
} from "@/lib/theme-presets";
import type { AccentColor, AppSettings, ThemePreset } from "@/lib/types";

/** `applyAccent` / `applyThemePreset` が参照する現在のモード。 */
export type ResolvedMode = "light" | "dark";

/**
 * アクセントカラーを DOM へ反映する。
 *
 * - mode が `dark` の場合は `ACCENT_DEFINITIONS[color].dark` を採用。
 * - `document` が存在しない SSR / build 時は何もしない（安全な no-op）。
 */
export function applyAccent(color: AccentColor, mode: ResolvedMode): void {
  if (typeof document === "undefined") return;
  const def = ACCENT_DEFINITIONS[color];
  if (!def) return;
  const vars: AccentVariables = mode === "dark" ? def.dark : def.light;
  const root = document.documentElement;
  root.style.setProperty("--primary", vars.primary);
  root.style.setProperty("--primary-foreground", vars.primaryForeground);
  root.style.setProperty("--ring", vars.ring);
}

/**
 * テーマプリセット全体を DOM へ反映する。
 *
 * - `preset.darkOnly` が true かつ mode が `light` の場合は dark 変数を使う
 *   （呼び出し側で `next-themes.setTheme("dark")` を併用する想定だが、競合を
 *    避けて dark を強制適用しておく）。
 * - プリセット切替後は `applyAccent` を再度呼び、preset.defaultAccent の HSL
 *   で primary を上書きすると一貫した見え方になる（呼び出し側の責務）。
 */
export function applyThemePreset(
  preset: ThemePreset,
  mode: ResolvedMode
): void {
  if (typeof document === "undefined") return;
  const def = THEME_PRESETS[preset];
  if (!def) return;
  const effectiveMode: ResolvedMode =
    def.darkOnly || mode === "dark" ? "dark" : "light";
  const vars: ThemePresetVariables | undefined =
    effectiveMode === "dark" ? def.dark : def.light ?? def.dark;
  if (!vars) return;

  const root = document.documentElement;
  root.style.setProperty("--background", vars.background);
  root.style.setProperty("--foreground", vars.foreground);
  root.style.setProperty("--card", vars.card);
  root.style.setProperty("--card-foreground", vars.cardForeground);
  root.style.setProperty("--popover", vars.popover);
  root.style.setProperty("--popover-foreground", vars.popoverForeground);
  root.style.setProperty("--primary", vars.primary);
  root.style.setProperty("--primary-foreground", vars.primaryForeground);
  root.style.setProperty("--secondary", vars.secondary);
  root.style.setProperty("--secondary-foreground", vars.secondaryForeground);
  root.style.setProperty("--muted", vars.muted);
  root.style.setProperty("--muted-foreground", vars.mutedForeground);
  root.style.setProperty("--accent", vars.accent);
  root.style.setProperty("--accent-foreground", vars.accentForeground);
  root.style.setProperty("--border", vars.border);
  root.style.setProperty("--input", vars.input);
  root.style.setProperty("--ring", vars.ring);
}

/**
 * localStorage から zustand 永続化キー `ccmux-ide-gui:settings` を同期読み出し。
 *
 * 失敗時（未保存 / 破損 / SSR）は `null` を返す。AppearanceSettings の
 * useEffect 初回マウント時に呼び、見つかれば applyThemePreset + applyAccent を
 * 即時実行する。
 */
export function readPersistedAppearance():
  | Pick<AppSettings["appearance"], "accentColor" | "themePreset">
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("ccmux-ide-gui:settings");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { settings?: AppSettings };
    };
    const ap = parsed.state?.settings?.appearance;
    if (!ap) return null;
    return {
      accentColor: ap.accentColor ?? "orange",
      themePreset: ap.themePreset ?? "orange",
    };
  } catch {
    return null;
  }
}
