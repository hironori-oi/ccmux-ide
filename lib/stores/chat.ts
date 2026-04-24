"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { callTauri } from "@/lib/tauri-api";

/**
 * Chat ドメインの Zustand store。
 *
 * ## v1.18.0 (DEC-064): Session 単位の message 保存に re-architect
 *
 * 旧構造 (v1.17.0 まで): `panes[paneId].messages` で pane 単位に messages を
 * 保存し、sidecar event は pane を逆引きして dispatch していた。結果として、
 * session A 送信中に pane を session B に切替えると、A の応答が B を表示中の
 * pane に誤表示される UI 混線が発生していた (オーナー報告)。
 *
 * 新構造 (v1.18.0): **session 単位** の global map に変更する。
 *
 * - `sessionMessages: Record<sessionId, ChatMessage[]>` — session の messages
 * - `sessionStreaming: Record<sessionId, boolean>`      — streaming flag
 * - `sessionAttachments: Record<sessionId, Attachment[]>` — 入力欄 attachment
 * - `sessionActivity: Record<sessionId, ChatActivity>`   — thinking/streaming 等
 *
 * pane は **viewport only**：`currentSessionId` / `creatingSessionId` /
 * `scrollTargetMessageId` / `highlightedMessageId` のみ保持する。pane が
 * どの session を表示しているかが変わるだけで、session 自身の state は
 * pane とは完全に独立に維持される。
 *
 * sidecar event は session_id で直接 append するため、該当 session が
 * 現在どの pane にも表示されていなくても messages は session history として
 * 積まれる。次回その session を pane で open した時に selector が自動で
 * 描画する。
 *
 * ### persist
 *
 * - 永続化対象: `activePaneId` と pane viewport (`currentSessionId` 等) のみ
 * - sessionMessages / sessionStreaming / sessionAttachments / sessionActivity は
 *   **全て揮発**（DB が source of truth、session を open すれば load される）
 * - persist version +1 (2)、migrate で旧 shape を破棄
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

/**
 * Claude の現在の活動状態を表す discriminated union。
 * ActivityIndicator コンポーネントが購読して可視化に使う。
 */
export type ChatActivity =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "streaming" }
  | { kind: "tool_use"; toolName: string; toolInput?: unknown }
  | { kind: "complete" }
  | { kind: "error"; message?: string };

/**
 * 1 pane 分の viewport 状態（messages / streaming 等は持たない）。
 *
 * v1.18.0 (DEC-064) 以降、messages / streaming / attachments / activity は
 * session 単位の global map に移設された。pane は「この viewport が現在
 * 表示している session」の identity のみ保持する。
 */
export interface ChatPaneState {
  /** SQLite セッション ID（表示中の session、mutable） */
  currentSessionId: string | null;
  /** SearchPalette 等からスクロール要求された message id */
  scrollTargetMessageId: string | null;
  /** 4 秒間ハイライト表示する message id */
  highlightedMessageId: string | null;
  /**
   * PM-979: 作成時にアクティブだった session id（immutable、Tray フィルタ用）。
   */
  creatingSessionId?: string | null;
}

/** 最初の pane id（必ず存在する = 互換のための固定 id） */
export const DEFAULT_PANE_ID = "main";

/** 同時に開ける最大 pane 数。 */
export const MAX_PANES = 4;

/** 空の session-level activity（default "idle"）。 */
const IDLE_ACTIVITY: ChatActivity = { kind: "idle" };

interface ChatState {
  /** pane ごとの viewport（初期は main 1 件） */
  panes: Record<string, ChatPaneState>;
  /** フォーカス中の pane id */
  activePaneId: string;

  /**
   * v1.18.0: session 単位 message store（global map）。
   * key = sessionId、value = messages の時系列配列。
   * persist しない（DB が source of truth）。
   */
  sessionMessages: Record<string, ChatMessage[]>;
  /**
   * v1.18.0: session 単位 streaming flag。persist しない。
   */
  sessionStreaming: Record<string, boolean>;
  /**
   * v1.18.0: session 単位 attachment（送信前の入力欄に添付中の画像）。
   * persist しない。
   */
  sessionAttachments: Record<string, Attachment[]>;
  /**
   * v1.18.0: session 単位 activity（Claude の現在の活動状態）。
   * persist しない。
   */
  sessionActivity: Record<string, ChatActivity>;

