"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * PRJ-012 v1.0 / PM-925 (2026-04-20) → PM-936 (2026-04-20 iframe 撤退): ブラウザプレビュー用 store。
 *
 * ## v1.0 方針 (PM-936)
 * - PM-936 で iframe を撤退し、外部ブラウザ一本化に方針転換。
 * - 本 store は **URL 入力 / project ごとの URL persist / 履歴保存** 機能を維持。
 *   iframe 特有の状態（status / block 判定等）は元々持っていなかったため store 側は無変更。
 * - 履歴 (`history`) は v1.0 UI では dropdown 露出しないが、v1.1 (secondary webview)
 *   復活時に再利用予定のため保持。
 *
 * ## 永続化
 * - project ごとに独立した preview URL を保持（dev server の port が project 間で異なる
 *   ため）。project 切替で自動的に該当 URL に切替わる。
 * - 最近使った URL を project ごとに 10 件まで保持。
 * - zustand persist で localStorage (`ccmux-preview-urls`) に永続化。
 *
 * ## API
 * ```ts
 * const getUrl = usePreviewStore((s) => s.getUrlForProject);
 * const setCurrentUrl = usePreviewStore((s) => s.setCurrentUrl);
 * ```
 *
 * ## v1.1 以降（Phase 4）申し送り
 * - Tauri 2 secondary webview window による アプリ内 preview 復活
 * - 複数 URL タブ切替
 * - dev server の auto-detect (npm run dev stdout から port 抽出)
 * - mobile viewport emulation
 */

/** persist 用 localStorage key。 */
export const PREVIEW_STORAGE_KEY = "ccmux-preview-urls";

/** 新規 project の既定 URL（Next.js 標準 dev port）。 */
export const DEFAULT_PREVIEW_URL = "http://localhost:3000";

/** URL 履歴の保持上限（pattern: dropdown 候補として 10 件）。 */
export const PREVIEW_URL_HISTORY_LIMIT = 10;

/**
 * 1 project 分の preview state。
 *
 * - `current`: 現在の Preview URL（PM-936 以降は外部ブラウザで開く対象 URL）
 * - `history`: 最近使った URL（新しい順、重複は除外済。v1.1 で UI 復活予定）
 */
export interface PreviewProjectState {
  current: string;
  history: string[];
}

interface PreviewStoreState {
  /** project id → 該当 project の preview state。 */
  urls: Record<string, PreviewProjectState>;

  /**
   * 指定 project の現在 URL を取得。project が未登録なら
   * `DEFAULT_PREVIEW_URL` を返す（state は **変更しない** / pure）。
   */
  getUrlForProject: (projectId: string) => string;

  /**
   * 指定 project の現在 URL を設定し、同時に history に push する。
   *
   * - 既に history 先頭にある同一 URL は重複せず先頭へ移動
   * - history は `PREVIEW_URL_HISTORY_LIMIT` 件で切り詰め
   */
  setCurrentUrl: (projectId: string, url: string) => void;

  /**
   * history にだけ URL を push（current は変更しない）。
   *
   * `setCurrentUrl` と違って当該 URL を非 active で残す用途（将来の複数タブ等）。
   */
  pushHistory: (projectId: string, url: string) => void;
}

/** SSR 時の localStorage 不在を guard した JSONStorage。 */
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

/**
 * URL を history に追加した新しい history 配列を返す（immutable）。
 *
 * 既に含まれている場合は削除して先頭に置き直し、`PREVIEW_URL_HISTORY_LIMIT` 件で
 * 切り詰める。
 */
function pushUrlToHistory(history: string[], url: string): string[] {
  const deduped = history.filter((u) => u !== url);
  return [url, ...deduped].slice(0, PREVIEW_URL_HISTORY_LIMIT);
}

export const usePreviewStore = create<PreviewStoreState>()(
  persist(
    (set, get) => ({
      urls: {},

      getUrlForProject: (projectId) => {
        const entry = get().urls[projectId];
        return entry?.current ?? DEFAULT_PREVIEW_URL;
      },

      setCurrentUrl: (projectId, url) => {
        const trimmed = url.trim();
        if (!trimmed) return;
        set((state) => {
          const prev =
            state.urls[projectId] ??
            ({ current: "", history: [] } satisfies PreviewProjectState);
          return {
            urls: {
              ...state.urls,
              [projectId]: {
                current: trimmed,
                history: pushUrlToHistory(prev.history, trimmed),
              },
            },
          };
        });
      },

      pushHistory: (projectId, url) => {
        const trimmed = url.trim();
        if (!trimmed) return;
        set((state) => {
          const prev =
            state.urls[projectId] ??
            ({ current: DEFAULT_PREVIEW_URL, history: [] } satisfies PreviewProjectState);
          return {
            urls: {
              ...state.urls,
              [projectId]: {
                current: prev.current,
                history: pushUrlToHistory(prev.history, trimmed),
              },
            },
          };
        });
      },
    }),
    {
      name: PREVIEW_STORAGE_KEY,
      storage: safeStorage,
      version: 1,
    }
  )
);
