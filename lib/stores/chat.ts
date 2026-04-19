"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Chat ドメインの Zustand store。
 *
 * PM-135 で設計。Agent SDK sidecar から stream で流れてくる message / tool_use /
 * done イベントを appendMessage / updateStreamingMessage / appendToolUse 経由で
 * state に積む。messages / attachments / streaming 等の揮発性 state は
 * persist 対象外（session ごとにリセット）。
 *
 * PRJ-012 Stage 1: GUI から指定された作業ディレクトリ (`cwd`) のみを
 * localStorage key `ccmux-ide-gui:chat-cwd` に persist し、アプリ再起動後も
 * 同じ作業ディレクトリで Claude を起動できるようにする（partialize で cwd
 * 以外を除外）。SQLite history（Chunk B）は別経路で永続化される。
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
  /**
   * Week7 PM-232: SearchPalette 等からスクロール要求された message id。
   * MessageList の useEffect が DOM を scrollIntoView し終えたら null に戻す。
   * 同じ id を連続指定しても effect が走るよう、「一度使ったら消す」モデル。
   */
  scrollTargetMessageId: string | null;
  /**
   * Week7 PM-232: 4 秒間ハイライト表示する message id。
   * 検索結果からジャンプしたメッセージに `ring-*` を重ねるために使う。
   */
  highlightedMessageId: string | null;
  /**
   * Week7 PM-262 (Chunk 3): 現在の Agent SDK 作業ディレクトリ。
   *
   * worktree 切替 / プロジェクト切替で `setCwd(path)` される。`null` の場合は
   * sidecar 側の既定 cwd が使われる（start_agent_sidecar の `cwd` 引数未指定相当）。
   *
   * NOTE: 本 state を変更しただけでは sidecar は自動再起動しない。
   *   `ChatPanel` 側で `cwd` 変化を watch し、`stop_agent_sidecar` →
   *   `start_agent_sidecar({ cwd })` を呼び直す必要がある。
   *   Week7 Chunk 1（SearchPalette 本体）と合流時に `/review` フェーズで
   *   ChatPanel useEffect に反映する申し送り。
   */
  cwd: string | null;

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
  /**
   * Week7 PM-232: SearchPalette から呼ばれる。対象 message へスクロール要求 +
   * 4 秒ハイライトのトリガーをまとめてセットする。
   */
  scrollToMessageId: (id: string) => void;
  /** ハイライトを消す（MessageList 側の setTimeout で呼ばれる）。 */
  clearHighlight: () => void;
  /** scrollTarget のみ消す（scrollIntoView 実行後に呼ぶ）。 */
  clearScrollTarget: () => void;
  /**
   * Week7 PM-262: 作業ディレクトリを更新する（worktree 切替等で呼ばれる）。
   * 同じ path を再指定しても state.cwd 参照の identity は変わらないため、
   * watcher 側は `prevCwd !== nextCwd` で判定する。
   */
  setCwd: (path: string | null) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      streaming: false,
      attachments: [],
      currentSessionId: null,
      scrollTargetMessageId: null,
      highlightedMessageId: null,
      cwd: null,

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
        set((state) => ({
          attachments: [...state.attachments, attachment],
        })),

      removeAttachment: (id) =>
        set((state) => ({
          attachments: state.attachments.filter((a) => a.id !== id),
        })),

      clearAttachments: () => set({ attachments: [] }),

      clearSession: () =>
        set({
          messages: [],
          attachments: [],
          streaming: false,
          scrollTargetMessageId: null,
          highlightedMessageId: null,
        }),

      setSessionId: (currentSessionId) => set({ currentSessionId }),

      setMessages: (messages) => set({ messages }),

      scrollToMessageId: (id) =>
        set({ scrollTargetMessageId: id, highlightedMessageId: id }),

      clearHighlight: () => set({ highlightedMessageId: null }),

      clearScrollTarget: () => set({ scrollTargetMessageId: null }),

      setCwd: (cwd) => set({ cwd }),
    }),
    {
      // PRJ-012 Stage 1: cwd だけを localStorage に永続化する。messages /
      // attachments / streaming 等の session 状態は揮発のまま維持する
      // （起動時は常に空セッションから始まるのが従来挙動と一致）。
      name: "ccmux-ide-gui:chat-cwd",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ cwd: state.cwd }),
    }
  )
);
