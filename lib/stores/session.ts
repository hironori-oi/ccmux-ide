"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type {
  Session,
  SessionSummary,
  StoredMessage,
} from "@/lib/types";
import {
  useChatStore,
  type ChatMessage,
  type ToolUseEvent,
} from "@/lib/stores/chat";
import { parseToolMessageContent } from "@/lib/tool-content-parser";

/**
 * セッション一覧ドメインの Zustand store (PM-152 / v1.18.0 DEC-064)。
 *
 * Chunk B が管轄する `~/.sumi/history.db` の内容を frontend と sync する役割。
 *
 * ## v1.18.0 (DEC-064): session 状態マーク
 *
 * Session ごとに揮発な `status` / `lastActivityAt` を保持する。pane 切替や
 * activeProjectId 変化とは完全独立で、session 自身がその状態を保持する。
 * SessionList の行右側アイコンが当該 session の status を購読することで、
 * 「A を thinking 中にしたまま B pane に切り替えても A のアイコンは消えない」
 * という UI 不具合を根治する。
 *
 * - `status: "idle" | "thinking" | "streaming" | "error"` (default `idle`)
 * - `lastActivityAt: number | null` (Unix ms)
 * - persist は **しない**（再起動で idle リセット、sidecar が running なら
 *   次 event で復元）
 */

/**
 * v1.20.0 (DEC-066): `completed` を追加。sidecar response 完了後、かつ該当
 * session がどの pane でも表示されていない間だけ保持される「未読」相当の中間
 * 状態。ユーザーが session を開いた瞬間に `idle` に戻る。
 */
export type SessionStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "completed"
  | "error";

/** session 単位の揮発状態。 */
export interface SessionVolatileState {
  status: SessionStatus;
  lastActivityAt: number | null;
  /**
   * v1.20.0 (DEC-066): 応答完了 (result / done) 時点で当該 session が pane で
   * 表示されていなかった場合に true。pane でその session を開くと false に戻る。
   * volatile (persist しない)。
   */
  hasUnread: boolean;
}

interface SessionState {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  isLoading: boolean;
  error: string | null;

  /**
   * v1.18.0 (DEC-064): session 単位の揮発状態。sessionId ごとに status と
   * lastActivityAt を保持。persist されない。fetchSessions で sessions が
   * 更新されても既存 entry は保持する (event 駆動で維持)。
   */
  volatile: Record<string, SessionVolatileState>;

  fetchSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createNewSession: (title?: string, projectPath?: string) => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  updateSessionSdkId: (
    sessionId: string,
    sdkSessionId: string | null
  ) => Promise<void>;
  purgeSessions: (sessionIds: readonly string[]) => void;

  /**
   * v1.18.0 (DEC-064): session status を設定する。pane 切替に連動しない。
   */
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /**
   * v1.18.0 (DEC-064): session の lastActivityAt を現在時刻で touch する。
   */
  touchSessionActivity: (sessionId: string) => void;
  /**
   * v1.20.0 (DEC-066): `hasUnread` flag を明示的に設定する。
   *
   * - 応答完了時 (`result`/`done`) に「pane で表示されていなければ true」
   *   をセットするのに使う。
   * - pane で該当 session を開いた時には false でクリア。
   */
  setSessionUnread: (sessionId: string, hasUnread: boolean) => void;
}

/**
 * Rust `StoredMessage` → `ChatMessage` への変換（DB 復元経路）。
 */
function toChatMessage(m: StoredMessage): ChatMessage {
  const role: "user" | "assistant" | "tool" =
    m.role === "user"
      ? "user"
      : m.role === "assistant"
        ? "assistant"
        : "tool";

  const toolUse: ToolUseEvent | undefined =
    role === "tool" ? parseToolMessageContent(m.content) ?? undefined : undefined;

  return {
    id: m.id,
    role,
    content: m.content,
    attachments:
      m.attachments.length > 0
        ? m.attachments.map((a) => ({ id: a.id, path: a.path }))
        : undefined,
    toolUse,
  };
}

