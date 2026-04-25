"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";

/**
 * PM-969 / PM-981 / v1.10.0 (DEC-054 + DEC-055): ヘテロ分割ワークスペースの
 * レイアウト状態（project 別 + session 別）。
 *
 * ## v3 (v1.10.0 / DEC-055): Project-scoped layouts
 *
 * v2 では `layouts: Record<sessionId, SessionLayout>` で session 別だったが、
 * **session id は project をまたいで uniqueness が保証されない** ため、
 * project を切り替えると別 project の session id と衝突して前 project の
 * layout が leak する事故があった。
 *
 * v3 では **`layouts: Record<projectId, Record<sessionId, SessionLayout>>`**
 * に改め、project × session の複合 key で独立保持する。
 *
 * - outer key = `useProjectStore.activeProjectId` / null 時は `GLOBAL_PROJECT_KEY`
 * - inner key = `useSessionStore.currentSessionId` / null 時は `DEFAULT_LAYOUT_KEY`
 * - project 切替で inner map が切替わり、session 切替で SessionLayout が切替わる
 * - 削除された chip (chat pane / file / pty) は全 project × 全 session から自動除去
 *
 * ## v3 (v1.10.0 / DEC-054): "2v" → "3" (L字 3 分割) 差替え
 *
 * `"2v"` (縦 2 分割) を廃止し、新しく `"3"` (L字 3 分割 = 左全高 + 右上 + 右下) を
 * 追加する。実測で `"2v"` の利用は非常に少なく、左 chat + 右 editor/preview の
 * 多段構成のほうが実用的というオーナー判断。
 *
 * Migration:
 * - v2 persisted の `"2v"` layout は `"2h"` に変換し、旧 slot2 の chip は slot1 に移送する
 *   （slot1 に既存があれば破棄）。
 *
 * ## データモデル
 *
 * ```
 * layouts: {
 *   "project-abc": {
 *     "session-1": { slots: [Chat1, Editor1, null, null], layout: "2h" },
 *     "__default__": { slots: [Chat, null, null, null], layout: "1" },
 *   },
 *   "__global__": { ... },  // project 未選択時
 * }
 * ```
 *
 * ## DnD source / target
 *
 * - Source: TrayBar のチップ
 * - Target: 各 slot
 * - drop 時: `setSlot(slotIndex, content)` を呼び出し、current project × current session
 *   の slots のみ更新する。他 project / 他 session の layout は影響を受けない。
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

/**
 * 画面分割モード:
 * - `"1"`: 1 枠
 * - `"2h"`: 左右 2 枠
 * - `"3"`: L字 3 枠 (左 1 全高 + 右上 + 右下)
 * - `"4"`: 2x2 4 枠
 */
export type WorkspaceLayout = "1" | "2h" | "3" | "4";

/** layout ごとに「表示される slot index の配列」 */
export const VISIBLE_SLOTS: Record<WorkspaceLayout, number[]> = {
  "1": [0],
  "2h": [0, 1],
  "3": [0, 1, 2],
  "4": [0, 1, 2, 3],
};

/** 1 session 分の layout state。 */
export interface SessionLayout {
  slots: Array<SlotContent | null>;
  layout: WorkspaceLayout;
}

/** session 未選択 (currentSessionId === null) 時の inner key。 */
export const DEFAULT_LAYOUT_KEY = "__default__";

/** project 未選択 (activeProjectId === null) 時の outer key。 */
export const GLOBAL_PROJECT_KEY = "__global__";

/** v2 → v3 migration で旧 flat map を退避する outer key。 */
export const LEGACY_PROJECT_KEY = "__legacy__";

function makeEmptyLayout(): SessionLayout {
  return {
    slots: Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
    layout: "2h",
  };
}

/**
 * 現在 (projectId, sessionId) の複合 key を取得する。
 * `useProjectStore` / `useSessionStore` の getState() を直接呼ぶので、rehydrate 前や
 * 循環依存下でも安全に動く。
 */
function getCurrentLayoutKeys(): { projectKey: string; sessionKey: string } {
  let projectKey = GLOBAL_PROJECT_KEY;
  let sessionKey = DEFAULT_LAYOUT_KEY;
  try {
    projectKey =
      useProjectStore.getState().activeProjectId ?? GLOBAL_PROJECT_KEY;
  } catch {
    // ignore – rehydrate 中 / 循環依存で未初期化の場合は default key
  }
  try {
    sessionKey =
      useSessionStore.getState().currentSessionId ?? DEFAULT_LAYOUT_KEY;
  } catch {
    // ignore
  }
  return { projectKey, sessionKey };
}

