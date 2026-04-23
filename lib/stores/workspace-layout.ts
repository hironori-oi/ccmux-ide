"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * PM-969: ヘテロ分割ワークスペースのレイアウト状態。
 *
 * `viewMode === "workspace"` のとき、Shell は本 store を参照して slots の内容を
 * レンダリングする。各 slot は nullable で、`null` の場合は「ここにドラッグ」の
 * プレースホルダを表示する。
 *
 * ## データモデル
 *
 * ```
 * slots: [A, B, C, D]    // 最大 4 スロット (2x2 grid)
 * layout: "1" | "2h" | "2v" | "4"
 * ```
 *
 * - layout = "1": slot A のみ表示（B/C/D 非表示、データは保持）
 * - layout = "2h": A と B を横並び（C/D 非表示、データは保持）
 * - layout = "2v": A と C を縦並び（B/D 非表示、データは保持）
 * - layout = "4": 2x2 全部表示
 *
 * ## DnD source / target
 *
 * - Source: TrayBar のチップ（既存の chat session / editor file / terminal pty
 *   / preview 全てから導出）
 * - Target: 各 slot（`useDroppable` で登録）
 * - drop 時: `setSlot(slotIndex, content)` を呼び出し state を更新
 */

export type SlotContentKind = "chat" | "editor" | "terminal" | "preview";

export interface SlotContent {
  /** コンテンツの種類（どの pane / view を描画するか） */
  kind: SlotContentKind;
  /**
   * 参照 ID（refId の意味は kind 別）:
   * - "chat":     paneId (useChatStore.panes のキー)
   * - "editor":   fileId (useEditorStore.openFiles[].id)
   * - "terminal": ptyId (useTerminalStore.terminals のキー)
   * - "preview":  projectId（preview は project 単位 1 個なので projectId）
   */
  refId: string;
}

/** slot 数の固定（2x2）。将来 6/9 等に拡張する場合はここを増やす。 */
export const MAX_WORKSPACE_SLOTS = 4;

export type WorkspaceLayout = "1" | "2h" | "2v" | "4";

/** layout ごとに「表示される slot index の配列」 */
export const VISIBLE_SLOTS: Record<WorkspaceLayout, number[]> = {
  "1": [0],
  "2h": [0, 1],
  "2v": [0, 2],
  "4": [0, 1, 2, 3],
};

export interface WorkspaceLayoutState {
  slots: Array<SlotContent | null>;
  layout: WorkspaceLayout;
  /** slot index に content を割り当てる（既存 content は上書き） */
  setSlot: (slotIndex: number, content: SlotContent | null) => void;
  /** 指定 refId が slot に入っていればそれを空にする（削除時の掃除） */
  removeByRefId: (kind: SlotContentKind, refId: string) => void;
  /** layout 切替 */
  setLayout: (layout: WorkspaceLayout) => void;
  /** 全 slot をクリア（デバッグ用 / UI リセット用） */
  clearAll: () => void;
}

const STORAGE_KEY = "sumi:workspace-layout";

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

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      slots: Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
      layout: "2h",

      setSlot: (slotIndex, content) =>
        set((s) => {
          if (slotIndex < 0 || slotIndex >= MAX_WORKSPACE_SLOTS) return s;
          const next = s.slots.slice();
          // PM-980: 同じ chip (kind + refId) が別 slot に存在する場合は先に
          // そちらを空にする（1 chip = 1 slot 制約）。
          // 「移動」のセマンティクス: slot A → slot B にドラッグしたら A は空、
          // B に表示。同じ内容の複製は作らない。
          if (content) {
            for (let i = 0; i < next.length; i++) {
              if (i === slotIndex) continue;
              const c = next[i];
              if (c && c.kind === content.kind && c.refId === content.refId) {
                next[i] = null;
              }
            }
          }
          next[slotIndex] = content;
          return { slots: next };
        }),

      removeByRefId: (kind, refId) =>
        set((s) => {
          const next = s.slots.map((c) =>
            c && c.kind === kind && c.refId === refId ? null : c
          );
          return { slots: next };
        }),

      setLayout: (layout) => set({ layout }),

      clearAll: () =>
        set({
          slots: Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 1,
    }
  )
);
