"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { DEFAULT_PREVIEW_URL } from "@/lib/stores/preview";

/**
 * PM-973: workspace slot 内で **複数のプレビュー** を独立した URL で表示するための
 * 軽量インスタンス管理ストア。
 *
 * ## 背景
 * 旧 `usePreviewStore` は project 単位で 1 つの URL のみを保持する設計（secondary
 * WebviewWindow 用）。workspace の複数 slot で同時に異なる URL を表示したいという
 * オーナー要望に応えるため、instance ごとに独立した URL を持たせる。
 *
 * ## データモデル
 * ```
 * instances: Record<previewId, { id, url, projectId }>
 * ```
 *
 * - `previewId`: 一意 UUID（tray チップの refId として使われる）
 * - `url`: そのインスタンスの現在 URL
 * - `projectId`: 作成時の project id（将来 project 切替時の整理用、現状は参考情報）
 *
 * PreviewPane は `previewId` prop を受け取り、設定されていればこのストアから
 * URL を読み書きする。未設定時は旧 usePreviewStore (project 単位) にフォールバック。
 */

export interface PreviewInstance {
  id: string;
  url: string;
  projectId: string;
  /**
   * PM-975: 作成時にアクティブだった SQLite session id。
   * tray の session フィルタで該当 session のチップだけ表示するのに使う。
   */
  creatingSessionId?: string | null;
}

interface PreviewInstancesState {
  instances: Record<string, PreviewInstance>;
  addInstance: (
    projectId: string,
    options?: {
      initialUrl?: string;
      /** PM-975: 作成時 session id（tray フィルタ用） */
      sessionId?: string | null;
    }
  ) => string;
  removeInstance: (id: string) => void;
  setUrl: (id: string, url: string) => void;
  /** 指定 project に属する instance を全削除（project 削除時用、現状呼出元なし）。 */
  removeByProject: (projectId: string) => void;
}

function newPreviewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return "prev-" + crypto.randomUUID().slice(0, 8);
  }
  return "prev-" + Math.random().toString(36).slice(2, 10);
}

const STORAGE_KEY = "sumi:preview-instances";

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

export const usePreviewInstances = create<PreviewInstancesState>()(
  persist(
    (set) => ({
      instances: {},

      addInstance: (projectId, options) => {
        const id = newPreviewId();
        set((s) => ({
          instances: {
            ...s.instances,
            [id]: {
              id,
              url: options?.initialUrl ?? DEFAULT_PREVIEW_URL,
              projectId,
              creatingSessionId: options?.sessionId ?? null,
            },
          },
        }));
        return id;
      },

      removeInstance: (id) =>
        set((s) => {
          if (!s.instances[id]) return s;
          const { [id]: _removed, ...rest } = s.instances;
          void _removed;
          return { instances: rest };
        }),

      setUrl: (id, url) =>
        set((s) => {
          const cur = s.instances[id];
          if (!cur) return s;
          return {
            instances: {
              ...s.instances,
              [id]: { ...cur, url },
            },
          };
        }),

      removeByProject: (projectId) =>
        set((s) => {
          const next: Record<string, PreviewInstance> = {};
          for (const [id, inst] of Object.entries(s.instances)) {
            if (inst.projectId !== projectId) next[id] = inst;
          }
          return { instances: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 1,
    }
  )
);
