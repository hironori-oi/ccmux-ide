/**
 * Week 7 Chunk 2 / PM-251: テーマプリセット定数定義。
 *
 * - 各プリセットは shadcn neutral ベースを維持したまま、
 *   `--background` / `--foreground` / `--primary` / `--accent` / `--muted` などの
 *   CSS variable を上書きして全体の雰囲気を変える。
 * - `orange` のみ light / dark 両方を定義（既存 `app/globals.css` と互換）。
 * - `tokyo-night` / `catppuccin` / `dracula` / `nord` は dark-only。
 *   選択時は呼び出し側で `next-themes.setTheme("dark")` を併せて呼ぶこと。
 *
 * ## HSL 記法
 * Tailwind shadcn preset に合わせ `"H S% L%"` を値とする（`hsl(var(--primary))` で参照）。
 */

import type { AccentColor, ThemePreset } from "@/lib/types";

/** 1 プリセットが保持する CSS variable のキー（最小必要セット）。 */
export interface ThemePresetVariables {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  ring: string;
}

/** 1 プリセット定義（ラベル / デフォルトアクセント / light/dark 変数セット）。 */
export interface ThemePresetDefinition {
  id: ThemePreset;
  label: string;
  /** true の場合、next-themes を `dark` に強制する */
  darkOnly: boolean;
  /** プリセット切替時に追従するアクセントカラー */
  defaultAccent: AccentColor;
  /** dark モード時の CSS 変数一式 */
  dark: ThemePresetVariables;
  /** light モード時（orange のみ実装、他は dark へフォールバック） */
  light?: ThemePresetVariables;
}

// ---------------------------------------------------------------------------
// Orange（Sumi default、既存 app/globals.css と同値）
// ---------------------------------------------------------------------------
const ORANGE_LIGHT: ThemePresetVariables = {
  background: "0 0% 100%",
  foreground: "0 0% 3.9%",
  card: "0 0% 100%",
  cardForeground: "0 0% 3.9%",
  popover: "0 0% 100%",
  popoverForeground: "0 0% 3.9%",
  primary: "18 55% 50%",
  primaryForeground: "0 0% 98%",
  secondary: "0 0% 96.1%",
  secondaryForeground: "0 0% 9%",
  muted: "0 0% 96.1%",
  mutedForeground: "0 0% 45.1%",
  accent: "0 0% 96.1%",
  accentForeground: "0 0% 9%",
  border: "0 0% 89.8%",
  input: "0 0% 89.8%",
  ring: "18 55% 50%",
};

const ORANGE_DARK: ThemePresetVariables = {
  background: "0 0% 3.9%",
  foreground: "0 0% 98%",
  card: "0 0% 3.9%",
  cardForeground: "0 0% 98%",
  popover: "0 0% 3.9%",
  popoverForeground: "0 0% 98%",
  primary: "18 60% 55%",
  primaryForeground: "0 0% 9%",
  secondary: "0 0% 14.9%",
  secondaryForeground: "0 0% 98%",
  muted: "0 0% 14.9%",
  mutedForeground: "0 0% 63.9%",
  accent: "0 0% 14.9%",
  accentForeground: "0 0% 98%",
  border: "0 0% 14.9%",
  input: "0 0% 14.9%",
  ring: "18 60% 55%",
};

// ---------------------------------------------------------------------------
// Tokyo Night Storm
// ---------------------------------------------------------------------------
const TOKYO_NIGHT_DARK: ThemePresetVariables = {
  background: "230 25% 18%",
  foreground: "220 20% 88%",
  card: "230 22% 22%",
  cardForeground: "220 20% 88%",
  popover: "230 25% 18%",
  popoverForeground: "220 20% 88%",
  primary: "203 70% 65%",
  primaryForeground: "230 25% 12%",
  secondary: "230 20% 26%",
  secondaryForeground: "220 20% 88%",
  muted: "230 20% 26%",
  mutedForeground: "220 15% 65%",
  accent: "250 60% 70%",
  accentForeground: "230 25% 12%",
  border: "230 18% 30%",
  input: "230 18% 30%",
  ring: "203 70% 65%",
};

// ---------------------------------------------------------------------------
// Catppuccin Mocha
// ---------------------------------------------------------------------------
const CATPPUCCIN_DARK: ThemePresetVariables = {
  background: "240 23% 9%",
  foreground: "226 64% 88%",
  card: "240 21% 14%",
  cardForeground: "226 64% 88%",
  popover: "240 23% 9%",
  popoverForeground: "226 64% 88%",
  primary: "316 72% 78%",
  primaryForeground: "240 23% 12%",
  secondary: "237 16% 23%",
  secondaryForeground: "226 64% 88%",
  muted: "237 16% 23%",
  mutedForeground: "228 24% 72%",
  accent: "22 96% 72%",
  accentForeground: "240 23% 12%",
  border: "237 16% 28%",
  input: "237 16% 28%",
  ring: "316 72% 78%",
};