async function readActiveProjectId(): Promise<string | null> {
  try {
    const mod = await import("@/lib/stores/project");
    const getState = mod.useProjectStore?.getState;
    if (typeof getState !== "function") return null;
    const s = getState();
    const id = (s as { activeProjectId?: unknown }).activeProjectId;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function seedSessionPreferences(
  sessionId: string,
  projectId: string | null,
): Promise<void> {
  if (!sessionId) return;
  try {
    const prefMod = await import("@/lib/stores/session-preferences");
    prefMod.useSessionPreferencesStore
      .getState()
      .initializeSession(
        sessionId,
        projectId,
        prefMod.HARD_DEFAULT_PREFERENCES,
      );
  } catch {
    // store 未ロード / SSR などでは黙って skip
  }
}

async function ensureSessionPreferences(
  sessionId: string,
  projectId: string | null,
): Promise<void> {
  if (!sessionId) return;
  try {
    const prefMod = await import("@/lib/stores/session-preferences");
    prefMod.useSessionPreferencesStore
      .getState()
      .ensureSessionPreferences(
        sessionId,
        projectId,
        prefMod.HARD_DEFAULT_PREFERENCES,
      );
  } catch {
    // store 未ロード / SSR などでは黙って skip
  }
}

const DEFAULT_VOLATILE: SessionVolatileState = {
  status: "idle",
  lastActivityAt: null,
  hasUnread: false,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  error: null,
  volatile: {},

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const projectId = await readActiveProjectId();
      const args: Record<string, unknown> = {
        limit: 200,
        offset: 0,
      };
      if (projectId !== null) {
        args.projectId = projectId;
      }
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      set({ sessions: list, isLoading: false });
    } catch (e) {
      set({
        error: String(e),
        isLoading: false,
      });
    }
  },

  loadSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const msgs = await callTauri<StoredMessage[]>("get_session_messages", {
        sessionId: id,
      });
      const chatMessages = msgs.map(toChatMessage);
      // v1.18.0: session 単位 state に直接 hydrate。
      useChatStore.getState().hydrateSessionMessages(id, chatMessages);
      // 現在の active pane に session を attach する（呼出側は handleLoad で
      // setActivePane を事前に呼んでいる）。
      const chat = useChatStore.getState();
      chat.setPaneSession(chat.activePaneId, id);
      set({ currentSessionId: id, isLoading: false });
      const owningProjectId =
        get().sessions.find((s) => s.id === id)?.projectId ?? null;
      void ensureSessionPreferences(id, owningProjectId);
      // v1.20.0 (DEC-066): session を開いたら「未読」をクリア、completed を idle に
      const cur = get().volatile[id];
      if (cur?.hasUnread) {
        get().setSessionUnread(id, false);
      }
      if (cur?.status === "completed") {
        get().setSessionStatus(id, "idle");
      }
    } catch (e) {
      set({
        error: String(e),
        isLoading: false,
      });
    }
  },

  createNewSession: async (title, projectPath) => {
    set({ isLoading: true, error: null });
    try {
      const projectId = await readActiveProjectId();
      if (!projectId) {
        const err = new Error(
          "プロジェクトが選択されていません。左のレールからプロジェクトを作成/選択してから新規セッションを作成してください。"
        );
        set({ error: err.message, isLoading: false });
        throw err;
      }
      const session = await callTauri<Session>("create_session", {
        title: title ?? null,
        projectPath: projectPath ?? null,
        projectId,
      });
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      // v1.18.0: session 単位 message store に空 entry を用意。
      useChatStore.getState().hydrateSessionMessages(session.id, []);
      // 現在の active pane に新 session を attach。
      const chat = useChatStore.getState();
      chat.setPaneSession(chat.activePaneId, session.id);
      set({
        sessions: list,
        currentSessionId: session.id,
        isLoading: false,
        volatile: {
          ...get().volatile,
          [session.id]: { status: "idle", lastActivityAt: null, hasUnread: false },
        },
      });
      void seedSessionPreferences(session.id, projectId);
      return session;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      try {
        await callTauri<void>("stop_agent_sidecar", { sessionId: id });
      } catch {
        // silent fallback
      }
      await callTauri<void>("delete_session", { sessionId: id });
      const projectId = await readActiveProjectId();
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      const wasCurrent = get().currentSessionId === id;
      // v1.18.0: session 単位 state から削除
      useChatStore.getState().purgeSessions([id]);
      const nextVolatile = { ...get().volatile };
      delete nextVolatile[id];
      set({
        sessions: list,
        currentSessionId: wasCurrent ? null : get().currentSessionId,
        isLoading: false,
        volatile: nextVolatile,
      });
      void (async () => {
        try {
          const mod = await import("@/lib/stores/session-preferences");
          mod.useSessionPreferencesStore.getState().clearSession(id);
        } catch {
          // store 未ロード等では skip
        }
      })();
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  renameSession: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      await callTauri<void>("rename_session", { sessionId: id, title });
      const projectId = await readActiveProjectId();
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      set({ sessions: list, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  purgeSessions: (sessionIds) => {
    if (sessionIds.length === 0) return;
    for (const sid of sessionIds) {
      void callTauri<void>("stop_agent_sidecar", { sessionId: sid }).catch(() => {
        // silent fallback
      });
    }
    const ids = new Set(sessionIds);
    const state = get();
    const nextSessions = state.sessions.filter((s) => !ids.has(s.id));
    const wasCurrent =
      state.currentSessionId !== null && ids.has(state.currentSessionId);
    // chat store 側は purgeSessions で一括クリアされる（purge-project で呼ばれる）。
    // 本 action は session store cache の整合のみ取る。
    const nextVolatile = { ...state.volatile };
    for (const sid of sessionIds) {
      delete nextVolatile[sid];
    }
    set({
      sessions: nextSessions,
      currentSessionId: wasCurrent ? null : state.currentSessionId,
      volatile: nextVolatile,
    });
  },

  updateSessionSdkId: async (sessionId, sdkSessionId) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, sdkSessionId } : s
      ),
    }));
    try {
      await callTauri<void>("update_session_sdk_id", {
        sessionId,
        sdkSessionId,
      });
    } catch (e) {
      set({ error: String(e) });
      // eslint-disable-next-line no-console
      console.warn(
        `[session] update_session_sdk_id 失敗 (id=${sessionId}, sdk=${sdkSessionId}):`,
        e
      );
    }
  },

  setSessionStatus: (sessionId, status) => {
    if (!sessionId) return;
    set((state) => {
      const cur = state.volatile[sessionId] ?? DEFAULT_VOLATILE;
      if (cur.status === status) return state;
      return {
        volatile: {
          ...state.volatile,
          [sessionId]: { ...cur, status },
        },
      };
    });
    // v1.20.0 (DEC-066): project 集約を反映
    void recomputeProjectStatusForSession(sessionId);
  },

  touchSessionActivity: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      const cur = state.volatile[sessionId] ?? DEFAULT_VOLATILE;
      return {
        volatile: {
          ...state.volatile,
          [sessionId]: { ...cur, lastActivityAt: Date.now() },
        },
      };
    });
  },

  setSessionUnread: (sessionId, hasUnread) => {
    if (!sessionId) return;
    set((state) => {
      const cur = state.volatile[sessionId] ?? DEFAULT_VOLATILE;
      if (cur.hasUnread === hasUnread) return state;
      return {
        volatile: {
          ...state.volatile,
          [sessionId]: { ...cur, hasUnread },
        },
      };
    });
    void recomputeProjectStatusForSession(sessionId);
  },
}));

