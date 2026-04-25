/**
 * PRJ-012 v1.20.0 (DEC-066) — プロジェクト accentColor の single source。
 *
 * ## 役割
 *  - ProjectRail / ProjectAccentColorPicker などから参照する 19 色プリセット
 *  - `getAccentBgClass` / `getAccentRingClass` / `getAccentTextClass` で
 *    Tailwind class 文字列を返すヘルパ
 *
 * ## Tailwind safelist 対策
 *
 * Tailwind の JIT は動的に組み立てた class (`bg-${color}-500`) を purge する。
 * 本ファイルでは **全色の class 文字列を `ACCENT_CLASS_TABLE` に静的に列挙** し、
 * `content` スキャンで拾えるようにしている (safelist 不要)。
 *
 * 19 色: slate / red / orange / amber / yellow / lime / green / emerald /
 * teal / cyan / sky / blue / indigo / violet / purple / fuchsia / pink /
 * rose / neutral。 `neutral` がデフォルト (accentColor = null)。
 */

/** プリセット 19 色の keyword literal。 */
export type AccentColor =
  | "slate"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose"
  | "neutral";

/** 19 色のプリセット + 日本語ラベル (aria-label / Tooltip 用)。 */
export const ACCENT_COLORS: ReadonlyArray<{
  id: AccentColor;
  label: string;
}> = [
  { id: "neutral", label: "標準 (neutral)" },
  { id: "slate", label: "スレート" },
  { id: "red", label: "レッド" },
  { id: "orange", label: "オレンジ" },
  { id: "amber", label: "アンバー" },
  { id: "yellow", label: "イエロー" },
  { id: "lime", label: "ライム" },
  { id: "green", label: "グリーン" },
  { id: "emerald", label: "エメラルド" },
  { id: "teal", label: "ティール" },
  { id: "cyan", label: "シアン" },
  { id: "sky", label: "スカイ" },
  { id: "blue", label: "ブルー" },
  { id: "indigo", label: "インディゴ" },
  { id: "violet", label: "バイオレット" },
  { id: "purple", label: "パープル" },
  { id: "fuchsia", label: "フーシャ" },
  { id: "pink", label: "ピンク" },
  { id: "rose", label: "ローズ" },
] as const;

interface AccentClassSet {
  /** アイコン背景 (ProjectRail item の main bg) */
  bg: string;
  /** アイコン上の text 色 */
  text: string;
  /** ring overlay 用 (active / status=thinking 等で使用) */
  ring: string;
  /** chip picker で使う plain 色 (dot) */
  chipBg: string;
}

/**
 * 各色ごとの Tailwind class 文字列を **静的に列挙**。
 *
 * JIT purge の対象外にするため、`bg-${color}-500` のような template literal
 * は避けて、ファイル内に literal として全て書き下す。
 */