export interface WorkspaceLayoutState {
  /** projectId → sessionId → SessionLayout のネスト map */
  layouts: Record<string, Record<string, SessionLayout>>;

  /** current project × session の slots を更新する（同 chip が別 slot なら先に null 化） */
  setSlot: (slotIndex: number, content: SlotContent | null) => void;

  /**
   * 指定 refId の chip を **全 project × 全 session layouts** から除去する。
   * 削除された chat pane / file / terminal / preview のクリーンアップ用。
   */
  removeByRefId: (kind: SlotContentKind, refId: string) => void;

  /** current project × session の layout を変更 */
  setLayout: (layout: WorkspaceLayout) => void;

  /** current project × session の slots を全て null にする */
  clearAll: () => void;

  /**
   * v1.12.0 (DEC-058): project 削除 cascade 用。
   * `layouts[projectId]` を丸ごと削除する。inner の全 session layout も同時消滅。
   */
  removeProject: (projectId: string) => void;

  /**
   * v1.27.0: リロード後の slot.refId 検証 + 修復。
   *
   * Rust `list_active_terminals` の生存 pty 一覧を受け、`kind === "terminal"`
   * の slot のうち `refId` がそのリストに含まれていない slot を `null` に戻す。
   * 戻り値: 修復された slot 数（toast 通知 / debug 用）。
   */
  repairDeadTerminalRefs: (livePtyIds: ReadonlyArray<string>) => number;
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
 * v2 session-scoped SessionLayout を DEC-054 ルールで新しい layout enum に正規化する。
 * - `"2v"` → `"2h"` に変換し、slot2 の chip は slot1 に移送（slot1 既存があれば破棄）。
 * - その他の layout はそのまま。
 */
function normalizeLayout(input: SessionLayout | undefined | null): SessionLayout {
  if (!input || typeof input !== "object") return makeEmptyLayout();
  const rawSlots = Array.isArray(input.slots)
    ? input.slots.slice()
    : Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null);
  // ensure length = MAX_WORKSPACE_SLOTS
  while (rawSlots.length < MAX_WORKSPACE_SLOTS) rawSlots.push(null);
  rawSlots.length = MAX_WORKSPACE_SLOTS;

  const rawLayout = (input as { layout?: string }).layout;
  if (rawLayout === "2v") {
    // DEC-054: "2v" は "2h" に折り畳む。slot2 → slot1 移送（slot1 既存があれば破棄）。
    const nextSlots = rawSlots.slice();
    const slot2 = nextSlots[2] ?? null;
    if (slot2) {
      nextSlots[1] = slot2; // 既存 slot1 は破棄
      nextSlots[2] = null;
    }
    return { slots: nextSlots, layout: "2h" };
  }
  const valid: WorkspaceLayout[] = ["1", "2h", "3", "4"];
  const nextLayout = (valid as string[]).includes(rawLayout ?? "")
    ? (rawLayout as WorkspaceLayout)
    : "2h";
  return { slots: rawSlots, layout: nextLayout };
}

/**
 * v1 / v2 → v3 migration:
 * - v1: `{ slots, layout }` (flat)
 * - v2: `{ layouts: Record<sessionId, SessionLayout> }`
 * - v3: `{ layouts: Record<projectId, Record<sessionId, SessionLayout>> }`
 *
 * 旧データは `__legacy__` project key の配下に退避する。session id は project を
 * またいで uniqueness が保証されないため、旧 map を active project に紐付ける
 * ことはできない（誤帰属リスク）。新 project は空状態から開始される。
 */