/**
 * v1.20.0 (DEC-066): 指定 session が属する project の集約 status を再計算する。
 *
 * session ↔ project 双方向循環を避けるため、`useProjectStore.getState()` 経由で
 * 呼び、project store 側が持つ `setProjectStatus` に集約結果を渡す。
 */
async function recomputeProjectStatusForSession(
  sessionId: string
): Promise<void> {
  try {
    const sessions = useSessionStore.getState().sessions;
    const target = sessions.find((s) => s.id === sessionId);
    const projectId = target?.projectId ?? null;
    if (!projectId) return;

    const { useProjectStore } = await import("@/lib/stores/project");
    const recompute = useProjectStore.getState().recomputeProjectStatus;
    if (typeof recompute === "function") {
      recompute(projectId);
    }
  } catch {
    // project store 未ロード等では silent skip
  }
}

/**
 * PM-830: 指定 sessionId の sdkSessionId を session store cache から引く。
 */
export function getSdkSessionIdFromCache(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const list = useSessionStore.getState().sessions;
  const found = list.find((s) => s.id === sessionId);
  return found?.sdkSessionId ?? null;
}

/**
 * v1.18.0 (DEC-064): 指定 sessionId の揮発状態 (status / lastActivityAt) を取得する
 * selector ヘルパ。固定参照の DEFAULT_VOLATILE を fallback にするため React 19 +
 * zustand の infinite-loop を起こさない。
 */
export function selectSessionVolatile(
  state: SessionState,
  sessionId: string | null
): SessionVolatileState {
  if (!sessionId) return DEFAULT_VOLATILE;
  return state.volatile[sessionId] ?? DEFAULT_VOLATILE;
}

export { DEFAULT_VOLATILE };

// ---------------------------------------------------------------------------
// v5 Chunk B / DEC-032: useProjectStore.activeProjectId 変更の subscribe
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  void (async () => {
    try {
      const mod = await import("@/lib/stores/project");
      const store = mod.useProjectStore;
      if (!store || typeof store.subscribe !== "function") return;

      let prev: string | null = (() => {
        try {
          const s = store.getState();
          const id = (s as { activeProjectId?: unknown }).activeProjectId;
          return typeof id === "string" && id.length > 0 ? id : null;
        } catch {
          return null;
        }
      })();

      store.subscribe((state: unknown) => {
        const raw = (state as { activeProjectId?: unknown }).activeProjectId;
        const next: string | null =
          typeof raw === "string" && raw.length > 0 ? raw : null;
        if (next === prev) return;
        prev = next;
        void useSessionStore.getState().fetchSessions();
      });
    } catch {
      // useProjectStore が未ロード / 存在しない場合は黙って skip
    }
  })();
}