const ACCENT_CLASS_TABLE: Record<AccentColor, AccentClassSet> = {
  neutral: {
    bg: "bg-neutral-200 dark:bg-neutral-700",
    text: "text-neutral-800 dark:text-neutral-100",
    ring: "ring-neutral-400 dark:ring-neutral-300",
    chipBg: "bg-neutral-400 dark:bg-neutral-500",
  },
  slate: {
    bg: "bg-slate-500/25 dark:bg-slate-500/35",
    text: "text-slate-700 dark:text-slate-200",
    ring: "ring-slate-500 dark:ring-slate-300",
    chipBg: "bg-slate-500 dark:bg-slate-400",
  },
  red: {
    bg: "bg-red-500/25 dark:bg-red-500/35",
    text: "text-red-700 dark:text-red-200",
    ring: "ring-red-500 dark:ring-red-300",
    chipBg: "bg-red-500 dark:bg-red-400",
  },
  orange: {
    bg: "bg-orange-500/25 dark:bg-orange-500/35",
    text: "text-orange-700 dark:text-orange-200",
    ring: "ring-orange-500 dark:ring-orange-300",
    chipBg: "bg-orange-500 dark:bg-orange-400",
  },
  amber: {
    bg: "bg-amber-500/25 dark:bg-amber-500/35",
    text: "text-amber-700 dark:text-amber-200",
    ring: "ring-amber-500 dark:ring-amber-300",
    chipBg: "bg-amber-500 dark:bg-amber-400",
  },
  yellow: {
    bg: "bg-yellow-500/25 dark:bg-yellow-500/35",
    text: "text-yellow-800 dark:text-yellow-200",
    ring: "ring-yellow-500 dark:ring-yellow-300",
    chipBg: "bg-yellow-500 dark:bg-yellow-400",
  },
  lime: {
    bg: "bg-lime-500/25 dark:bg-lime-500/35",
    text: "text-lime-800 dark:text-lime-200",
    ring: "ring-lime-500 dark:ring-lime-300",
    chipBg: "bg-lime-500 dark:bg-lime-400",
  },
  green: {
    bg: "bg-green-500/25 dark:bg-green-500/35",
    text: "text-green-700 dark:text-green-200",
    ring: "ring-green-500 dark:ring-green-300",
    chipBg: "bg-green-500 dark:bg-green-400",
  },
  emerald: {
    bg: "bg-emerald-500/25 dark:bg-emerald-500/35",
    text: "text-emerald-700 dark:text-emerald-200",
    ring: "ring-emerald-500 dark:ring-emerald-300",
    chipBg: "bg-emerald-500 dark:bg-emerald-400",
  },
  teal: {
    bg: "bg-teal-500/25 dark:bg-teal-500/35",
    text: "text-teal-700 dark:text-teal-200",
    ring: "ring-teal-500 dark:ring-teal-300",
    chipBg: "bg-teal-500 dark:bg-teal-400",
  },
  cyan: {
    bg: "bg-cyan-500/25 dark:bg-cyan-500/35",
    text: "text-cyan-700 dark:text-cyan-200",
    ring: "ring-cyan-500 dark:ring-cyan-300",
    chipBg: "bg-cyan-500 dark:bg-cyan-400",
  },
  sky: {
    bg: "bg-sky-500/25 dark:bg-sky-500/35",
    text: "text-sky-700 dark:text-sky-200",
    ring: "ring-sky-500 dark:ring-sky-300",
    chipBg: "bg-sky-500 dark:bg-sky-400",
  },
  blue: {
    bg: "bg-blue-500/25 dark:bg-blue-500/35",
    text: "text-blue-700 dark:text-blue-200",
    ring: "ring-blue-500 dark:ring-blue-300",
    chipBg: "bg-blue-500 dark:bg-blue-400",
  },
  indigo: {
    bg: "bg-indigo-500/25 dark:bg-indigo-500/35",
    text: "text-indigo-700 dark:text-indigo-200",
    ring: "ring-indigo-500 dark:ring-indigo-300",
    chipBg: "bg-indigo-500 dark:bg-indigo-400",
  },
  violet: {
    bg: "bg-violet-500/25 dark:bg-violet-500/35",
    text: "text-violet-700 dark:text-violet-200",
    ring: "ring-violet-500 dark:ring-violet-300",
    chipBg: "bg-violet-500 dark:bg-violet-400",
  },
  purple: {
    bg: "bg-purple-500/25 dark:bg-purple-500/35",
    text: "text-purple-700 dark:text-purple-200",
    ring: "ring-purple-500 dark:ring-purple-300",
    chipBg: "bg-purple-500 dark:bg-purple-400",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/25 dark:bg-fuchsia-500/35",
    text: "text-fuchsia-700 dark:text-fuchsia-200",
    ring: "ring-fuchsia-500 dark:ring-fuchsia-300",
    chipBg: "bg-fuchsia-500 dark:bg-fuchsia-400",
  },
  pink: {
    bg: "bg-pink-500/25 dark:bg-pink-500/35",
    text: "text-pink-700 dark:text-pink-200",
    ring: "ring-pink-500 dark:ring-pink-300",
    chipBg: "bg-pink-500 dark:bg-pink-400",
  },
  rose: {
    bg: "bg-rose-500/25 dark:bg-rose-500/35",
    text: "text-rose-700 dark:text-rose-200",
    ring: "ring-rose-500 dark:ring-rose-300",
    chipBg: "bg-rose-500 dark:bg-rose-400",
  },
};

/** 正規化: 未指定 / 不正値は neutral に倒す。 */
export function normalizeAccentColor(
  color: AccentColor | string | null | undefined
): AccentColor {
  if (!color) return "neutral";
  if ((ACCENT_CLASS_TABLE as Record<string, unknown>)[color] !== undefined) {
    return color as AccentColor;
  }
  return "neutral";
}

/** アイコン背景の Tailwind class。 */
export function getAccentBgClass(
  color: AccentColor | string | null | undefined
): string {
  return ACCENT_CLASS_TABLE[normalizeAccentColor(color)].bg;
}

/** アイコン前景 (文字色) の Tailwind class。 */
export function getAccentTextClass(
  color: AccentColor | string | null | undefined
): string {
  return ACCENT_CLASS_TABLE[normalizeAccentColor(color)].text;
}

/** ring overlay 用 Tailwind class (thinking/streaming 状態で重ねる)。 */
export function getAccentRingClass(
  color: AccentColor | string | null | undefined
): string {
  return ACCENT_CLASS_TABLE[normalizeAccentColor(color)].ring;
}

/** chip picker で使う 1 色ドットの Tailwind class。 */
export function getAccentChipBgClass(
  color: AccentColor | string | null | undefined
): string {
  return ACCENT_CLASS_TABLE[normalizeAccentColor(color)].chipBg;
}

/**
 * v1.25.0: chip swatch の明度に応じた前景色クラスを返す。
 *
 * `getAccentChipBgClass` は `bg-{color}-500 dark:bg-{color}-400` を返す前提なので、
 * 500/400 の明度に応じて Check アイコンの色を切り替える。
 *
 * - 淡色 (yellow / lime / amber / sky / cyan / neutral): dark text (slate-900)
 * - 濃色 (red / orange / green / blue / indigo / ...): white text
 *
 * Tailwind 公式 palette の L 値ベースで人手分類。
 */
const LIGHT_ACCENTS: ReadonlySet<AccentColor> = new Set<AccentColor>([
  "yellow",
  "lime",
  "amber",
  "sky",
  "cyan",
  "neutral",
]);

export function getAccentChipForegroundClass(
  color: AccentColor | string | null | undefined
): string {
  const c = normalizeAccentColor(color);
  return LIGHT_ACCENTS.has(c)
    ? "text-slate-900 drop-shadow-sm"
    : "text-white drop-shadow";
}

