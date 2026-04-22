"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import {
  applyAccent,
  applyBackground,
  applyFontSize,
  applyThemePreset,
  readPersistedAppearance,
  type ResolvedMode,
} from "@/lib/apply-accent";
import { useSettingsStore } from "@/lib/stores/settings";
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
  // PM-951: 設定画面のスライダー onChange で store が更新されたら、その場で
  // CSS variable --app-font-size に反映する。persist 復元は下の useEffect で
  // readPersistedAppearance から読むので二重初期化にはならない。
  const fontSize = useSettingsStore((s) => s.settings.appearance.fontSize);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // resolvedTheme が undefined の間は mode を決められないので待つ
    if (!resolvedTheme) return;

    const mode: ResolvedMode = resolvedTheme === "dark" ? "dark" : "light";
    const persisted = readPersistedAppearance();

    // 初回は theme / accent / background / fontSize すべてを一括反映
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (persisted) {
        applyThemePreset(persisted.themePreset, mode);
        applyAccent(persisted.accentColor, mode);
        applyBackground(persisted.backgroundImage);
        // PM-951: localStorage の fontSize を初期反映（persist 復元）。
        applyFontSize(persisted.fontSize);
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

  // PM-951: fontSize の変更（Settings スライダー操作）を即時 DOM に反映。
  // 初回 mount 時は上の useEffect でも applyFontSize を呼ぶが、冪等なので
  // 重複実行しても問題ない（CSS variable を同値で上書きするだけ）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    applyFontSize(fontSize);
  }, [fontSize]);

  return null;
}
