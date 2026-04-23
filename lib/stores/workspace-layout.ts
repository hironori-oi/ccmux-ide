"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { useSessionStore } from "@/lib/stores/session";

/**
 * PM-969 / PM-981: ヘテロ分割ワークスペースのレイアウト状態（セッション別）。
 *
 * ## v2 (PM-981): Session-scoped layouts
 *
 * v1 は 1 つの `{ slots, layout }` をグローバルに持っていたため、session を
 * 切り替えても slot の中身が残り続ける問題があった（例: Session A で Chat 2 を
 * 配置 → Session B に切替 → Chat 2 が slot に残り続ける）。
 *
 * v2 では **session id をキーにした Record<sid, { slots, layout }>** に変更。
 * current session が変わると自動的にその session の layout を読み込む。
 *
 * - key = `useSessionStore.currentSessionId` / null 時は `"__default__"`
 * - 各 session は独立した slot 配置・layout を持つ
 * - 削除された chip (chat pane / file / pty) は全 session layouts から自動除去
 *
 * ## データモデル
 *
 * ```
 * layouts: {
 *   "session-abc": { slots: [Chat1, Chat2, null, null], layout: "2h" },
 *   "session-xyz": { slots: [Chat1, null, null, null],  layout: "1"  },
 *   "__default__": { slots: [...], layout: "..." },  // session 未選択時
 * }
 * ```
 *
 * ## DnD source / target
 *
 * - Source: TrayBar のチップ
 * - Target: 各 slot
 * - drop 時: `setSlot(slotIndex, content)` を呼び出し、current session の slots
 *   のみ更新する。他 session の layout は保持されて影響を受けない。
 */

export type SlotContentKind = "chat" | "editor" | "terminal" | "preview";

export interface SlotContent {
  kind: SlotContentKind;
  /**
   * 参照 ID:
   * - "chat":     paneId
   * - "editor":   fileId
   * - "terminal": ptyId
   * - "preview":  preview instance id
   */
  refId: string;
}

/** slot 数の固定（2x2）。 */
export const MAX_WORKSPACE_SLOTS = 4;

export type WorkspaceLayout = "1" | "2h" | "2v" | "4";

/** layout ごとに「表示される slot index の配列」 */
export const VISIBLE_SLOTS: Record<WorkspaceLayout, number[]> = {
  "1": [0],
  "2h": [0, 1],
  "2v": [0, 2],
  "4": [0, 1, 2, 3],
};

/** 1 session 分の layout state。 */
export interface SessionLayout {
  slots: Array<SlotContent | null>;
  layout: WorkspaceLayout;
}

/** session 未選択 (currentSessionId === null) 時の layout を格納する特殊 key */
export const DEFAULT_LAYOUT_KEY = "__default__";

function makeEmptyLayout(): SessionLayout {
  return {
    slots: Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
    layout: "2h",
  };
}

/**
 * 現在 session id に対応する layout key を取得する。`useSessionStore` の
 * getState() を直接呼ぶので、rehydrate 前や循環依存下でも安全に動く。
 */
function getCurrentLayoutKey(): string {
  try {
    return useSessionStore.getState().currentSessionId ?? DEFAULT_LAYOUT_KEY;
  } catch {
    return DEFAULT_LAYOUT_KEY;
  }
}

export interface WorkspaceLayoutState {
  /** session id → layout state の map */
  layouts: Record<string, SessionLayout>;

  /** current session の slots を更新する（同 chip が別 slot なら先に null 化） */
  setSlot: (slotIndex: number, content: SlotContent | null) => void;

  /**
   * 指定 refId の chip を **全 session layouts** から除去する。
   * 削除された chat pane / file / terminal / preview のクリーンアップ用。
   */
  removeByRefId: (kind: SlotContentKind, refId: string) => void;

  /** current session の layout を変更 */
  setLayout: (layout: WorkspaceLayout) => void;