function migrateFromV1OrV2(
  persisted: unknown
): Pick<WorkspaceLayoutState, "layouts"> {
  const defaultState: Pick<WorkspaceLayoutState, "layouts"> = {
    layouts: {
      [GLOBAL_PROJECT_KEY]: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() },
    },
  };
  if (!persisted || typeof persisted !== "object") {
    return defaultState;
  }
  const old = persisted as {
    slots?: Array<SlotContent | null>;
    layout?: WorkspaceLayout | "2v";
    layouts?: unknown;
  };

  // v2 shape: layouts は `Record<sessionId, SessionLayout>` (flat) → `__legacy__` に退避
  if (
    old.layouts &&
    typeof old.layouts === "object" &&
    !Array.isArray(old.layouts)
  ) {
    const entries = Object.entries(old.layouts as Record<string, unknown>);
    // v3 shape check: value が { slots, layout } 直下か、または Record<sid, SessionLayout> か
    const looksLikeV3 = entries.every(([, v]) => {
      if (!v || typeof v !== "object") return false;
      const maybeInner = v as Record<string, unknown>;
      // 内側の value が SessionLayout 形状 (slots+layout) を含まず、さらに Record 形状
      const innerValues = Object.values(maybeInner);
      if (innerValues.length === 0) return true; // 空 object は v3 として扱う
      return innerValues.every(
        (iv) =>
          iv !== null &&
          typeof iv === "object" &&
          "slots" in (iv as Record<string, unknown>) &&
          "layout" in (iv as Record<string, unknown>)
      );
    });

    if (looksLikeV3) {
      // 既に v3 shape。各 SessionLayout を正規化して返す
      const normalized: Record<string, Record<string, SessionLayout>> = {};
      for (const [pk, inner] of entries) {
        const innerObj = inner as Record<string, unknown>;
        const nextInner: Record<string, SessionLayout> = {};
        for (const [sk, sv] of Object.entries(innerObj)) {
          nextInner[sk] = normalizeLayout(sv as SessionLayout);
        }
        normalized[pk] = nextInner;
      }
      // 最低限 GLOBAL_PROJECT_KEY は確保
      if (!normalized[GLOBAL_PROJECT_KEY]) {
        normalized[GLOBAL_PROJECT_KEY] = {
          [DEFAULT_LAYOUT_KEY]: makeEmptyLayout(),
        };
      }
      return { layouts: normalized };
    }

    // v2 shape (flat). 旧値を __legacy__ に退避、新 project は空状態。
    const legacyInner: Record<string, SessionLayout> = {};
    for (const [sid, layout] of entries) {
      legacyInner[sid] = normalizeLayout(layout as SessionLayout);
    }
    return {
      layouts: {
        [LEGACY_PROJECT_KEY]: legacyInner,
        [GLOBAL_PROJECT_KEY]: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() },
      },
    };
  }

  // v1 shape: top level に { slots, layout }
  const legacyLayout = normalizeLayout({
    slots:
      Array.isArray(old.slots) && old.slots.length === MAX_WORKSPACE_SLOTS
        ? old.slots.slice()
        : Array.from({ length: MAX_WORKSPACE_SLOTS }, () => null),
    layout: (old.layout as WorkspaceLayout) ?? "2h",
  } as SessionLayout);
  return {
    layouts: {
      [LEGACY_PROJECT_KEY]: { [DEFAULT_LAYOUT_KEY]: legacyLayout },
      [GLOBAL_PROJECT_KEY]: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() },
    },
  };
}

/**
 * 指定 (projectKey, sessionKey) の SessionLayout を取得（immutable）。なければ
 * undefined を返す。
 */
function readLayout(
  layouts: Record<string, Record<string, SessionLayout>>,
  projectKey: string,
  sessionKey: string
): SessionLayout | undefined {
  return layouts[projectKey]?.[sessionKey];
}

/**
 * layouts の (projectKey, sessionKey) に新 SessionLayout をセットした新 map を返す。
 */
