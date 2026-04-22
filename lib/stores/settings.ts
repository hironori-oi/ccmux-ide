"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BACKGROUND_IMAGE,
  type AccentColor,
  type AppSettings,
  type AppearanceSettings,
  type BackgroundImageSettings,
  type ThemeMode,
  type ThemePreset,
} from "@/lib/types";

/**
 * Week 6 Chunk 3 / PM-210: アプリ設定の永続化ストア。
 *
 * ## 永続化戦略
 * 本来は `@tauri-apps/plugin-store` で `~/.sumi/settings.json` に保存する
 * 方針だが、現時点の `package.json` に plugin-store が未導入のため、暫定で
 * Zustand の `persist` + `localStorage` を使い、キー `sumi:settings`
 * で保存する。M3 PM-250/251 で plugin-store に移行する予定（同キー JSON を
 * マイグレーションでコピー可能）。
 *
 * DEC-054: 旧 key `ccmux-ide-gui:settings` からの transparent migration を
 * safeStorage の getItem に実装済。
 *
 * ## 責務
 * - appearance（テーマ / アクセント / フォントサイズ）の保持
 * - `setAppearance` / `resetSettings` の提供
 * - SSR 時に `localStorage` が無いため `createJSONStorage` の factory で guard
 */
interface SettingsState {
  settings: AppSettings;
  /** Appearance 単位で partial 更新 */
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  /** 便宜: よく使う一部キーに特化した setter */
  setTheme: (theme: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  /** Week 7 Chunk 2 / PM-251: テーマプリセット切替 */
  setThemePreset: (preset: ThemePreset) => void;
  setFontSize: (px: number) => void;
  /** Round E2: 背景画像の部分更新 */
  setBackgroundImage: (patch: Partial<BackgroundImageSettings>) => void;
  /** Round E2: 背景画像をデフォルト（path=null）に戻す */
  clearBackgroundImage: () => void;
  /** すべてをデフォルトへ戻す（Settings ページのリセットボタン想定） */
  resetSettings: () => void;
}

/** DEC-054: 旧 settings key（`ccmux-ide-gui:settings`）。transparent migration で読む。 */
const LEGACY_SETTINGS_KEY = "ccmux-ide-gui:settings";
/** 新 settings key。 */
const SETTINGS_STORAGE_KEY = "sumi:settings";

/**
 * localStorage が利用できない環境（SSR / static export の build 時など）では
 * no-op storage を返し、Hydration Mismatch を避ける。
 *
 * DEC-054: 旧 `ccmux-ide-gui:settings` からの 1 回限り transparent migration を
 * getItem に実装。初回 rehydrate でもマイグレーション後の設定が読まれる。
 */
const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return {
    getItem: (name: string): string | null => {
      const value = window.localStorage.getItem(name);
      if (value !== null) return value;
      if (name === SETTINGS_STORAGE_KEY) {
        const legacy = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
        if (legacy !== null) {
          try {
            window.localStorage.setItem(name, legacy);
            window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
            // eslint-disable-next-line no-console
            console.info(
              "[sumi] migrated settings: ccmux-ide-gui:settings -> sumi:settings"
            );
          } catch {
            // quota / SecurityError は無視
          }
          return legacy;
        }
      }
      return null;
    },
    setItem: (name: string, value: string) => {
      window.localStorage.setItem(name, value);
    },
    removeItem: (name: string) => {
      window.localStorage.removeItem(name);
    },
  };
});

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_APP_SETTINGS,

      setAppearance: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: { ...s.settings.appearance, ...patch },
          },
        })),

      setTheme: (theme) =>
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: { ...s.settings.appearance, theme },
          },
        })),

      setAccentColor: (accentColor) =>
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: { ...s.settings.appearance, accentColor },
          },
        })),

      setThemePreset: (themePreset) =>
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: { ...s.settings.appearance, themePreset },
          },
        })),

      setFontSize: (fontSize) => {
        // バリデーション（型で許容値を絞れないため runtime でクランプ）
        const clamped = Math.max(12, Math.min(16, Math.round(fontSize)));
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: { ...s.settings.appearance, fontSize: clamped },
          },
        }));
      },

      setBackgroundImage: (patch) =>
        set((s) => {
          // 現行値に fallback（v2 migrate 前のデータでも落ちないように）
          const current =
            s.settings.appearance.backgroundImage ?? DEFAULT_BACKGROUND_IMAGE;
          const merged: BackgroundImageSettings = { ...current, ...patch };
          // ランタイムクランプ（UI 側でも制御するが二重防御）
          merged.opacity = Math.max(0, Math.min(1, merged.opacity));
          merged.overlayOpacity = Math.max(
            0,
            Math.min(1, merged.overlayOpacity)
          );
          merged.blur = Math.max(0, Math.min(20, merged.blur));
          return {
            settings: {
              ...s.settings,
              appearance: { ...s.settings.appearance, backgroundImage: merged },
            },
          };
        }),

      clearBackgroundImage: () =>
        set((s) => ({
          settings: {
            ...s.settings,
            appearance: {
              ...s.settings.appearance,
              backgroundImage: DEFAULT_BACKGROUND_IMAGE,
            },
          },
        })),

      resetSettings: () => set({ settings: DEFAULT_APP_SETTINGS }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: safeStorage,
      version: 3,
      // v1 → v2: Week 7 Chunk 2 / PM-251 で themePreset を追加（デフォルト orange）
      // v2 → v3: Round E2 で backgroundImage を追加（デフォルト path=null）
      migrate: (persisted, version) => {
        const state = persisted as { settings?: AppSettings } | undefined;
        if (!state?.settings) return { settings: DEFAULT_APP_SETTINGS };
        let next: AppSettings = state.settings;
        if (version < 2) {
          next = {
            ...next,
            appearance: {
              ...DEFAULT_APP_SETTINGS.appearance,
              ...next.appearance,
              themePreset: next.appearance?.themePreset ?? "orange",
            },
          };
        }
        if (version < 3) {
          next = {
            ...next,
            appearance: {
              ...DEFAULT_APP_SETTINGS.appearance,
              ...next.appearance,
              backgroundImage:
                next.appearance?.backgroundImage ?? DEFAULT_BACKGROUND_IMAGE,
            },
          };
        }
        return { settings: next };
      },
    }
  )
);