  /** current session の slots を全て null にする */
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

/**
 * v1 → v2 migration:
 * 旧 state は `{ slots, layout }` だった。v2 は `{ layouts: Record<sid, ...> }`。
 * 旧データは `__default__` key に移して保持する（session 未選択時に表示される）。
 */
function migrateFromV1(
  persisted: unknown
): Partial<WorkspaceLayoutState> {
  if (!persisted || typeof persisted !== "object") {
    return { layouts: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() } };
  }
  const old = persisted as {
    slots?: Array<SlotContent | null>;
    layout?: WorkspaceLayout;
    layouts?: Record<string, SessionLayout>;
  };
  // 既に v2 shape なら layouts をそのまま使う
  if (old.layouts) {
    return { layouts: old.layouts };
  }
  // v1 shape を __default__ に移植
  const legacyLayout: SessionLayout = {
    slots:
      Array.isArray(old.slots) && old.slots.length === MAX_WORKSPACE_SLOTS
        ? old.slots.slice()
        : Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
    layout: old.layout ?? "2h",
  };
  return { layouts: { [DEFAULT_LAYOUT_KEY]: legacyLayout } };
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      layouts: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() },

      setSlot: (slotIndex, content) =>
        set((s) => {
          if (slotIndex < 0 || slotIndex >= MAX_WORKSPACE_SLOTS) return s;
          const key = getCurrentLayoutKey();
          const cur = s.layouts[key] ?? makeEmptyLayout();
          const next = cur.slots.slice();
          // PM-980: 同じ chip が他 slot にあれば先に null 化（1 chip = 1 slot）
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
          return {
            layouts: { ...s.layouts, [key]: { ...cur, slots: next } },
          };
        }),

      removeByRefId: (kind, refId) =>
        set((s) => {
          // PM-981: 削除時は **全 session** の layouts から該当 refId を除去。
          // chip が削除された後も別 session の slot に stale 参照が残ると、
          // session 切替時に「存在しない chat/file/pty」が描画されてしまうため。
          const nextLayouts: Record<string, SessionLayout> = {};
          for (const [sid, layout] of Object.entries(s.layouts)) {
            nextLayouts[sid] = {
              ...layout,
              slots: layout.slots.map((c) =>
                c && c.kind === kind && c.refId === refId ? null : c
              ),
            };
          }
          return { layouts: nextLayouts };
        }),

      setLayout: (layout) =>
        set((s) => {
          const key = getCurrentLayoutKey();
          const cur = s.layouts[key] ?? makeEmptyLayout();
          return {
            layouts: { ...s.layouts, [key]: { ...cur, layout } },
          };
        }),

      clearAll: () =>
        set((s) => {
          const key = getCurrentLayoutKey();
          return {
            layouts: { ...s.layouts, [key]: makeEmptyLayout() },
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          const migrated = migrateFromV1(persisted);
          return migrated as WorkspaceLayoutState;
        }
        return persisted as WorkspaceLayoutState;
      },
    }
  )
);

// ---------------------------------------------------------------------------
// Helper hooks: current session の layout を subscribe する。
// component はこれらを経由して slots / layout を読む。
// ---------------------------------------------------------------------------

/**
 * current session に対応する layout key を subscribe（session 切替で変化）。
 * hooks 内部で session / layout 両方を subscribe するための基盤。
 */
function useCurrentLayoutKey(): string {
  const sid = useSessionStore((s) => s.currentSessionId);
  return sid ?? DEFAULT_LAYOUT_KEY;
}

/**
 * 現在 session の slots を subscribe。session 切替で自動的に新 session の
 * slots に切り替わる。参照が変わらなければ React は再レンダしない。
 */
export function useCurrentSlots(): Array<SlotContent | null> {
  const key = useCurrentLayoutKey();
  return useWorkspaceLayoutStore((s) => {
    const layout = s.layouts[key];
    if (!layout) {
      // 初回アクセス時は空 slots を返す（store は setSlot 時に初期化）
      return EMPTY_SLOTS;
    }
    return layout.slots;
  });
}

/** 固定参照の空 slots 配列（React の snapshot caching 要件）。 */
const EMPTY_SLOTS: Array<SlotContent | null> = Object.freeze(
  Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null)
) as Array<SlotContent | null>;

/**
 * 指定 slotIndex の current session content を subscribe する専用 hook。
 * SlotContainer が使う（slot 1 件だけの購読で無駄な rerender を抑制）。
 */
export function useCurrentSlotContent(
  slotIndex: number
): SlotContent | null {
  const key = useCurrentLayoutKey();
  return useWorkspaceLayoutStore((s) => {
    const layout = s.layouts[key];
    return layout?.slots[slotIndex] ?? null;
  });
}

/**
 * 現在 session の layout mode を subscribe。
 */
export function useCurrentLayout(): WorkspaceLayout {
  const key = useCurrentLayoutKey();
  return useWorkspaceLayoutStore((s) => s.layouts[key]?.layout ?? "2h");
}
