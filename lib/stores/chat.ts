"use client";

import { create } from "zustand";

/**
 * Chat ドメインの Zustand store。
 *
 * PM-135 で設計。Agent SDK sidecar から stream で流れてくる message / tool_use /
 * done イベントを appendMessage / updateStreamingMessage / appendToolUse 経由で
 * state に積む。永続化は Chunk B（src-tauri の SQLite history）で行うので、
 * persist middleware は使わない（メモリ上のセッション状態のみ保持）。
 */

/** 添付画像 1 件分 */
export interface Attachment {
  id: string;
  /** ローカルファイルの絶対パス（Tauri backend が返すもの） */
  path: string;
  /** 任意。サムネ表示用の webview 用 URL（convertFileSrc で生成） */
  preview?: string;
}

/** tool_use の 1 イベント */
export interface ToolUseEvent {
  /** tool の名前（"Read" / "Edit" / "Bash" / ...） */
  name: string;
  /** tool の入力（shape は tool ごとに異なる） */
  input: Record<string, unknown>;
  /** 実行ステータス */
  status: "pending" | "success" | "error";
  /** 実行結果（文字列 or オブジェクト）。error 時は error message */
  output?: string;
}

/** チャット 1 メッセージ */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** streaming 中フラグ（末尾カーソル点滅に使う） */
  streaming?: boolean;
  /** user message 用: 送信時点での添付画像 */
  attachments?: Attachment[];
  /** tool role 用: tool_use イベントの詳細 */
  toolUse?: ToolUseEvent;
}

interface ChatState {
  /** セッション内の全メッセージ（時系列） */
  messages: ChatMessage[];
  /** 送信〜done までのフラグ */
  streaming: boolean;
  /** 現在の入力欄に添付されている画像（送信でクリア） */
  attachments: Attachment[];
  /** SQLite セッション ID（Chunk B が供給） */
  currentSessionId: string | null;

  /** 1 メッセージ追加 */
  appendMessage: (message: ChatMessage) => void;
  /** streaming assistant メッセージに delta を追記 */
  updateStreamingMessage: (id: string, delta: string) => void;
  /** streaming フラグ切替 */
  setStreaming: (streaming: boolean) => void;
  /** streaming メッセージ確定（cursor 消す） */
  finalizeStreamingMessage: (id: string) => void;
  /** tool_use メッセージを新規追加（id は tool 実行単位で一意） */
  appendToolUse: (id: string, event: ToolUseEvent) => void;
  /** tool_use のステータス / 出力を事後更新 */
  updateToolUseStatus: (
    id: string,
    status: ToolUseEvent["status"],
    output?: string
  ) => void;
  /** 画像添付 */
  appendAttachment: (attachment: Attachment) => void;
  /** 画像削除 */
  removeAttachment: (id: string) => void;
  /** 送信完了後に添付をクリア（履歴は残す） */
  clearAttachments: () => void;
  /** セッション切替: メッセージも全リセット */
  clearSession: () => void;
  /** SQLite session id を紐付け */
  setSessionId: (id: string | null) => void;
  /** SQLite 等からロードしたメッセージで置換（Chunk B 用） */
  setMessages: (messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  streaming: false,
  attachments: [],
  currentSessionId: null,

  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateStreamingMessage: (id, delta) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id
          ? { ...m, content: m.content + delta, streaming: true }
          : m
      ),
    })),

  setStreaming: (streaming) => set({ streaming }),

  finalizeStreamingMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      ),
    })),

  appendToolUse: (id, event) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: "tool",
          content: "",
          toolUse: event,
        },
      ],
    })),

  updateToolUseStatus: (id, status, output) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id && m.toolUse
          ? { ...m, toolUse: { ...m.toolUse, status, output } }
          : m
      ),
    })),

  appendAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),

  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    })),

  clearAttachments: () => set({ attachments: [] }),

  clearSession: () =>
    set({ messages: [], attachments: [], streaming: false }),

  setSessionId: (currentSessionId) => set({ currentSessionId }),

  setMessages: (messages) => set({ messages }),
}));
