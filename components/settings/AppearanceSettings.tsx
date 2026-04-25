"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Image as ImageIcon,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sun,
} from "lucide-react";

import { AboutSection } from "@/components/settings/AboutSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { triggerManualUpdateCheck } from "@/components/updates/UpdateNotifier";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";
import { useUpdaterStore } from "@/lib/stores/updater";
import {
  applyAccent,
  applyBackground,
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
import { DEFAULT_BACKGROUND_IMAGE } from "@/lib/types";
import type {
  AccentColor,
  BackgroundImageSettings,
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

/** Round E2: 背景画像の表示モード。 */
const FIT_OPTIONS: {
  value: BackgroundImageSettings["fit"];
  label: string;
  description: string;
}[] = [
  { value: "cover", label: "全体", description: "画面全体に拡大（はみ出しトリム）" },
  { value: "contain", label: "含める", description: "アスペクト維持で全体を収める" },
  { value: "tile", label: "繰り返し", description: "元サイズのまま並べる" },
  { value: "center", label: "中央", description: "元サイズで中央配置" },
];

/** 画像ファイル拡張子。@tauri-apps/plugin-dialog::open のフィルタに渡す。 */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

/** 大きい画像の警告閾値（byte）。10 MB 超で警告表示。 */
const LARGE_IMAGE_WARN_BYTES = 10 * 1024 * 1024;

/**
 * v1.25.0: ネイティブ range input の PageUp/PageDown/Home/End 標準対応。
 *
 * Native range は矢印で 1 step 動くが、PageUp/Down は実装依存 (Chromium は
 * 10% 動く / Firefox は 1 step) で揃わない。Home/End は実装している browser も
 * あるが Tauri WebView2 では未対応。
 *
 * このヘルパは onKeyDown に bind して使い、PageUp/PageDown で +10 step / -10 step、
 * Home/End で min/max にジャンプする挙動を提供する。
 *
 * @param current 現在の値 (clamping は呼び出し側で実施済前提)
 * @param min     許容最小値
 * @param max     許容最大値
 * @param step    1 矢印あたりの step 量
 * @param onChange 値変更時のコールバック (内部で min/max clamp される)
 */
function handleSliderKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  current: number,
  min: number,
  max: number,
  step: number,
  onChange: (next: number) => void,
): void {
  let next: number | null = null;
  if (e.key === "PageUp") {
    next = current + step * 10;
  } else if (e.key === "PageDown") {
    next = current - step * 10;
  } else if (e.key === "Home") {
    next = min;
  } else if (e.key === "End") {
    next = max;
  }
  if (next === null) return;
  e.preventDefault();
  const clamped = Math.max(min, Math.min(max, next));
  onChange(clamped);
}

export function AppearanceSettings() {
  const { setTheme, theme: currentTheme, resolvedTheme } = useTheme();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const setThemePreset = useSettingsStore((s) => s.setThemePreset);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setBackgroundImage = useSettingsStore((s) => s.setBackgroundImage);
  const clearBackgroundImage = useSettingsStore((s) => s.clearBackgroundImage);

  // v1.16.0 (DEC-062): 自動更新チェックの ON/OFF と skippedVersions を subscribe
  const autoCheck = useUpdaterStore((s) => s.autoCheck);
  const setAutoCheck = useUpdaterStore((s) => s.setAutoCheck);
  const skippedVersions = useUpdaterStore((s) => s.skippedVersions);

  // 背景画像設定（v2 以前の persisted で未定義の場合に備え fallback）
  const bgImage: BackgroundImageSettings =
    appearance.backgroundImage ?? DEFAULT_BACKGROUND_IMAGE;

  // 選択中画像のファイルサイズ警告メッセージ（null = 警告なし）
  const [bgSizeWarning, setBgSizeWarning] = useState<string | null>(null);

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
      // Round E2: 背景画像も初回同期
      applyBackground(persisted.backgroundImage);
    } else {
      applyThemePreset(appearance.themePreset, mode);
      applyAccent(appearance.accentColor, mode);
      applyBackground(bgImage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance.accentColor, appearance.themePreset, resolvedTheme]);

  // --- mode（light/dark）切替時: 現在の accent / preset を再適用 -----------
  useEffect(() => {
    if (!initializedRef.current) return;
    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    applyThemePreset(appearance.themePreset, mode);
    applyAccent(appearance.accentColor, mode);
  }, [resolvedTheme, appearance.themePreset, appearance.accentColor]);

  // --- Round E2: 背景画像の任意フィールド変更時に即時反映 -----------------
  useEffect(() => {
    if (!initializedRef.current) return;
    applyBackground(bgImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bgImage.path,
    bgImage.opacity,
    bgImage.blur,
    bgImage.fit,
    bgImage.overlayOpacity,
  ]);

  const handleThemeChange = (value: ThemeMode) => {
    setAppearance({ theme: value });
    setTheme(value);
  };

  const handleAccentChange = (color: AccentColor) => {
    setAccentColor(color);
    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    applyAccent(color, mode);
  };

  // ---- Round E2: 背景画像ハンドラ群 -------------------------------------
  const handlePickBackgroundImage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "画像",
            extensions: IMAGE_EXTENSIONS,
          },
        ],
      });
      if (!result || typeof result !== "string") return;
      setBackgroundImage({ path: result });

      // 大きい画像の警告（fs plugin 未導入環境ではスキップ）
      try {
        const { stat } = await import("@tauri-apps/plugin-fs");
        const info = await stat(result);
        if (
          typeof info?.size === "number" &&
          info.size > LARGE_IMAGE_WARN_BYTES
        ) {
          const mb = (info.size / (1024 * 1024)).toFixed(1);
          setBgSizeWarning(
            `選択した画像が大きめです（${mb} MB）。描画性能に影響する可能性があります。`
          );
        } else {
          setBgSizeWarning(null);
        }
      } catch {
        // fs plugin 未導入・アクセス不可の場合は警告を出さない
        setBgSizeWarning(null);
      }
    } catch (err) {
      // ユーザーキャンセル等は silent
      console.warn("[AppearanceSettings] 画像選択に失敗", err);
    }
  };

  const handleFitChange = (fit: BackgroundImageSettings["fit"]) => {
    setBackgroundImage({ fit });
  };

  const handleClearBackgroundImage = () => {
    clearBackgroundImage();
    setBgSizeWarning(null);
  };

  // プレビュー用の URL（path 変更時のみ再計算）
  const previewUrl = useMemo(() => {
    if (!bgImage.path) return null;
    try {
      return convertFileSrc(bgImage.path);
    } catch {
      return null;
    }
  }, [bgImage.path]);

  // プレビュー box の inline style（スライダーとリアルタイム連動）
  const previewImageStyle = useMemo<CSSProperties>(() => {
    if (!previewUrl) return {};
    const fit = bgImage.fit;
    const size = fit === "tile" || fit === "center" ? "auto" : fit;
    const repeat = fit === "tile" ? "repeat" : "no-repeat";
    return {
      backgroundImage: `url("${previewUrl}")`,
      backgroundSize: size,
      backgroundRepeat: repeat,
      backgroundPosition: "center",
      opacity: bgImage.opacity,
      filter: bgImage.blur > 0 ? `blur(${bgImage.blur}px)` : undefined,
    };
  }, [previewUrl, bgImage.fit, bgImage.opacity, bgImage.blur]);

  // 短縮表示: 絶対パスの末尾 2 セグメントのみ
  const shortBgPath = useMemo(() => {
    if (!bgImage.path) return null;
    const parts = bgImage.path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return bgImage.path;
    return `…/${parts.slice(-2).join("/")}`;
  }, [bgImage.path]);

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
          onKeyDown={(e) =>
            handleSliderKeyDown(e, appearance.fontSize, 12, 16, 1, setFontSize)
          }
          className="w-full accent-primary"
          aria-label="フォントサイズ"
        />
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>12</span>
          <span>13</span>
          <span>14</span>
          <span>15</span>
          <span>16</span>
        </div>
      </Card>

      {/* 背景画像（Round E2 / Warp 風） */}
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ImageIcon className="h-4 w-4" aria-hidden />
            背景画像（Warp 風）
          </h3>
          <p className="text-xs text-muted-foreground">
            アプリ全体の背景に画像を表示します。透過度・ぼかし・オーバーレイで読みやすさを調整できます。
          </p>
        </div>

        {/* 画像選択 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePickBackgroundImage}
            className="gap-2"
            title="PC の画像ファイルを選択します"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            画像を選択
          </Button>
          <div
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={bgImage.path ?? "背景画像は設定されていません"}
          >
            {shortBgPath ? (
              <>
                現在: <span className="font-mono">{shortBgPath}</span>
              </>
            ) : (
              "背景画像なし"
            )}
          </div>
        </div>

        {bgSizeWarning && (
          <p
            role="status"
            className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-700 dark:text-yellow-300"
          >
            {bgSizeWarning}
          </p>
        )}

        {/* 表示モード */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            表示モード
          </div>
          <div
            role="radiogroup"
            aria-label="背景画像の表示モード"
            className="flex flex-wrap gap-2"
          >
            {FIT_OPTIONS.map((opt) => {
              const selected = bgImage.fit === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-pressed={selected}
                  title={opt.description}
                  disabled={!bgImage.path}
                  onClick={() => handleFitChange(opt.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border hover:bg-muted/40",
                    !bgImage.path && "cursor-not-allowed opacity-50"
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* スライダー 3 本 */}
        <div className="space-y-3">
          {/* 画像の濃さ (opacity) */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label
                htmlFor="bg-opacity"
                className="text-xs font-medium text-muted-foreground"
                title="背景画像の不透明度。値が高いほど画像がはっきり見えます。"
              >
                画像の濃さ
              </label>
              <span className="font-mono text-xs tabular-nums">
                {Math.round(bgImage.opacity * 100)}%
              </span>
            </div>
            <input
              id="bg-opacity"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!bgImage.path}
              value={Math.round(bgImage.opacity * 100)}
              onChange={(e) =>
                setBackgroundImage({ opacity: Number(e.target.value) / 100 })
              }
              onKeyDown={(e) =>
                handleSliderKeyDown(
                  e,
                  Math.round(bgImage.opacity * 100),
                  0,
                  100,
                  1,
                  (v) => setBackgroundImage({ opacity: v / 100 }),
                )
              }
              className="w-full accent-primary disabled:opacity-50"
              aria-label="背景画像の濃さ"
            />
          </div>

          {/* ぼかし (blur) */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label
                htmlFor="bg-blur"
                className="text-xs font-medium text-muted-foreground"
                title="背景画像にぼかしをかけます。値が大きいほどぼんやりします。"
              >
                ぼかし
              </label>
              <span className="font-mono text-xs tabular-nums">
                {bgImage.blur}px
              </span>
            </div>
            <input
              id="bg-blur"
              type="range"
              min={0}
              max={20}
              step={1}
              disabled={!bgImage.path}
              value={bgImage.blur}
              onChange={(e) =>
                setBackgroundImage({ blur: Number(e.target.value) })
              }
              onKeyDown={(e) =>
                handleSliderKeyDown(e, bgImage.blur, 0, 20, 1, (v) =>
                  setBackgroundImage({ blur: v }),
                )
              }
              className="w-full accent-primary disabled:opacity-50"
              aria-label="背景画像のぼかし"
            />
          </div>

          {/* オーバーレイ (overlayOpacity) */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label
                htmlFor="bg-overlay"
                className="text-xs font-medium text-muted-foreground"
                title="UI 背景色を被せる濃さ。値が高いほど UI が読みやすく、画像は薄くなります。"
              >
                オーバーレイ
              </label>
              <span className="font-mono text-xs tabular-nums">
                {Math.round(bgImage.overlayOpacity * 100)}%
              </span>
            </div>
            <input
              id="bg-overlay"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!bgImage.path}
              value={Math.round(bgImage.overlayOpacity * 100)}
              onChange={(e) =>
                setBackgroundImage({
                  overlayOpacity: Number(e.target.value) / 100,
                })
              }
              onKeyDown={(e) =>
                handleSliderKeyDown(
                  e,
                  Math.round(bgImage.overlayOpacity * 100),
                  0,
                  100,
                  1,
                  (v) => setBackgroundImage({ overlayOpacity: v / 100 }),
                )
              }
              className="w-full accent-primary disabled:opacity-50"
              aria-label="オーバーレイの濃さ"
            />
          </div>
        </div>

        {/* プレビュー */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            プレビュー
          </div>
          <div
            className="relative overflow-hidden rounded-md border border-border"
            style={{
              width: 200,
              height: 100,
              backgroundColor: "hsl(var(--background))",
            }}
            aria-label="背景画像プレビュー"
          >
            {previewUrl ? (
              <>
                {/* 画像層 */}
                <div
                  className="absolute inset-0"
                  style={previewImageStyle}
                  aria-hidden
                />
                {/* オーバーレイ層 */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: "hsl(var(--background))",
                    opacity: bgImage.overlayOpacity,
                  }}
                  aria-hidden
                />
                {/* サンプル UI（読みやすさ確認用） */}
                <div className="relative flex h-full items-center justify-center">
                  <span className="rounded bg-background/60 px-2 py-0.5 text-[11px] text-foreground">
                    サンプル UI
                  </span>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                画像未選択
              </div>
            )}
          </div>
        </div>

        {/* リセット */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearBackgroundImage}
            disabled={!bgImage.path}
          >
            背景なしに戻す
          </Button>
        </div>
      </Card>

      {/* アプリ更新（PM-283 / v1.16.0 DEC-062） */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" aria-hidden />
            アプリの更新
          </h3>
          <p className="text-xs text-muted-foreground">
            GitHub Release から最新版を確認します。自動更新チェックが ON のとき、
            起動 3 秒後に最新バージョンを自動確認し、利用可能なら TitleBar と
            通知で案内します。
          </p>
        </div>

        {/* 自動更新チェック toggle */}
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">自動更新チェック</div>
            <div className="text-[11px] text-muted-foreground">
              起動時に最新バージョンを自動で確認します。OFF にしても手動確認は使えます。
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoCheck}
            onClick={() => setAutoCheck(!autoCheck)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
              autoCheck
                ? "border-primary bg-primary"
                : "border-border bg-muted"
            )}
            aria-label={
              autoCheck
                ? "自動更新チェックを無効にする"
                : "自動更新チェックを有効にする"
            }
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform",
                autoCheck ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
        </div>

        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerManualUpdateCheck()}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            手動で更新を確認
          </Button>
        </div>

        {skippedVersions.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            スキップ中のバージョン:{" "}
            <span className="font-mono">
              {skippedVersions.map((v) => `v${v}`).join(", ")}
            </span>
          </div>
        )}
      </Card>

      {/* v1.22.2: Sumi について（バージョン / ライセンス / GitHub リポジトリ） */}
      <AboutSection />

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
            // Round E2: 背景画像もデフォルト（画像なし）に戻す
            applyBackground(DEFAULT_BACKGROUND_IMAGE);
            setBgSizeWarning(null);
          }}
        >
          デフォルトに戻す
        </Button>
      </div>
    </div>
  );
}
