"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * PM-983: セッション表示順の管理ストア。
 *
 * ## 機能
 *
 * デフォルトは「更新時刻降順（auto）」だが、ユーザーが「手動並べ替え（manual）」
 * モードに切替えると、ドラッグ&ドロップでカスタム順序を保存できる。
 *
 * ## データモデル
 *
 * ```
 * mode:  "auto" | "manual"    // 現在のモード（UI 全体で共通）
 * order: Record<projectKey, string[]>
 *   // projectKey = projectId or "__null__" (未分類セッション group)
 *   // 値 = session id の配列（手動順）
 * ```
 *
 * ## 挙動
 *
 * - **auto**: SQLite `list_sessions` の返す updated_at DESC をそのまま使う
 * - **manual**: 保存済の order 配列を優先、未登録 session は末尾に append
 *   session が削除されると order から自動除去（SessionList の sort 時に filter）
 */

export type SessionOrderMode = "auto" | "manual";

export const UNCATEGORIZED_KEY = "__null__";

interface SessionOrderState {
  mode: SessionOrderMode;
  /** projectKey（= projectId or "__null__"）→ 手動並び順の session id 配列 */
  order: Record<string, string[]>;
  setMode: (mode: SessionOrderMode) => void;
  /** 特定 project の session 並び順を上書き保存 */
  setOrder: (projectKey: string, ids: string[]) => void;
  /** session 削除時に order からも除去 */
  removeFromOrder: (sessionId: string) => void;
  /**
   * v1.12.0 (DEC-058): project 削除 cascade 用。
   * `order[projectId]` を丸ごと削除する。
   */
  removeProject: (projectId: string) => void;
}

const STORAGE_KEY = "sumi:session-order";

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

export const useSessionOrderStore = create<SessionOrderState>()(
  persist(
    (set) => ({
      mode: "auto",
      order: {},
      setMode: (mode) => set({ mode }),
      setOrder: (projectKey, ids) =>
        set((s) => ({ order: { ...s.order, [projectKey]: ids } })),
      removeFromOrder: (sessionId) =>
        set((s) => {
          const next: Record<string, string[]> = {};
          for (const [k, arr] of Object.entries(s.order)) {
            next[k] = arr.filter((id) => id !== sessionId);
          }
          return { order: next };
        }),

      removeProject: (projectId) =>
        set((s) => {
          if (!(projectId in s.order)) return s;
          const next = { ...s.order };
          delete next[projectId];
          return { order: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 1,
    }
  )
);

/**
 * `list_sessions` が返した session 配列に対し、manual モードなら保存済順に
 * reorder、auto モードなら元の順序（updated_at DESC）を維持する。
 *
 * manual 時、order に未登録の session（新規作成など）は **末尾** に append。
 * これにより新 session は目立つ位置ではなく後ろに入るが、UI 上で drag して
 * 好きな位置に移動できる。
 */
export function applySessionOrder<T extends { id: string }>(
  sessions: T[],
  projectKey: string,
  mode: SessionOrderMode,
  order: Record<string, string[]>
): T[] {
  if (mode === "auto") return sessions;
  const saved = order[projectKey];
  if (!saved || saved.length === 0) return sessions;
  // saved 順の既出 id を採用、未登録 session は末尾に append
  const savedSet = new Set(saved);
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const ordered: T[] = [];
  for (const id of saved) {
    const s = byId.get(id);
    if (s) ordered.push(s);
  }
  for (const s of sessions) {
    if (!savedSet.has(s.id)) ordered.push(s);
  }
  return ordered;
}
