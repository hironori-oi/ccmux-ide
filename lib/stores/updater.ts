"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * v1.16.0 / DEC-062: 自動更新用 state store。
 *
 * ## 責務
 *  - UpdateNotifier の実行状態（checking / available / downloading / ready / error）を
 *    1 箇所に集約し、UpdateBadge（TitleBar）と UpdateDialog から同じ store を subscribe。
 *  - 「このバージョンをスキップ」の永続化 (`skippedVersions`)
 *  - 「自動更新チェック」の ON/OFF (`autoCheck`)
 *
 * ## 永続化
 *  - zustand persist + localStorage、key = `sumi:updater`
 *  - `skippedVersions` と `autoCheck` のみ persist。実行時状態（status / downloadProgress /
 *    latestVersion / lastCheckAt）は volatile（ページリロードで初期化）。
 *
 * ## 再マウント耐性
 *  - UpdateNotifier を ErrorBoundary で包んで crash 時に再マウントしない場合でも、
 *    UpdateBadge / UpdateDialog は store を subscribe しているため UI は消えない
 *    （crashed 時は status="idle" のまま volatile ということだけ）。
 */

/** UpdateNotifier のライフサイクル状態。 */
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  /** 現在の実行状態（volatile、起動時は idle）。 */
  status: UpdaterStatus;
  /** 利用可能バージョン（"1.16.0" など prefix 無し）。volatile。 */
  latestVersion: string | null;
  /** downloading 中の進捗 0-100。volatile。 */
  downloadProgress: number;
  /** 直近の check 時刻（ms epoch）、手動 check の cooldown 判定等に使う。volatile。 */
  lastCheckAt: number | null;
  /** 最後に発生したエラーメッセージ（status="error" 時のみ）。volatile。 */
  lastError: string | null;
  /** ユーザーが「スキップ」した version 一覧（PERSIST）。 */
  skippedVersions: string[];
  /** 起動時の自動 check を行うか（PERSIST、default true）。 */
  autoCheck: boolean;

  // ----- actions (all volatile unless they touch persist fields) -----
  setStatus: (status: UpdaterStatus) => void;
  setLatestVersion: (version: string | null) => void;
  setDownloadProgress: (pct: number) => void;
  setLastCheckAt: (ts: number | null) => void;
  setLastError: (message: string | null) => void;
  /** `skippedVersions` に追加（重複は無視）。 */
  skipVersion: (version: string) => void;
  /** 指定 version がスキップ対象か。空文字 / null は false。 */
  isSkipped: (version: string | null | undefined) => boolean;
  setAutoCheck: (enabled: boolean) => void;
  /** 実行時 state（status/latestVersion/downloadProgress/lastError）を idle に戻す。 */
  resetRuntime: () => void;
}

const UPDATER_STORAGE_KEY = "sumi:updater";

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

export const useUpdaterStore = create<UpdaterState>()(
  persist(
    (set, get) => ({
      status: "idle",
      latestVersion: null,
      downloadProgress: 0,
      lastCheckAt: null,
      lastError: null,
      skippedVersions: [],
      autoCheck: true,

      setStatus: (status) => set({ status }),
      setLatestVersion: (latestVersion) => set({ latestVersion }),
      setDownloadProgress: (pct) =>
        set({ downloadProgress: Math.max(0, Math.min(100, Math.round(pct))) }),
      setLastCheckAt: (lastCheckAt) => set({ lastCheckAt }),
      setLastError: (lastError) => set({ lastError }),

      skipVersion: (version) => {
        if (!version) return;
        const curr = get().skippedVersions;
        if (curr.includes(version)) return;
        set({ skippedVersions: [...curr, version] });
      },

      isSkipped: (version) => {
        if (!version) return false;
        return get().skippedVersions.includes(version);
      },

      setAutoCheck: (autoCheck) => set({ autoCheck }),

      resetRuntime: () =>
        set({
          status: "idle",
          latestVersion: null,
          downloadProgress: 0,
          lastError: null,
        }),
    }),
    {
      name: UPDATER_STORAGE_KEY,
      storage: safeStorage,
      version: 1,
      // 永続化対象を絞る（実行時 state は persist しない）
      partialize: (state) => ({
        skippedVersions: state.skippedVersions,
        autoCheck: state.autoCheck,
      }),
    }
  )
);