function writeLayout(
  layouts: Record<string, Record<string, SessionLayout>>,
  projectKey: string,
  sessionKey: string,
  next: SessionLayout
): Record<string, Record<string, SessionLayout>> {
  const prevInner = layouts[projectKey] ?? {};
  return {
    ...layouts,
    [projectKey]: { ...prevInner, [sessionKey]: next },
  };
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      layouts: {
        [GLOBAL_PROJECT_KEY]: { [DEFAULT_LAYOUT_KEY]: makeEmptyLayout() },
      },

      setSlot: (slotIndex, content) =>
        set((s) => {
          if (slotIndex < 0 || slotIndex >= MAX_WORKSPACE_SLOTS) return s;
          const { projectKey, sessionKey } = getCurrentLayoutKeys();
          const cur =
            readLayout(s.layouts, projectKey, sessionKey) ?? makeEmptyLayout();
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
            layouts: writeLayout(s.layouts, projectKey, sessionKey, {
              ...cur,
              slots: next,
            }),
          };
        }),

      removeByRefId: (kind, refId) =>
        set((s) => {
          // v1.10.0 / DEC-055: 削除時は **全 project × 全 session** layouts から該当
          // refId を除去。chip が削除された後も別 project/session の slot に stale
          // 参照が残ると、切替時に「存在しない chat/file/pty」が描画されてしまうため。
          const nextLayouts: Record<string, Record<string, SessionLayout>> = {};
          for (const [pk, inner] of Object.entries(s.layouts)) {
            const nextInner: Record<string, SessionLayout> = {};
            for (const [sid, layout] of Object.entries(inner)) {
              nextInner[sid] = {
                ...layout,
                slots: layout.slots.map((c) =>
                  c && c.kind === kind && c.refId === refId ? null : c
                ),
              };
            }
            nextLayouts[pk] = nextInner;
          }
          return { layouts: nextLayouts };
        }),

      setLayout: (layout) =>
        set((s) => {
          const { projectKey, sessionKey } = getCurrentLayoutKeys();
          const cur =
            readLayout(s.layouts, projectKey, sessionKey) ?? makeEmptyLayout();
          return {
            layouts: writeLayout(s.layouts, projectKey, sessionKey, {
              ...cur,
              layout,
            }),
          };
        }),

      clearAll: () =>
        set((s) => {
          const { projectKey, sessionKey } = getCurrentLayoutKeys();
          return {
            layouts: writeLayout(
              s.layouts,
              projectKey,
              sessionKey,
              makeEmptyLayout()
            ),
          };
        }),

      removeProject: (projectId) =>
        set((s) => {
          if (!projectId || !(projectId in s.layouts)) return s;
          const next = { ...s.layouts };
          delete next[projectId];
          return { layouts: next };
        }),

      repairDeadTerminalRefs: (livePtyIds) => {
        const live = new Set(livePtyIds);
        let repaired = 0;
        set((s) => {
          const nextLayouts: Record<string, Record<string, SessionLayout>> = {};
          for (const [pk, inner] of Object.entries(s.layouts)) {
            const nextInner: Record<string, SessionLayout> = {};
            for (const [sid, layout] of Object.entries(inner)) {
              const nextSlots = layout.slots.map((c) => {
                if (c && c.kind === "terminal" && !live.has(c.refId)) {
                  repaired++;
                  return null;
                }
                return c;
              });
              nextInner[sid] = { ...layout, slots: nextSlots };
            }
            nextLayouts[pk] = nextInner;
          }
          if (repaired === 0) return s;
          return { layouts: nextLayouts };
        });
        return repaired;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 3,
      migrate: (persisted, version) => {
        if (version < 3) {
          const migrated = migrateFromV1OrV2(persisted);
          return migrated as WorkspaceLayoutState;
        }
        return persisted as WorkspaceLayoutState;
      },
    }
  )
);

// ---------------------------------------------------------------------------
// Helper hooks: current project × session の layout を subscribe する。
// component はこれらを経由して slots / layout を読む。
// ---------------------------------------------------------------------------

/**
 * current project × session に対応する (projectKey, sessionKey) を subscribe
 * （project/session 切替で変化）。hooks 内部で project/session/layout をまとめて
 * subscribe するための基盤。
 */
function useCurrentLayoutKeys(): { projectKey: string; sessionKey: string } {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const sid = useSessionStore((s) => s.currentSessionId);
  return {
    projectKey: activeProjectId ?? GLOBAL_PROJECT_KEY,
    sessionKey: sid ?? DEFAULT_LAYOUT_KEY,
  };
}

/**
 * 現在 project × session の slots を subscribe。project/session 切替で自動的に
 * 新 project/session の slots に切り替わる。参照が変わらなければ React は再レンダ
 * しない。
 */
export function useCurrentSlots(): Array<SlotContent | null> {
  const { projectKey, sessionKey } = useCurrentLayoutKeys();
  return useWorkspaceLayoutStore((s) => {
    const layout = s.layouts[projectKey]?.[sessionKey];
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
 * 指定 slotIndex の current project × session content を subscribe する専用 hook。
 * SlotContainer が使う（slot 1 件だけの購読で無駄な rerender を抑制）。
 */
export function useCurrentSlotContent(
  slotIndex: number
): SlotContent | null {
  const { projectKey, sessionKey } = useCurrentLayoutKeys();
  return useWorkspaceLayoutStore((s) => {
    const layout = s.layouts[projectKey]?.[sessionKey];
    return layout?.slots[slotIndex] ?? null;
  });
}

/**
 * 現在 project × session の layout mode を subscribe。
 */
export function useCurrentLayout(): WorkspaceLayout {
  const { projectKey, sessionKey } = useCurrentLayoutKeys();
  return useWorkspaceLayoutStore(
    (s) => s.layouts[projectKey]?.[sessionKey]?.layout ?? "2h"
  );
}
