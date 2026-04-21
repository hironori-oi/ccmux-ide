"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import {
  applyAccent,
  applyBackground,
  applyThemePreset,
  readPersistedAppearance,
  type ResolvedMode,
} from "@/lib/apply-accent";
import { DEFAULT_BACKGROUND_IMAGE } from "@/lib/types";

/**
 * PM-870 (v3.5.16): アプリ全ページで外観設定（テーマプリセット / アクセント /
 * 背景画像）を初期化する client-only コンポーネント。`layout.tsx` に mount する
 * ことで、workspace / settings どちらから起動しても localStorage の保存値が
 * 即座に DOM（CSS variable）へ反映される。
 *
 * ## 背景（何が壊れていたか）
 * v3.5 系統では `applyBackground` / `applyAccent` / `applyThemePreset` の呼び出しが
 * `AppearanceSettings.tsx` の `useEffect` に限定されており、ユーザーが
 * `/settings` を一度も開かないと `--ccmux-bg-image` が `none`（:root 既定値）
 * のままになり、背景画像の path を保存済みでも表示されない問題があった。
 *
 * ## 設計方針
 * - `readPersistedAppearance()` を使うため zustand store を介さず localStorage
 *   から同期的に値を取る（store の hydration を待たないことで FOUC を最小化）。
 * - `resolvedTheme` が light / dark として確定した後で再適用し、dark-only preset
 *   と accent の整合性を保つ。
 * - 何もレンダリングしない（副作用のみ）。
 */
export function AppearanceInit() {
  const { resolvedTheme } = useTheme();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // resolvedTheme が undefined の間は mode を決められないので待つ
    if (!resolvedTheme) return;

    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    const persisted = readPersistedAppearance();

    // 初回は theme / accent / background すべてを一括反映
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (persisted) {
        applyThemePreset(persisted.themePreset, mode);
        applyAccent(persisted.accentColor, mode);
        applyBackground(persisted.backgroundImage);
      } else {
        // persisted が無い初回起動: 背景画像だけはデフォルト（path=null）で
        // CSS variable を明示的に初期化しておく（他は globals.css の :root で
        // カバー済み）。
        applyBackground(DEFAULT_BACKGROUND_IMAGE);
      }
      return;
    }

    // 2 回目以降: light/dark 切替時のみ theme / accent を再適用
    // （背景画像は mode 非依存なのでスキップ）
    if (persisted) {
      applyThemePreset(persisted.themePreset, mode);
      applyAccent(persisted.accentColor, mode);
    }
  }, [resolvedTheme]);

  return null;
}