  /**
   * PRJ-012 v3.5.9 Chunk D (Project Switch History): project 切替時の pane
   * viewport スナップショット。panes[*] の viewport 情報のみを保存する。
   * messages / streaming は session 単位なので保存対象外。
   */
  projectSnapshots: Record<string, Record<string, ChatPaneState>>;

  // --- pane lifecycle ---
  addPane: () => string;
  removePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;

  // --- project snapshot ---
  saveProjectSnapshot: (projectId: string) => void;
  restoreProjectSnapshot: (projectId: string) => boolean;
  clearProjectSnapshot: (projectId: string) => void;

  /**
   * v1.12.0 (DEC-058) / v1.18.0 (DEC-064): 指定 session 群を state から一掃する。
   *
   * - `sessionMessages[sid]` / `sessionStreaming[sid]` / `sessionAttachments[sid]`
   *   / `sessionActivity[sid]` を削除
   * - `panes[*].currentSessionId` が対象なら null に戻す
   * - `panes[*].creatingSessionId` が対象なら null に戻す
   * - `projectSnapshots[*][*]` にも同様の処理
   */
  purgeSessions: (sessionIds: readonly string[]) => void;

  /**
   * v1.18.0: pane viewport 1 件を updater で更新する util（messages 等は触らない）。
   */
  applyToPane: (paneId: string, updater: (pane: ChatPaneState) => ChatPaneState) => void;

  // --- session 単位 action ---

  /**
   * 指定 session に message を 1 件 append。pane は不問。
   * user / 完成済 assistant / 完成済 tool は DB にも永続化する。
   */
  appendMessage: (sessionId: string, message: ChatMessage) => void;
  /** streaming 中 assistant message の content に delta を追記する。 */
  updateStreamingMessage: (sessionId: string, messageId: string, delta: string) => void;
  /** streaming 中の message を確定（streaming=false）し DB 永続化。 */
  finalizeStreamingMessage: (sessionId: string, messageId: string) => void;
  /** tool_use event を session の message list に追加（DB 永続化は updateToolUseStatus 時）。 */
  appendToolUse: (sessionId: string, messageId: string, event: ToolUseEvent) => void;
  /** tool_use status を更新（success/error で DB 永続化）。 */
  updateToolUseStatus: (
    sessionId: string,
    messageId: string,
    status: ToolUseEvent["status"],
    output?: string
  ) => void;
  /** session の streaming flag を設定。 */
  setSessionStreaming: (sessionId: string, streaming: boolean) => void;
  /** session の activity を設定。 */
  setSessionActivity: (sessionId: string, activity: ChatActivity) => void;
  /** session の messages / streaming / activity を空にクリア。 */
  clearSessionMessages: (sessionId: string) => void;
  /** DB load 経路: session の messages を一括 set（既に永続化済 id として記録）。 */
  hydrateSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;

  // --- session attachment ---
  appendAttachment: (sessionId: string, attachment: Attachment) => void;
  removeAttachment: (sessionId: string, attachmentId: string) => void;
  clearAttachments: (sessionId: string) => void;

  // --- pane viewport action ---

  /** pane の currentSessionId を更新。project の lastSessionId も write back。 */
  setPaneSession: (paneId: string, sessionId: string | null) => void;
  /** pane の scroll jump 要求 */
  scrollToMessageId: (paneId: string, messageId: string) => void;
  clearHighlight: (paneId: string) => void;
  clearScrollTarget: (paneId: string) => void;

  /**
   * v1.18.0 後方互換 shim: paneId 経由で現在の pane の currentSessionId を引いて
   * `clearSessionMessages` を呼ぶ。ClearSessionDialog 等の旧呼出元向け。
   */
  clearSessionForPane: (paneId?: string) => void;
}

