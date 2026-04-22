/**
 * PM-949 (v1.2): Monaco Editor の theme を app theme preset + light/dark に同期する。
 *
 * ## 背景
 * `FileEditor.tsx` / `FilePreviewDialog.tsx` は `resolvedTheme` を見て `"vs-dark"`
 * / `"vs-light"` を渡していたが、`"vs-light"` は Monaco のビルトイン theme 名として
 * 存在しない（正しくは `"vs"`）。結果として light モードでは Monaco 側は既定の
 * `"vs"` theme にフォールバックしており、theme 切替時に "同期しているつもりで同期
 * していない" 状態だった。
 *
 * ## 方針
 * - ビルトイン `"vs"` / `"vs-dark"` を base に、app preset (Tokyo Night /
 *   Catppuccin / Dracula / Nord / Orange) の HSL から派生した最小上書き theme
 *   を `monaco.editor.defineTheme()` で登録し、background / foreground /
 *   selection / lineHighlight が app UI とほぼ違和感なく揃うようにする。
 * - `"vs"` / `"vs-dark"` はビルトインなのでそのまま使い、orange light のときに
 *   限り素の `"vs"` を採用（orange light は shadcn 既定と同色なので追加登録不要）。
 * - theme 登録は idempotent（同 id で何度呼んでも OK）なので、`ensure...` 関数で
 *   lazy 登録する。HMR / 複数 Monaco instance の前提でも安全。
 *
 * ## 使い方
 * ```ts
 * import { resolveMonacoTheme, registerMonacoThemes } from "@/lib/monaco-theme";
 *
 * // onMount で一度登録
 * void import("monaco-editor").then((monaco) => registerMonacoThemes(monaco));
 * // 毎 render で名前を解決して <SafeMonacoEditor theme={...} />
 * const theme = resolveMonacoTheme(themePreset, mode);
 * ```
 */

import type * as MonacoNs from "monaco-editor";

import type { ThemePreset } from "@/lib/types";

/** Monaco theme の resolved mode（app theme と一致）。 */
export type MonacoThemeMode = "light" | "dark";

/**
 * app preset + mode → Monaco theme 名。
 *
 * - orange (light / dark) はビルトイン `"vs"` / `"vs-dark"` をそのまま返す
 *   （shadcn 既定と色味が十分揃っているため）。
 * - dark-only preset（tokyo-night / catppuccin / dracula / nord）は dark 時のみ
 *   custom theme を返し、light 時は素の `"vs"` にフォールバックする
 *   （`AppearanceInit` が dark-only preset 選択時に next-themes を dark へ強制
 *   するため、実運用で light にはならない想定）。
 */
export function resolveMonacoTheme(
  preset: ThemePreset,
  mode: MonacoThemeMode
): string {
  if (mode === "light") {
    // dark-only preset を light で見るケースは AppearanceInit が避ける想定。
    // 万一来ても素の vs に落とす方が読みやすい。
    return "vs";
  }
  switch (preset) {
    case "tokyo-night":
      return "ccmux-tokyo-night";
    case "catppuccin":
      return "ccmux-catppuccin";
    case "dracula":
      return "ccmux-dracula";
    case "nord":
      return "ccmux-nord";
    case "orange":
    default:
      return "vs-dark";
  }
}

// -----------------------------------------------------------------------------
// Custom theme 定義（dark-only preset のみ）
// -----------------------------------------------------------------------------
//
// 下記色は `lib/theme-presets.ts` の HSL を hex に手動変換したもの。
// Monaco の `defineTheme()` は hex `#RRGGBB` を要求するため文字列で持たせる。
// app UI と完全一致ではなく、Monaco 側で読みやすさ優先に lightness を微調整。
//
// キー対応:
//   background       <- preset.background（editor 背景）
//   foreground       <- preset.foreground（文字色）
//   editorLineNumber <- mutedForeground の弱め
//   editorCursor     <- primary
//   selection        <- primary の薄版（透明度 30%）
//   lineHighlight    <- secondary の薄版

interface CustomThemeColors {
  id: string;
  base: "vs-dark";
  background: string;
  foreground: string;
  lineNumber: string;
  lineNumberActive: string;
  cursor: string;
  selection: string;
  selectionHighlight: string;
  lineHighlight: string;
  indentGuide: string;
}

const TOKYO_NIGHT: CustomThemeColors = {
  id: "ccmux-tokyo-night",
  base: "vs-dark",
  background: "#24283b",
  foreground: "#c0caf5",
  lineNumber: "#565f89",
  lineNumberActive: "#a9b1d6",
  cursor: "#7aa2f7",
  selection: "#364a82",
  selectionHighlight: "#364a8255",
  lineHighlight: "#2e3450",
  indentGuide: "#363b54",
};

const CATPPUCCIN: CustomThemeColors = {
  id: "ccmux-catppuccin",
  base: "vs-dark",
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  lineNumber: "#6c7086",
  lineNumberActive: "#bac2de",
  cursor: "#f5c2e7",
  selection: "#585b70",
  selectionHighlight: "#585b7055",
  lineHighlight: "#313244",
  indentGuide: "#45475a",
};

const DRACULA: CustomThemeColors = {
  id: "ccmux-dracula",
  base: "vs-dark",
  background: "#282a36",
  foreground: "#f8f8f2",
  lineNumber: "#6272a4",
  lineNumberActive: "#bdbdbd",
  cursor: "#50fa7b",
  selection: "#44475a",
  selectionHighlight: "#44475a99",
  lineHighlight: "#343746",
  indentGuide: "#3b3d4c",
};

const NORD: CustomThemeColors = {
  id: "ccmux-nord",
  base: "vs-dark",
  background: "#2e3440",
  foreground: "#eceff4",
  lineNumber: "#4c566a",
  lineNumberActive: "#d8dee9",
  cursor: "#88c0d0",
  selection: "#434c5e",
  selectionHighlight: "#434c5e88",
  lineHighlight: "#3b4252",
  indentGuide: "#434c5e",
};

const CUSTOM_THEMES: readonly CustomThemeColors[] = [
  TOKYO_NIGHT,
  CATPPUCCIN,
  DRACULA,
  NORD,
];

/**
 * Monaco namespace を受け取って custom theme をまとめて登録する。
 *
 * `monaco.editor.defineTheme` は同 id で再定義可能（内部で Map 更新）なので、
 * 複数回呼ばれても安全。
 */
export function registerMonacoThemes(monaco: typeof MonacoNs): void {
  for (const t of CUSTOM_THEMES) {
    monaco.editor.defineTheme(t.id, {
      base: t.base,
      inherit: true,
      rules: [],
      colors: {
        "editor.background": t.background,
        "editor.foreground": t.foreground,
        "editorLineNumber.foreground": t.lineNumber,
        "editorLineNumber.activeForeground": t.lineNumberActive,
        "editorCursor.foreground": t.cursor,
        "editor.selectionBackground": t.selection,
        "editor.inactiveSelectionBackground": t.selectionHighlight,
        "editor.lineHighlightBackground": t.lineHighlight,
        "editorIndentGuide.background1": t.indentGuide,
      },
    });
  }
}
