"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import {
  DEFAULT_APP_SETTINGS,
  type AccentColor,
  type AppSettings,
  type AppearanceSettings,
  type ThemeMode,
} from "@/lib/types";

/**
 * Week 6 Chunk 3 / PM-210: アプリ設定の永続化ストア。
 *
 * ## 永続化戦略
 * 本来は `@tauri-apps/plugin-store` で `~/.ccmux-ide-gui/settings.json` に保存する
 * 方針だが、現時点の `package.json` に plugin-store が未導入のため、暫定で
 * Zustand の `persist` + `localStorage` を使い、キー `ccmux-ide-gui:settings`
 * で保存する。M3 PM-250/251 で plugin-store に移行する予定（同キー JSON を
 * マイグレーションでコピー可能）。
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
  setFontSize: (px: number) => void;
  /** すべてをデフォルトへ戻す（Settings ページのリセットボタン想定） */
  resetSettings: () => void;
}

/**
 * localStorage が利用できない環境（SSR / static export の build 時など）では
 * no-op storage を返し、Hydration Mismatch を避ける。
 */
const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return window.localStorage;
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

      resetSettings: () => set({ settings: DEFAULT_APP_SETTINGS }),
    }),
    {
      name: "ccmux-ide-gui:settings",
      storage: safeStorage,
      version: 1,
    }
  )
);