/** 空の pane state を生成する（viewport only）。 */
function makeEmptyPane(): ChatPaneState {
  return {
    currentSessionId: null,
    scrollTargetMessageId: null,
    highlightedMessageId: null,
  };
}

/** panes map 内の 1 pane を updater で更新する util。 */
function updatePane(
  panes: Record<string, ChatPaneState>,
  paneId: string,
  updater: (p: ChatPaneState) => ChatPaneState
): Record<string, ChatPaneState> {
  const cur = panes[paneId];
  if (!cur) return panes;
  const next = updater(cur);
  if (next === cur) return panes;
  return { ...panes, [paneId]: next };
}

/** 新しい pane id を生成。 */
function newPaneId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pane-${crypto.randomUUID()}`;
  }
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** pane viewport を deep copy する（snapshot 用）。 */
function clonePaneState(p: ChatPaneState): ChatPaneState {
  return {
    currentSessionId: p.currentSessionId,
    scrollTargetMessageId: p.scrollTargetMessageId,
    highlightedMessageId: p.highlightedMessageId,
    creatingSessionId: p.creatingSessionId,
  };
}

/** panes map 全体を deep copy する（snapshot save/restore 用）。 */
function clonePanes(
  panes: Record<string, ChatPaneState>
): Record<string, ChatPaneState> {
  const out: Record<string, ChatPaneState> = {};
  for (const [id, p] of Object.entries(panes)) {
    out[id] = clonePaneState(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB 永続化（append_message invoke ラッパ、v3.5.13 から踏襲）
// ---------------------------------------------------------------------------

/**
 * DB に既に永続化済の message id セット。二重 INSERT を防ぐ。
 */
const persistedIds: Set<string> = new Set();

function normalizeRoleForDb(role: ChatMessage["role"]): string {
  return role;
}

/**
 * 1 message を Rust `append_message` に書き込む（DB 永続化）。v3.5.13 から踏襲。
 *
 * v1.18.0: sessionId は caller が直接指定する。従来は pane.currentSessionId
 * から引いていたが、session 単位 store に移行したため呼出経路が整理された。
 */
export async function persistMessageToDb(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  if (!sessionId) return;
  if (persistedIds.has(message.id)) return;
  persistedIds.add(message.id);

  const role = normalizeRoleForDb(message.role);

  let content = message.content ?? "";
  if (message.role === "tool" && message.toolUse) {
    try {
      content = JSON.stringify({
        name: message.toolUse.name,
        input: message.toolUse.input,
        status: message.toolUse.status,
        output: message.toolUse.output ?? null,
      });
    } catch {
      content = `[tool ${message.toolUse.name} ${message.toolUse.status}]`;
    }
  }

  const attachments =
    message.attachments && message.attachments.length > 0
      ? message.attachments.map((a) => ({ path: a.path, mimeType: null }))
      : [];

  try {
    await callTauri<unknown>("append_message", {
      sessionId,
      role,
      content,
      attachments,
    });
  } catch (e) {
    persistedIds.delete(message.id);
    // eslint-disable-next-line no-console
    console.warn(
      `[chat] append_message 失敗 (session=${sessionId}, id=${message.id}):`,
      e
    );
  }
}

// ---------------------------------------------------------------------------
// store 本体
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      panes: { [DEFAULT_PANE_ID]: makeEmptyPane() },
      activePaneId: DEFAULT_PANE_ID,
      sessionMessages: {},
      sessionStreaming: {},
      sessionAttachments: {},
      sessionActivity: {},
      projectSnapshots: {},

      // --- pane lifecycle ------------------------------------------------

      addPane: () => {
        const state = get();
        const paneIds = Object.keys(state.panes);
        if (paneIds.length >= MAX_PANES) {
          return state.activePaneId;
        }
        const id = newPaneId();
        let creatingSessionId: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const sessionModule = require("@/lib/stores/session") as {
            useSessionStore: {
              getState: () => { currentSessionId: string | null };
            };
          };
          creatingSessionId =
            sessionModule.useSessionStore.getState().currentSessionId;
        } catch {
          // silent fallback
        }
        const newPane = makeEmptyPane();
        newPane.creatingSessionId = creatingSessionId;
        set({
          panes: { ...state.panes, [id]: newPane },
          activePaneId: id,
        });
        return id;
      },

      removePane: (paneId) => {
        const state = get();
        const paneIds = Object.keys(state.panes);
        if (paneIds.length <= 1) return;
        if (!state.panes[paneId]) return;
        const { [paneId]: _removed, ...rest } = state.panes;
        void _removed;
        let nextActive = state.activePaneId;
        if (nextActive === paneId) {
          nextActive = Object.keys(rest)[0];
        }
        set({ panes: rest, activePaneId: nextActive });
      },

      setActivePane: (paneId) => {
        if (!get().panes[paneId]) return;
        set({ activePaneId: paneId });
      },

      // --- project snapshot ---------------------------------------------

      saveProjectSnapshot: (projectId) => {
        if (!projectId) return;
        set((state) => ({
          projectSnapshots: {
            ...state.projectSnapshots,
            [projectId]: clonePanes(state.panes),
          },
        }));
      },

      restoreProjectSnapshot: (projectId) => {
        const state = get();
        const snap = projectId ? state.projectSnapshots[projectId] : undefined;
        if (snap && Object.keys(snap).length > 0) {
          const restored = clonePanes(snap);
          const nextActive =
            restored[state.activePaneId] !== undefined
              ? state.activePaneId
              : Object.keys(restored)[0] ?? DEFAULT_PANE_ID;
          set({ panes: restored, activePaneId: nextActive });
          return true;
        }
        set({
          panes: { [DEFAULT_PANE_ID]: makeEmptyPane() },
          activePaneId: DEFAULT_PANE_ID,
        });
        return false;
      },

      clearProjectSnapshot: (projectId) => {
        if (!projectId) return;
        set((state) => {
          if (!state.projectSnapshots[projectId]) return state;
          const next = { ...state.projectSnapshots };
          delete next[projectId];
          return { projectSnapshots: next };
        });
      },

      purgeSessions: (sessionIds) => {
        if (sessionIds.length === 0) return;
        const ids = new Set(sessionIds);
        set((state) => {
          // --- session-level map ---
          let sessionMessagesChanged = false;
          let sessionStreamingChanged = false;
          let sessionAttachmentsChanged = false;
          let sessionActivityChanged = false;

          const nextSessionMessages: Record<string, ChatMessage[]> = {};
          for (const [sid, msgs] of Object.entries(state.sessionMessages)) {
            if (ids.has(sid)) {
              sessionMessagesChanged = true;
              continue;
            }
            nextSessionMessages[sid] = msgs;
          }
          const nextSessionStreaming: Record<string, boolean> = {};
          for (const [sid, v] of Object.entries(state.sessionStreaming)) {
            if (ids.has(sid)) {
              sessionStreamingChanged = true;
              continue;
            }
            nextSessionStreaming[sid] = v;
          }
          const nextSessionAttachments: Record<string, Attachment[]> = {};
          for (const [sid, v] of Object.entries(state.sessionAttachments)) {
            if (ids.has(sid)) {
              sessionAttachmentsChanged = true;
              continue;
            }
            nextSessionAttachments[sid] = v;
          }
          const nextSessionActivity: Record<string, ChatActivity> = {};
          for (const [sid, v] of Object.entries(state.sessionActivity)) {
            if (ids.has(sid)) {
              sessionActivityChanged = true;
              continue;
            }
            nextSessionActivity[sid] = v;
          }

          // --- pane viewport ---
          let panesChanged = false;
          const transformPane = (pane: ChatPaneState): ChatPaneState => {
            const hitCurrent =
              pane.currentSessionId !== null && ids.has(pane.currentSessionId);
            const hitCreating =
              pane.creatingSessionId != null && ids.has(pane.creatingSessionId);
            if (!hitCurrent && !hitCreating) return pane;
            panesChanged = true;
            return {
              ...pane,
              currentSessionId: hitCurrent ? null : pane.currentSessionId,
              creatingSessionId: hitCreating ? null : pane.creatingSessionId,
              scrollTargetMessageId: hitCurrent ? null : pane.scrollTargetMessageId,
              highlightedMessageId: hitCurrent ? null : pane.highlightedMessageId,
            };
          };

          const nextPanes: Record<string, ChatPaneState> = {};
          for (const [pid, pane] of Object.entries(state.panes)) {
            nextPanes[pid] = transformPane(pane);
          }
          const nextSnapshots: Record<string, Record<string, ChatPaneState>> = {};
          for (const [projId, snap] of Object.entries(state.projectSnapshots)) {
            const nextSnap: Record<string, ChatPaneState> = {};
            for (const [pid, pane] of Object.entries(snap)) {
              nextSnap[pid] = transformPane(pane);
            }
            nextSnapshots[projId] = nextSnap;
          }

          const anyChange =
            sessionMessagesChanged ||
            sessionStreamingChanged ||
            sessionAttachmentsChanged ||
            sessionActivityChanged ||
            panesChanged;
          if (!anyChange) return state;

          // persistedIds からも purge 対象の message id を抜いておく
          // (将来の二重書き込み可能性に備える。送信側で重複は発生しないが保守的)
          for (const sid of ids) {
            const arr = state.sessionMessages[sid];
            if (!arr) continue;
            for (const m of arr) {
              persistedIds.delete(m.id);
            }
          }

          return {
            sessionMessages: sessionMessagesChanged
              ? nextSessionMessages
              : state.sessionMessages,
            sessionStreaming: sessionStreamingChanged
              ? nextSessionStreaming
              : state.sessionStreaming,
            sessionAttachments: sessionAttachmentsChanged
              ? nextSessionAttachments
              : state.sessionAttachments,
            sessionActivity: sessionActivityChanged
              ? nextSessionActivity
              : state.sessionActivity,
            panes: panesChanged ? nextPanes : state.panes,
            projectSnapshots: nextSnapshots,
          };
        });
      },

      applyToPane: (paneId, updater) => {
        if (!paneId || typeof updater !== "function") return;
        set((state) => ({
          panes: updatePane(state.panes, paneId, updater),
        }));
      },

      // --- session 単位 action ------------------------------------------

      appendMessage: (sessionId, message) => {
        if (!sessionId || !message) return;
        set((state) => {
          const cur = state.sessionMessages[sessionId] ?? [];
          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: [...cur, message],
            },
          };
        });
        // DB 永続化: user / 確定済 assistant / 確定済 tool のみ
        const shouldPersistNow =
          message.role === "user" ||
          (message.role === "assistant" && !message.streaming);
        if (shouldPersistNow) {
          void persistMessageToDb(sessionId, message);
        }
      },

      updateStreamingMessage: (sessionId, messageId, delta) => {
        if (!sessionId || !messageId || typeof delta !== "string") return;
        set((state) => {
          const cur = state.sessionMessages[sessionId];
          if (!cur) return state;
          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: cur.map((m) =>
                m.id === messageId
                  ? { ...m, content: m.content + delta, streaming: true }
                  : m
              ),
            },
          };
        });
      },

      finalizeStreamingMessage: (sessionId, messageId) => {
        if (!sessionId || !messageId) return;
        let targetMessage: ChatMessage | null = null;
        set((state) => {
          const cur = state.sessionMessages[sessionId];
          if (!cur) return state;
          const match = cur.find((m) => m.id === messageId);
          if (match) {
            targetMessage = { ...match, streaming: false };
          }
          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: cur.map((m) =>
                m.id === messageId ? { ...m, streaming: false } : m
              ),
            },
          };
        });
        if (targetMessage) {
          void persistMessageToDb(sessionId, targetMessage);
        }
      },

      appendToolUse: (sessionId, messageId, event) => {
        if (!sessionId || !messageId || !event) return;
        set((state) => {
          const cur = state.sessionMessages[sessionId] ?? [];
          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: [
                ...cur,
                { id: messageId, role: "tool", content: "", toolUse: event },
              ],
            },
          };
        });
      },

      updateToolUseStatus: (sessionId, messageId, status, output) => {
        if (!sessionId || !messageId || !status) return;
        let targetMessage: ChatMessage | null = null;
        let statusBecameTerminal = false;
        set((state) => {
          const cur = state.sessionMessages[sessionId];
          if (!cur) return state;
          const match = cur.find((m) => m.id === messageId && m.toolUse);
          if (match && match.toolUse) {
            const nextToolUse: ToolUseEvent = {
              ...match.toolUse,
              status,
              output,
            };
            statusBecameTerminal = status === "success" || status === "error";
            if (statusBecameTerminal) {
              targetMessage = { ...match, toolUse: nextToolUse };
            }
          }
          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: cur.map((m) =>
                m.id === messageId && m.toolUse
                  ? { ...m, toolUse: { ...m.toolUse, status, output } }
                  : m
              ),
            },
          };
        });
        if (statusBecameTerminal && targetMessage) {
          void persistMessageToDb(sessionId, targetMessage);
        }
      },

      setSessionStreaming: (sessionId, streaming) => {
        if (!sessionId) return;
        set((state) => {
          if (state.sessionStreaming[sessionId] === streaming) return state;
          return {
            sessionStreaming: {
              ...state.sessionStreaming,
              [sessionId]: streaming,
            },
          };
        });
      },

      setSessionActivity: (sessionId, activity) => {
        if (!sessionId || !activity) return;
        set((state) => ({
          sessionActivity: {
            ...state.sessionActivity,
            [sessionId]: activity,
          },
        }));
      },

      clearSessionMessages: (sessionId) => {
        if (!sessionId) return;
        set((state) => {
          const next = { ...state.sessionMessages };
          delete next[sessionId];
          const nextStreaming = { ...state.sessionStreaming };
          delete nextStreaming[sessionId];
          const nextActivity = { ...state.sessionActivity };
          delete nextActivity[sessionId];
          const nextAttachments = { ...state.sessionAttachments };
          delete nextAttachments[sessionId];
          return {
            sessionMessages: next,
            sessionStreaming: nextStreaming,
            sessionActivity: nextActivity,
            sessionAttachments: nextAttachments,
          };
        });
      },

      hydrateSessionMessages: (sessionId, messages) => {
        if (!sessionId || !Array.isArray(messages)) return;
        // DB load 経路: 既に永続化済。以降の appendMessage 等で二重 INSERT
        // されないよう persistedIds に登録する。
        for (const m of messages) {
          persistedIds.add(m.id);
        }
        set((state) => ({
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: messages,
          },
        }));
      },

      // --- session attachment --------------------------------------------

      appendAttachment: (sessionId, attachment) => {
        if (!sessionId || !attachment) return;
        set((state) => {
          const cur = state.sessionAttachments[sessionId] ?? [];
          return {
            sessionAttachments: {
              ...state.sessionAttachments,
              [sessionId]: [...cur, attachment],
            },
          };
        });
      },

      removeAttachment: (sessionId, attachmentId) => {
        if (!sessionId || !attachmentId) return;
        set((state) => {
          const cur = state.sessionAttachments[sessionId];
          if (!cur) return state;
          return {
            sessionAttachments: {
              ...state.sessionAttachments,
              [sessionId]: cur.filter((a) => a.id !== attachmentId),
            },
          };
        });
      },

      clearAttachments: (sessionId) => {
        if (!sessionId) return;
        set((state) => {
          if (!state.sessionAttachments[sessionId]) return state;
          const next = { ...state.sessionAttachments };
          delete next[sessionId];
          return { sessionAttachments: next };
        });
      },

      // --- pane viewport action -----------------------------------------

      setPaneSession: (paneId, sessionId) => {
        set((state) => ({
          panes: updatePane(state.panes, paneId, (p) => ({
            ...p,
            currentSessionId: sessionId,
            // session 切替で scroll/highlight はリセットする（別 session の
            // message id を追いかけないようにする）
            scrollTargetMessageId: null,
            highlightedMessageId: null,
          })),
        }));

        // project の lastSessionId を write back（v5 Chunk C / DEC-030 互換）
        if (sessionId && typeof window !== "undefined") {
          void import("@/lib/stores/project")
            .then((mod) => {
              const storeAny = mod.useProjectStore.getState() as unknown as {
                activeProjectId: string | null;
                updateProject?: (
                  id: string,
                  patch: { lastSessionId?: string | null }
                ) => void;
              };
              if (
                storeAny.activeProjectId &&
                typeof storeAny.updateProject === "function"
              ) {
                storeAny.updateProject(storeAny.activeProjectId, {
                  lastSessionId: sessionId,
                });
              }
            })
            .catch(() => {
              // silent fallback
            });
        }
      },

      scrollToMessageId: (paneId, messageId) => {
        if (!paneId || !messageId) return;
        set((state) => ({
          panes: updatePane(state.panes, paneId, (p) => ({
            ...p,
            scrollTargetMessageId: messageId,
            highlightedMessageId: messageId,
          })),
        }));
      },

      clearHighlight: (paneId) => {
        if (!paneId) return;
        set((state) => ({
          panes: updatePane(state.panes, paneId, (p) => ({
            ...p,
            highlightedMessageId: null,
          })),
        }));
      },

      clearScrollTarget: (paneId) => {
        if (!paneId) return;
        set((state) => ({
          panes: updatePane(state.panes, paneId, (p) => ({
            ...p,
            scrollTargetMessageId: null,
          })),
        }));
      },

      clearSessionForPane: (paneId) => {
        const state = get();
        const pid = paneId ?? state.activePaneId;
        const sid = state.panes[pid]?.currentSessionId ?? null;
        if (sid) {
          get().clearSessionMessages(sid);
        }
      },
    }),
    {
      name: "ccmux-ide-gui:chat-panes",
      version: 2, // v1.18.0 (DEC-064) で schema 更新
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      // v1.18.0: viewport (pane の currentSessionId / creatingSessionId) のみ persist。
      // session-level map (messages / streaming / attachments / activity) は揮発。
      partialize: (state) => ({
        activePaneId: state.activePaneId,
        panes: Object.fromEntries(
          Object.entries(state.panes).map(([id, p]) => [
            id,
            {
              currentSessionId: p.currentSessionId ?? null,
              scrollTargetMessageId: null,
              highlightedMessageId: null,
              creatingSessionId: p.creatingSessionId ?? null,
            } satisfies ChatPaneState,
          ])
        ),
      }),
      // v1.18.0: 旧 shape (v1, panes[*].messages/streaming/attachments/activity)
      // は新構造と互換性なし。migrate で破棄して初期化する。
      migrate: (persisted, version) => {
        if (version < 2) {
          // 旧 schema は panes[*] に messages 等が混在している。破棄して初期値で開始。
          return {
            activePaneId: DEFAULT_PANE_ID,
            panes: { [DEFAULT_PANE_ID]: makeEmptyPane() },
          };
        }
        return persisted as Partial<ChatState>;
      },
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<ChatState>) };
        if (!merged.panes || Object.keys(merged.panes).length === 0) {
          merged.panes = { [DEFAULT_PANE_ID]: makeEmptyPane() };
          merged.activePaneId = DEFAULT_PANE_ID;
        }
        if (!merged.panes[merged.activePaneId]) {
          merged.activePaneId = Object.keys(merged.panes)[0] ?? DEFAULT_PANE_ID;
        }
        // 揮発 state は常に空から開始
        merged.sessionMessages = {};
        merged.sessionStreaming = {};
        merged.sessionAttachments = {};
        merged.sessionActivity = {};
        merged.projectSnapshots = {};
        return merged;
      },
    }
  )
);

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** 指定 paneId の viewport を取得。 */
export function selectPane(
  state: ChatState,
  paneId: string
): ChatPaneState | undefined {
  return state.panes[paneId];
}

/**
 * v1.18.0: 指定 paneId が現在表示している session の messages を返す。
 * session 未選択 / messages 未 load の場合は空配列（固定参照ではなく毎回新規
 * 生成なので、呼出側は memoize 用の empty 配列 fallback を別途用意する）。
 */
export function selectMessagesForPane(
  state: ChatState,
  paneId: string
): ChatMessage[] {
  const sid = state.panes[paneId]?.currentSessionId ?? null;
  if (!sid) return EMPTY_MESSAGES;
  return state.sessionMessages[sid] ?? EMPTY_MESSAGES;
}

/** v1.18.0: session 単位の messages selector。 */
export function selectMessagesForSession(
  state: ChatState,
  sessionId: string | null
): ChatMessage[] {
  if (!sessionId) return EMPTY_MESSAGES;
  return state.sessionMessages[sessionId] ?? EMPTY_MESSAGES;
}

/** v1.18.0: session 単位の streaming flag selector。 */
export function selectStreamingForSession(
  state: ChatState,
  sessionId: string | null
): boolean {
  if (!sessionId) return false;
  return state.sessionStreaming[sessionId] ?? false;
}

/** v1.18.0: session 単位の attachments selector。 */
export function selectAttachmentsForSession(
  state: ChatState,
  sessionId: string | null
): Attachment[] {
  if (!sessionId) return EMPTY_ATTACHMENTS;
  return state.sessionAttachments[sessionId] ?? EMPTY_ATTACHMENTS;
}

/** v1.18.0: session 単位の activity selector。 */
export function selectActivityForSession(
  state: ChatState,
  sessionId: string | null
): ChatActivity {
  if (!sessionId) return IDLE_ACTIVITY;
  return state.sessionActivity[sessionId] ?? IDLE_ACTIVITY;
}

/** 互換: singleton 時代の「現在の messages」を activePane から返す selector */
export function selectActivePaneMessages(state: ChatState): ChatMessage[] {
  return selectMessagesForPane(state, state.activePaneId);
}

// React 19 + zustand: selector が新しい配列/オブジェクトを返すと
// getSnapshot cache が効かず "should be cached to avoid an infinite loop" になる。
// 固定参照の空配列を selector fallback に使う。
const EMPTY_MESSAGES: ChatMessage[] = [];
Object.freeze(EMPTY_MESSAGES);
const EMPTY_ATTACHMENTS: Attachment[] = [];
Object.freeze(EMPTY_ATTACHMENTS);

// v3.3 DEC-033: 旧 persist key (`ccmux-ide-gui:chat-cwd`) は以降使用しない。
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("ccmux-ide-gui:chat-cwd");
  } catch {
    // quota / SecurityError は無視
  }
}

// ---------------------------------------------------------------------------
// v3.5.9 Chunk D: useProjectStore の projects 配列を購読し、
// 削除された projectId の projectSnapshots を自動破棄する。
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  void (async () => {
    try {
      const mod = await import("@/lib/stores/project");
      const store = mod.useProjectStore;
      if (!store || typeof store.subscribe !== "function") return;

      let prevIds: Set<string> = (() => {
        try {
          const s = store.getState() as { projects?: Array<{ id: string }> };
          return new Set((s.projects ?? []).map((p) => p.id));
        } catch {
          return new Set();
        }
      })();

      store.subscribe((state: unknown) => {
        const list = (state as { projects?: Array<{ id: string }> }).projects ?? [];
        const nextIds = new Set(list.map((p) => p.id));
        for (const id of prevIds) {
          if (!nextIds.has(id)) {
            useChatStore.getState().clearProjectSnapshot(id);
          }
        }
        prevIds = nextIds;
      });
    } catch {
      // silent skip
    }
  })();
}
