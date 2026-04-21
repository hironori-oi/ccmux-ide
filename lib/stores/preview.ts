"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * PRJ-012 v1.0 / PM-925 (2026-04-20) → PM-936 (2026-04-20 iframe 撤退) → PM-943
 * (2026-04-20 v1.1 Phase 4.1 secondary WebviewWindow): ブラウザプレビュー用 store。
 *
 * ## v1.0 方針 (PM-936)
 * - PM-936 で iframe を撤退し、外部ブラウザ一本化に方針転換。
 * - 本 store は **URL 入力 / project ごとの URL persist / 履歴保存** 機能を維持。
 *
 * ## v1.1 Phase 4.1 (PM-943)
 * - Tauri 2 `WebviewWindow` (別 window) による in-app preview を復活。
 * - project ごとに **同時に 1 つ**の preview window を開く想定で、label を
 *   `openedWebviewLabels[projectId]` で map 管理。重複 spawn を避け、既存 window が
 *   あれば focus にフォールバックするために使う。
 * - `openedWebviewLabels` は **揮発** (partialize で persist から除外)。起動時は
 *   必ず空 map で始まり、実 window の生死とズレないようにする。
 *
 * ## 永続化
 * - project ごとに独立した preview URL を保持（dev server の port が project 間で異なる
 *   ため）。project 切替で自動的に該当 URL に切替わる。
 * - 最近使った URL を project ごとに 10 件まで保持。
 * - zustand persist で localStorage (`ccmux-preview-urls`) に `urls` のみ永続化。
 *
 * ## API
 * ```ts
 * const getUrl = usePreviewStore((s) => s.getUrlForProject);
 * const setCurrentUrl = usePreviewStore((s) => s.setCurrentUrl);
 * const registerWebviewWindow = usePreviewStore((s) => s.registerWebviewWindow);
 * const unregisterWebviewWindow = usePreviewStore((s) => s.unregisterWebviewWindow);
 * ```
 *
 * ## v1.1 以降（Phase 4.2）申し送り
 * - 同一 window 内 (in-window) webview（`@tauri-apps/api/webview` + unstable feature）
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
   * PM-943 (v1.1 Phase 4.1): project id → 現在 open 中の Tauri `WebviewWindow` label。
   *
   * - persist されない（揮発）。起動時は必ず空 map。
   * - 同 project で 2 回目「アプリ内で開く」クリック時に、このマップを見て既存
   *   window へ focus を移すか新規 spawn するかを判定する。
   * - window が close されたら `unregisterWebviewWindow` で必ず map から消すこと。
   */
  openedWebviewLabels: Record<string, string>;

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

  /**
   * PM-943: project 用 WebviewWindow の label を map に登録する。
   *
   * spawn 成功後 (`tauri://created` 受信後) に呼ぶ想定。既に別 label が紐付いて
   * いた場合は上書き（通常は unregister が先に呼ばれる）。
   */
  registerWebviewWindow: (projectId: string, label: string) => void;

  /**
   * PM-943: project 用 WebviewWindow を map から外す。
   *
   * window 側の `tauri://destroyed` を listen して呼ぶ。`label` を渡した場合は
   * 一致する場合のみ削除する（非同期で別 window が既に登録された race を回避）。
   */
  unregisterWebviewWindow: (projectId: string, label?: string) => void;
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
      openedWebviewLabels: {},

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

      registerWebviewWindow: (projectId, label) => {
        if (!projectId || !label) return;
        set((state) => ({
          openedWebviewLabels: {
            ...state.openedWebviewLabels,
            [projectId]: label,
          },
        }));
      },

      unregisterWebviewWindow: (projectId, label) => {
        if (!projectId) return;
        set((state) => {
          const current = state.openedWebviewLabels[projectId];
          if (!current) return state;
          if (label && current !== label) return state;
          const next = { ...state.openedWebviewLabels };
          delete next[projectId];
          return { openedWebviewLabels: next };
        });
      },
    }),
    {
      name: PREVIEW_STORAGE_KEY,
      storage: safeStorage,
      version: 1,
      // PM-943: openedWebviewLabels は揮発（実 window の生死と常にズレないよう
      // localStorage に載せない）。urls のみ persist する。
      partialize: (state) => ({
        urls: state.urls,
      }),
    }
  )
);