// ---------------------------------------------------------------------------
// Dracula
// ---------------------------------------------------------------------------
const DRACULA_DARK: ThemePresetVariables = {
  background: "231 15% 18%",
  foreground: "60 30% 96%",
  card: "232 14% 23%",
  cardForeground: "60 30% 96%",
  popover: "231 15% 18%",
  popoverForeground: "60 30% 96%",
  primary: "135 94% 75%",
  primaryForeground: "231 15% 12%",
  secondary: "232 14% 28%",
  secondaryForeground: "60 30% 96%",
  muted: "232 14% 28%",
  mutedForeground: "225 14% 70%",
  accent: "265 89% 78%",
  accentForeground: "231 15% 12%",
  border: "232 14% 32%",
  input: "232 14% 32%",
  ring: "135 94% 75%",
};

// ---------------------------------------------------------------------------
// Nord
// ---------------------------------------------------------------------------
const NORD_DARK: ThemePresetVariables = {
  background: "220 16% 22%",
  foreground: "218 27% 94%",
  card: "222 16% 28%",
  cardForeground: "218 27% 94%",
  popover: "220 16% 22%",
  popoverForeground: "218 27% 94%",
  primary: "213 32% 73%",
  primaryForeground: "220 16% 16%",
  secondary: "220 17% 32%",
  secondaryForeground: "218 27% 94%",
  muted: "220 17% 32%",
  mutedForeground: "219 28% 78%",
  accent: "179 25% 65%",
  accentForeground: "220 16% 16%",
  border: "220 16% 36%",
  input: "220 16% 36%",
  ring: "213 32% 73%",
};

/** 全プリセット定義（id 順）。 */
export const THEME_PRESETS: Record<ThemePreset, ThemePresetDefinition> = {
  orange: {
    id: "orange",
    label: "Claude Orange",
    darkOnly: false,
    defaultAccent: "orange",
    light: ORANGE_LIGHT,
    dark: ORANGE_DARK,
  },
  "tokyo-night": {
    id: "tokyo-night",
    label: "Tokyo Night Storm",
    darkOnly: true,
    defaultAccent: "blue",
    dark: TOKYO_NIGHT_DARK,
  },
  catppuccin: {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    darkOnly: true,
    defaultAccent: "pink",
    dark: CATPPUCCIN_DARK,
  },
  dracula: {
    id: "dracula",
    label: "Dracula",
    darkOnly: true,
    defaultAccent: "purple",
    dark: DRACULA_DARK,
  },
  nord: {
    id: "nord",
    label: "Nord",
    darkOnly: true,
    defaultAccent: "blue",
    dark: NORD_DARK,
  },
};

// ---------------------------------------------------------------------------
// Accent color HSL 定義（AccentPicker が適用する minimal 上書きセット）
// ---------------------------------------------------------------------------

/** Accent 1 組あたりの HSL（light / dark 別）。 */
export interface AccentVariables {
  /** `--primary` */
  primary: string;
  /** `--primary-foreground` */
  primaryForeground: string;
  /** `--ring` */
  ring: string;
}

export interface AccentDefinition {
  id: AccentColor;
  label: string;
  /** 見本バッジ用 Tailwind class */
  swatchClassName: string;
  /** light モード時の HSL 値 */
  light: AccentVariables;
  /** dark モード時の HSL 値（同 hue、lightness を +5% 目安で明るく） */
  dark: AccentVariables;
}

/**
 * 仕様書指定の 5 プリセット。light/dark は同 hue、lightness のみ +5%。
 */
export const ACCENT_DEFINITIONS: Record<AccentColor, AccentDefinition> = {
  orange: {
    id: "orange",
    label: "Orange",
    swatchClassName: "bg-orange-500",
    light: {
      primary: "18 55% 50%",
      primaryForeground: "0 0% 98%",
      ring: "18 55% 50%",
    },
    dark: {
      primary: "18 60% 55%",
      primaryForeground: "0 0% 9%",
      ring: "18 60% 55%",
    },
  },
  blue: {
    id: "blue",
    label: "Blue",
    swatchClassName: "bg-blue-500",
    light: {
      primary: "210 90% 55%",
      primaryForeground: "0 0% 98%",
      ring: "210 90% 55%",
    },
    dark: {
      primary: "210 90% 60%",
      primaryForeground: "0 0% 9%",
      ring: "210 90% 60%",
    },
  },
  green: {
    id: "green",
    label: "Green",
    swatchClassName: "bg-emerald-500",
    light: {
      primary: "142 60% 45%",
      primaryForeground: "0 0% 98%",
      ring: "142 60% 45%",
    },
    dark: {
      primary: "142 60% 50%",
      primaryForeground: "0 0% 9%",
      ring: "142 60% 50%",
    },
  },
  purple: {
    id: "purple",
    label: "Purple",
    swatchClassName: "bg-purple-500",
    light: {
      primary: "270 70% 55%",
      primaryForeground: "0 0% 98%",
      ring: "270 70% 55%",
    },
    dark: {
      primary: "270 70% 60%",
      primaryForeground: "0 0% 9%",
      ring: "270 70% 60%",
    },
  },
  pink: {
    id: "pink",
    label: "Pink",
    swatchClassName: "bg-pink-500",
    light: {
      primary: "330 75% 60%",
      primaryForeground: "0 0% 98%",
      ring: "330 75% 60%",
    },
    dark: {
      primary: "330 75% 65%",
      primaryForeground: "0 0% 9%",
      ring: "330 75% 65%",
    },
  },
};
