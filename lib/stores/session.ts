"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type {
  Session,
  SessionSummary,
  StoredMessage,
} from "@/lib/types";
import { useChatStore } from "@/lib/stores/chat";

/**
 * セッション一覧ドメインの Zustand store (PM-152)。
 *
 * Chunk B が管轄する `~/.ccmux-ide-gui/history.db` の内容を frontend と sync する
 * 役割。チャット本体の state (messages / streaming / attachments) は
 * `useChatStore`（Chunk A）が持ち、こちらは **サイドバー側のセッション一覧 +
 * currentSessionId の発信源** に徹する。
 *
 * 接続ポイント:
 *  - `loadSession(id)` / `createNewSession()` / `deleteSession(id)` は完了時に
 *    `useChatStore.getState().setSessionId(...)` を呼び、chat 側の以降の
 *    `append_message` をこの session id に紐付ける。
 *  - `loadSession` は SQLite から取得したメッセージを `StoredMessage → ChatMessage`
 *    に map して `setMessages(...)` に渡す（画像添付は `path` のみ保持、webview 用
 *    URL 生成は画面側 useEffect で `convertFileSrc` を使って行う想定）。
 */

interface SessionState {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  isLoading: boolean;
  /** 最新の fetch でエラーが出たときのメッセージ（UI で banner 表示用） */
  error: string | null;

  /** SQLite から session 一覧を取得して state に反映 */
  fetchSessions: () => Promise<void>;
  /** 指定 session のメッセージをロードして chat store に投入 */
  loadSession: (id: string) => Promise<void>;
  /** 新規 session を作成 → current に設定 → chat store もクリア */
  createNewSession: (title?: string, projectPath?: string) => Promise<Session>;
  /** session 削除 → current と被っていれば chat store もクリア */
  deleteSession: (id: string) => Promise<void>;
  /** session rename → 一覧を再取得 */
  renameSession: (id: string, title: string) => Promise<void>;
}

/**
 * Rust `StoredMessage` → Chunk A `ChatMessage` への変換。
 *
 * role は Rust 側が "user" / "assistant" / "tool" / "system" を混在で持つため、
 * Chunk A の型に合わせて単純 cast する（"tool_use" / "tool_result" / "system" は
 * "tool" に寄せる）。
 */
function toChatMessage(m: StoredMessage): {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  attachments?: { id: string; path: string }[];
} {
  const role: "user" | "assistant" | "tool" =
    m.role === "user"
      ? "user"
      : m.role === "assistant"
        ? "assistant"
        : "tool";
  return {
    id: m.id,
    role,
    content: m.content,
    attachments:
      m.attachments.length > 0
        ? m.attachments.map((a) => ({ id: a.id, path: a.path }))
        : undefined,
  };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  error: null,

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const list = await callTauri<SessionSummary[]>("list_sessions", {
        limit: 200,
        offset: 0,
      });
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
      // Chunk A の chat store に流し込む
      useChatStore.getState().clearSession();
      useChatStore.getState().setMessages(chatMessages);
      useChatStore.getState().setSessionId(id);
      set({ currentSessionId: id, isLoading: false });
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
      const session = await callTauri<Session>("create_session", {
        title: title ?? null,
        projectPath: projectPath ?? null,
      });
      // 直後に一覧を再取得して state を同期
      const list = await callTauri<SessionSummary[]>("list_sessions", {
        limit: 200,
        offset: 0,
      });
      // chat store をクリアして session id を紐付け
      useChatStore.getState().clearSession();
      useChatStore.getState().setSessionId(session.id);
      set({
        sessions: list,
        currentSessionId: session.id,
        isLoading: false,
      });
      return session;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await callTauri<void>("delete_session", { sessionId: id });
      const list = await callTauri<SessionSummary[]>("list_sessions", {
        limit: 200,
        offset: 0,
      });
      const wasCurrent = get().currentSessionId === id;
      if (wasCurrent) {
        useChatStore.getState().clearSession();
        useChatStore.getState().setSessionId(null);
      }
      set({
        sessions: list,
        currentSessionId: wasCurrent ? null : get().currentSessionId,
        isLoading: false,
      });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  renameSession: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      await callTauri<void>("rename_session", { sessionId: id, title });
      const list = await callTauri<SessionSummary[]>("list_sessions", {
        limit: 200,
        offset: 0,
      });
      set({ sessions: list, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },
}));
