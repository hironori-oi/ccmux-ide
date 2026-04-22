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
 * `readPersistedAppearance()` で `localStorage["sumi:settings"]` から
 * 保存済み設定を同期読み出し、AppearanceSettings の `useEffect` 初回と
 * onChange の両方で `applyAccent` / `applyThemePreset` を呼ぶ構成。
 * DEC-054: 旧 `ccmux-ide-gui:settings` から fallback 読みして transparent migrate する。
 * settings ページに入った瞬間に DOM が同期されるため、別ページから戻った
 * 場合も `next-themes` の mode 変更を受けて再適用する（AppearanceSettings
 * 側で `resolvedTheme` を dep に入れる）。
 */

import { convertFileSrc } from "@tauri-apps/api/core";

import {
  ACCENT_DEFINITIONS,
  THEME_PRESETS,
  type AccentVariables,
  type ThemePresetVariables,
} from "@/lib/theme-presets";
import {
  DEFAULT_BACKGROUND_IMAGE,
  type AccentColor,
  type AppSettings,
  type BackgroundImageSettings,
  type ThemePreset,
} from "@/lib/types";

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
 * localStorage から zustand 永続化キー `sumi:settings` を同期読み出し。
 *
 * 失敗時（未保存 / 破損 / SSR）は `null` を返す。AppearanceSettings の
 * useEffect 初回マウント時に呼び、見つかれば applyThemePreset + applyAccent を
 * 即時実行する。
 *
 * DEC-054: 新 key 未存在時は旧 `ccmux-ide-gui:settings` を fallback で読む
 * （transparent migration は settings store 側の safeStorage が処理する）。
 *
 * Round E2: 背景画像（backgroundImage）も返す。旧バージョン（v2 以前）で
 * 未設定の場合は `DEFAULT_BACKGROUND_IMAGE` を返す。
 * PM-951: UI 共通フォントサイズ（fontSize, 12〜16 の整数 px）も返す。
 */
export function readPersistedAppearance():
  | Pick<
      AppSettings["appearance"],
      "accentColor" | "themePreset" | "backgroundImage" | "fontSize"
    >
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem("sumi:settings") ??
      window.localStorage.getItem("ccmux-ide-gui:settings");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { settings?: AppSettings };
    };
    const ap = parsed.state?.settings?.appearance;
    if (!ap) return null;
    return {
      accentColor: ap.accentColor ?? "orange",
      themePreset: ap.themePreset ?? "orange",
      backgroundImage: ap.backgroundImage ?? DEFAULT_BACKGROUND_IMAGE,
      fontSize: typeof ap.fontSize === "number" ? ap.fontSize : 14,
    };
  } catch {
    return null;
  }
}

/**
 * PM-951: UI 共通フォントサイズを CSS variable `--app-font-size` に反映する。
 *
 * - 値は 12〜16 の整数 px にクランプ（settings store と同じ制約）。
 * - `document.documentElement.style.setProperty("--app-font-size", "14px")`
 *   を設定し、Chat / Editor / Terminal など各 pane が CSS variable 経由で
 *   参照する。直接 `html { font-size }` を変えると Tailwind の rem 計算
 *   （text-sm / p-3 等）がすべてスケールして他の UI レイアウトにも影響する
 *   ため、スコープ限定の CSS variable 方式を採用する（VSCode の
 *   "Editor Font Size" / "Terminal Font Size" と同等の UX）。
 * - Monaco Editor / xterm.js は px 単位の options を直接受け取るため、
 *   参照側で `useSettingsStore` から数値を subscribe して options に渡す
 *   （本関数は Chat 等の DOM / CSS 系コンポーネント向け）。
 */
export function applyFontSize(px: number): void {
  if (typeof document === "undefined") return;
  const clamped = Math.max(12, Math.min(16, Math.round(px)));
  document.documentElement.style.setProperty(
    "--app-font-size",
    `${clamped}px`
  );
}

/**
 * Round E2: 背景画像設定を DOM へ反映する。
 *
 * `app/globals.css` で定義した CSS variable（`--ccmux-bg-*`）を
 * `document.documentElement` に直接書き込み、html::before / html::after が
 * それを参照する形で画像 + オーバーレイを描画する（body bg は transparent 化済み）。
 *
 * - `settings.path` が null の場合は画像を非表示（`--ccmux-bg-image: none`）、
 *   オーバーレイは完全不透明に戻す（`--ccmux-bg-overlay: 1`）。
 * - path は `convertFileSrc` で asset:// URL に変換してから CSS url() に
 *   埋め込む。Windows パスやスペースを含む場合に備え、url() 内は二重引用符。
 * - `fit === "tile"` のみ `background-size: auto` + `background-repeat: repeat`
 *   を採用。それ以外は cover / contain / center（center は "auto"）。
 */
export function applyBackground(settings: BackgroundImageSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (!settings.path) {
    // 画像なし: 既存 bg-background を維持（overlay=1 で画像層が見えてもフル透過）
    root.style.setProperty("--ccmux-bg-image", "none");
    root.style.setProperty("--ccmux-bg-opacity", "0");
    root.style.setProperty("--ccmux-bg-blur", "0px");
    root.style.setProperty("--ccmux-bg-overlay", "1");
    root.style.setProperty("--ccmux-bg-size", "cover");
    root.style.setProperty("--ccmux-bg-repeat", "no-repeat");
    return;
  }

  let url: string;
  try {
    url = convertFileSrc(settings.path);
  } catch {
    // 変換失敗（SSR / 未 Tauri 環境）は no-op
    return;
  }

  // fit → background-size / background-repeat の対応
  let sizeRule = "cover";
  let repeatRule = "no-repeat";
  switch (settings.fit) {
    case "cover":
      sizeRule = "cover";
      repeatRule = "no-repeat";
      break;
    case "contain":
      sizeRule = "contain";
      repeatRule = "no-repeat";
      break;
    case "tile":
      sizeRule = "auto";
      repeatRule = "repeat";
      break;
    case "center":
      sizeRule = "auto";
      repeatRule = "no-repeat";
      break;
  }

  // url() の中身はダブルクォート。CSS の仕様上、URL 内の " は稀だが
  // encodeURI 済みなのでそのまま安全。
  root.style.setProperty("--ccmux-bg-image", `url("${url}")`);
  root.style.setProperty("--ccmux-bg-opacity", String(settings.opacity));
  root.style.setProperty("--ccmux-bg-blur", `${settings.blur}px`);
  root.style.setProperty("--ccmux-bg-overlay", String(settings.overlayOpacity));
  root.style.setProperty("--ccmux-bg-size", sizeRule);
  root.style.setProperty("--ccmux-bg-repeat", repeatRule);
}
