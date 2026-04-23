"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * PRJ-012 v1.0 / PM-925 (2026-04-20) → PM-936 (2026-04-20 iframe 撤退) → PM-943
 * (2026-04-20 v1.1 Phase 4.1 secondary WebviewWindow) → PM-945 (2026-04-20 v1.2
 * Preview window geometry 記憶): ブラウザプレビュー用 store。
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
 * ## v1.2 PM-945 - Preview window geometry 記憶
 * - project ごとに **前回 close 時の outer position / inner size** を保存する
 *   `windowGeometries: Record<projectId, PreviewWindowGeometry>` を追加。
 * - 保存タイミング: `PreviewPane` が Tauri 側 `onMoved` / `onResized` / `onCloseRequested`
 *   event を listen し、最新値で `setWindowGeometry(projectId, geometry)` を呼ぶ。
 * - 復元タイミング: 次回「アプリ内で開く」押下時に `getWindowGeometry(projectId)` で
 *   取り出して Rust `spawn_preview_window` command の `x/y/width/height` 引数に渡す。
 * - 初回（保存値なし）は Rust 側で default（center + 1280x800）で spawn される。
 * - Cursor / VSCode の Preview と同等の UX を提供する。
 *
 * ## 永続化
 * - project ごとに独立した preview URL を保持（dev server の port が project 間で異なる
 *   ため）。project 切替で自動的に該当 URL に切替わる。
 * - 最近使った URL を project ごとに 10 件まで保持。
 * - zustand persist で localStorage (`ccmux-preview-urls`) に `urls` と
 *   `windowGeometries` を永続化（`openedWebviewLabels` は揮発）。
 *
 * ## API
 * ```ts
 * const getUrl = usePreviewStore((s) => s.getUrlForProject);
 * const setCurrentUrl = usePreviewStore((s) => s.setCurrentUrl);
 * const registerWebviewWindow = usePreviewStore((s) => s.registerWebviewWindow);
 * const unregisterWebviewWindow = usePreviewStore((s) => s.unregisterWebviewWindow);
 * const getGeometry = usePreviewStore((s) => s.getWindowGeometry);
 * const setGeometry = usePreviewStore((s) => s.setWindowGeometry);
 * ```
 *
 * ## v1.2 以降（Phase 4.2）申し送り
 * - 同一 window 内 (in-window) webview（`@tauri-apps/api/webview` + unstable feature）
 * - 複数 URL タブ切替
 * - dev server の auto-detect (npm run dev stdout から port 抽出)
 * - mobile viewport emulation
 * - multi-monitor 配置時の geometry validation（画面外座標で spawn した場合のフォールバック）
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

/**
 * PM-945: Preview window の位置・サイズ (physical pixels)。
 *
 * - `x`, `y`: **outer** position（OS window の左上、decoration 含む）
 *   Tauri `Window.outerPosition()` の `PhysicalPosition` から取得する値。
 *   Rust 側 `WebviewWindowBuilder::position(x, y)` に渡すと同じ座標に配置される。
 * - `width`, `height`: **inner** size（webview コンテンツ領域、decoration 除く）
 *   Tauri `Window.innerSize()` の `PhysicalSize` から取得する値。
 *   Rust 側 `WebviewWindowBuilder::inner_size(w, h)` に渡すと同じサイズで起動する。
 *
 * 単位は physical px。 high-DPI display 間で移動した場合は scale factor が変わるが、
 * physical px を記録しておけば同じ display 上では視覚的に同じ位置・サイズに復元される。
 */
export interface PreviewWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
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
   * PM-945 (v1.2): project id → 前回 close 時の preview window 位置・サイズ。
   *
   * - persist される（urls と並列で localStorage に書き出される）。
   * - frontend (`PreviewPane`) が `onMoved` / `onResized` / `onCloseRequested` を
   *   listen して最新値を書き込む。
   * - 次回「アプリ内で開く」時に Rust `spawn_preview_window` command の
   *   `x/y/width/height` 引数として渡す。未登録 project では undefined を返すので
   *   Rust 側の default (center + 1280x800) が使われる。
   */
  windowGeometries: Record<string, PreviewWindowGeometry>;

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

  /**
   * PM-945: 指定 project の preview window geometry を取得。
   *
   * 未登録 project では `undefined` を返す（state は変更しない / pure）。
   * 呼び元は `undefined` の場合「Rust 側 default (center + 1280x800) で spawn させる」
   * 意図で、invoke 引数に `x/y/width/height` を渡さない。
   */
  getWindowGeometry: (projectId: string) => PreviewWindowGeometry | undefined;

  /**
   * PM-945: 指定 project の preview window geometry を保存する。
   *
   * - `onMoved` / `onResized` / `onCloseRequested` から呼ばれる想定。
   * - 既存値がある場合は上書き。persist により localStorage に即時書き出される。
   * - 値は physical pixels（Tauri の `PhysicalPosition` / `PhysicalSize` 由来）。
   * - `width <= 0` / `height <= 0` / 非数値（NaN）は不正値として無視する
   *   （minimize 中の 0 サイズ event 等のガード）。
   */
  setWindowGeometry: (projectId: string, geometry: PreviewWindowGeometry) => void;

  /**
   * v1.12.0 (DEC-058): project 削除 cascade 用。
   *
   * `urls[projectId]` / `windowGeometries[projectId]` / `openedWebviewLabels[projectId]`
   * の 3 map 全てから当該 project を削除する。spawn 済 WebviewWindow の kill は
   * ここでは扱わない（Rust 側は AgentState / PtyState のように一元管理していない
   * ため）。ユーザーが project を削除するまでに preview window を閉じていない
   * ケースは極小想定。
   */
  removeProject: (projectId: string) => void;
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
      windowGeometries: {},

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

      getWindowGeometry: (projectId) => {
        if (!projectId) return undefined;
        return get().windowGeometries[projectId];
      },

      setWindowGeometry: (projectId, geometry) => {
        if (!projectId) return;
        // PM-945: 非数値 / 非 finite / サイズ 0 以下は不正値として無視する。
        // - minimize 中の OS event で width/height=0 が流れてくる環境がある
        //   (Windows の hide 時)。この値を保存すると次回 spawn 時に極小 window に
        //   なるので、guard で弾く。
        // - x / y は負値を許容する（multi-monitor の左側 display は負座標）。
        const { x, y, width, height } = geometry;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        if (width <= 0 || height <= 0) return;
        set((state) => ({
          windowGeometries: {
            ...state.windowGeometries,
            [projectId]: { x, y, width, height },
          },
        }));
      },

      removeProject: (projectId) =>
        set((state) => {
          if (!projectId) return state;
          const hasUrls = projectId in state.urls;
          const hasGeom = projectId in state.windowGeometries;
          const hasLabel = projectId in state.openedWebviewLabels;
          if (!hasUrls && !hasGeom && !hasLabel) return state;
          const nextUrls = hasUrls ? { ...state.urls } : state.urls;
          if (hasUrls) delete nextUrls[projectId];
          const nextGeom = hasGeom
            ? { ...state.windowGeometries }
            : state.windowGeometries;
          if (hasGeom) delete nextGeom[projectId];
          const nextLabels = hasLabel
            ? { ...state.openedWebviewLabels }
            : state.openedWebviewLabels;
          if (hasLabel) delete nextLabels[projectId];
          return {
            urls: nextUrls,
            windowGeometries: nextGeom,
            openedWebviewLabels: nextLabels,
          };
        }),
    }),
    {
      name: PREVIEW_STORAGE_KEY,
      storage: safeStorage,
      version: 1,
      // PM-943: openedWebviewLabels は揮発（実 window の生死と常にズレないよう
      // localStorage に載せない）。
      // PM-945: windowGeometries は persist 対象（次回起動時の復元に必要）。
      partialize: (state) => ({
        urls: state.urls,
        windowGeometries: state.windowGeometries,
      }),
    }
  )
);
