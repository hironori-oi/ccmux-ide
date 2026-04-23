"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { callTauri } from "@/lib/tauri-api";

/**
 * Chat ドメインの Zustand store。
 *
 * PM-135 で初期設計。Agent SDK sidecar から stream で流れてくる message /
 * tool_use / done イベントを appendMessage / updateStreamingMessage /
 * appendToolUse 経由で state に積む。
 *
 * ## PRJ-012 v3.5 Chunk B (Split Sessions) の変更
 *
 * 背景: 1 project 内で複数 session を左右分割で同時表示したいオーナー要望。
 * 従来 singleton だった state 一式（messages / streaming / activity /
 * attachments / currentSessionId / scrollTarget / highlight）を pane ごとに
 * 分離し、`panes: Record<paneId, ChatPaneState>` + `activePaneId` で管理する。
 *
 * ### 既存呼出元の互換
 *
 * 既存コードは `useChatStore((s) => s.messages)` や
 * `useChatStore.getState().setSessionId(...)` のように singleton API を
 * 想定している箇所が多い。これらを一斉に書き換えると影響範囲が広すぎるため、
 * 本 refactor では以下の方針で後方互換を保つ:
 *
 *   1. pane 1 件分の state（messages / streaming / ...）を`ChatPaneState` に分離。
 *   2. 既存 action は **paneId?** を第一引数とし、省略時は activePaneId を使う
 *      wrapper シグネチャに書き換える。
 *   3. 既存 selector (`s.messages` 等) も activePaneId の pane を覗く compat
 *      getter として残す。ChatPanel 系（paneId を知る component）は pane 経由
 *      で明示参照する。
 *
 * これにより Chunk B 非対応の呼出元（SearchPalette / ClearSessionDialog /
 * session store / builtin-slash 等）は `paneId` 省略の旧 API で動き続け、
 * 実質 activePane に対して作用する（= 従来と同じ挙動）。
 *
 * ### persist
 *
 * - 永続化対象: `panes[*].currentSessionId` と `activePaneId`、`panes` の key
 *   一覧のみ。messages は揮発（session load で復元される前提）。
 * - storage key: `ccmux-ide-gui:chat-panes`。
 *
 * ## PRJ-012 v3.5.9 Chunk D (Project Switch History) の変更
 *
 * project 切替で pane の会話履歴が消え、戻っても DB load のタイムラグで
 * 空表示が見える体験を改善。`projectSnapshots` を projectId キーで保持し、
 * 切替直前に `panes` を deep copy で save、切替直後に restore することで
 * **同じ project に戻ってきた瞬間に UI が復元** される（streaming 中の
 * message も保持）。
 *
 * - persist **対象外**（揮発）。messages は DB から再 load 可能で、巨大化に
 *   よる localStorage 圧迫リスクを避ける。
 * - sidecar は project 単位で走り続ける設計（v3.3 Multi-Sidecar / DEC-033）
 *   のため、裏で発生した new message は DB に保存されており、cache hit 後に
 *   `loadSession(currentSessionId)` を追加実行して最新化する。
 * - `removeProject` 時は `clearProjectSnapshot(projectId)` で該当スナップショット
 *   を破棄する（`useProjectStore.subscribe` で自動検知）。
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
 * 1 pane 分の chat 状態。pane ごとに独立。
 */
export interface ChatPaneState {
  /** セッション内の全メッセージ（時系列） */
  messages: ChatMessage[];
  /** 送信〜done までのフラグ */
  streaming: boolean;
  /** Claude の現在の活動状態 */
  activity: ChatActivity;
  /** 現在の入力欄に添付されている画像（送信でクリア） */
  attachments: Attachment[];
  /** SQLite セッション ID（load 中の session、mutable） */
  currentSessionId: string | null;
  /** SearchPalette 等からスクロール要求された message id */
  scrollTargetMessageId: string | null;
  /** 4 秒間ハイライト表示する message id */
  highlightedMessageId: string | null;
  /**
   * PM-979: 作成時にアクティブだった session id（immutable、Tray フィルタ用）。
   * `currentSessionId` は session 切替で変化するため「pane がどの session に
   * 属するか」判定には使えない。pane 作成時の session を tag として保持する。
   * null は「session なし時 / main pane / legacy」で、filter で弾かれない。
   */
  creatingSessionId?: string | null;
}

/** 最初の pane id（必ず存在する = 互換のための固定 id） */
export const DEFAULT_PANE_ID = "main";

/**
 * 同時に開ける最大 pane 数。
 * v3.5 Step 1 は 2 固定だったが、PM-937 (2026-04-20) で 4 pane (2x2 grid) 対応。
 */
export const MAX_PANES = 4;

interface ChatState {
  /** pane ごとの state（初期は main 1 件） */
  panes: Record<string, ChatPaneState>;
  /** フォーカス中の pane id（入力 / 送信 / SearchPalette jump のデフォルトターゲット） */
  activePaneId: string;

  /**
   * PRJ-012 v3.5.9 Chunk D (Project Switch History): project 切替時の pane state
   * スナップショット。activeProjectId 変化を ChatPanel 側が検知し、切替直前の panes
   * をここに save → 切替後に project 別 snapshot を restore することで、同じ
   * project に戻ってきた時に messages / streaming / activity / currentSessionId /
   * attachments が **タイムラグなし** で復元される。
   *
   * - 構造: `projectSnapshots[projectId][paneId] = ChatPaneState`
   * - 永続化: **しない**（partialize で除外）。messages は DB から復元可能で、
   *   巨大化で localStorage を圧迫するリスクを避ける。揮発で十分。
   * - ライフサイクル: save は project 切替直前、restore は切替直後、clear は
   *   `removeProject` から呼ばれる（`clearProjectSnapshot`）。
   */
  projectSnapshots: Record<string, Record<string, ChatPaneState>>;

  // --- pane lifecycle ---
  /** 新規 pane を追加。MAX_PANES 到達時は既存 activePaneId を返して no-op。返り値は新 paneId。 */
  addPane: () => string;
  /** pane 削除。0 件にならないよう最後の 1 件は削除不可。 */
  removePane: (paneId: string) => void;
  /** フォーカス pane を切替 */
  setActivePane: (paneId: string) => void;

  // --- v3.5.9 Chunk D: project snapshot ---
  /**
   * 現在の `panes` を deep copy して `projectSnapshots[projectId]` に保存する。
   * activeProjectId 変化直前に呼ぶ。
   */
  saveProjectSnapshot: (projectId: string) => void;
  /**
   * `projectSnapshots[projectId]` があれば `panes` に復元（deep copy）する。
   * 無ければ panes を初期 pane 1 個（DEFAULT_PANE_ID, 空 state）にリセットし、
   * activePaneId も DEFAULT_PANE_ID に戻す。
   *
   * 戻り値: snapshot を hit したら true、miss（初期化）したら false。
   * 呼出側は戻り値で「既存経路（lastSessionId から DB load）を続けるか否か」を分岐する。
   */
  restoreProjectSnapshot: (projectId: string) => boolean;
  /**
   * 指定 projectId の snapshot を破棄する（removeProject 時に呼ばれる想定）。
   */
  clearProjectSnapshot: (projectId: string) => void;

  /**
   * v1.12.0 (DEC-058): 指定 session 群を chat state から一掃する。
   *
   * - `panes[*].currentSessionId` が対象なら null に戻す（messages もクリア）
   * - `panes[*].creatingSessionId` が対象なら null に戻す（Tray フィルタから脱落させる）
   * - `projectSnapshots[*][*]` に同様の操作を適用
   *
   * project 削除 cascade で呼ばれる。`clearProjectSnapshot` と組み合わせて、
   * project 削除後に **どの pane にも stale な sessionId が残らない** ことを
   * 保証する。
   */
  purgeSessions: (sessionIds: readonly string[]) => void;

  /**
   * PRJ-012 v3.5.11 Chunk E (Cross-Project Events): `projectSnapshots[projectId][paneId]`
   * を直接 update する。snapshot が無ければ初期 snapshot を作成してから update。
   *
   * これにより active でない project の sidecar event を受信した時、`panes` 側
   * （= 別 project が active）を破壊せずに **裏で snapshot に蓄積** できる。
   * project が戻ってくると `restoreProjectSnapshot` で最新状態が瞬時に復元される。
   *
   * - paneId が snapshot に存在しなければ no-op（v3.5.11 Step 1 では DEFAULT_PANE_ID
   *   のみ受信、Split の second pane は v3.6 で対応予定）
   * - updater は immutable な ChatPaneState 変換関数
   */
  updateSnapshotPane: (
    projectId: string,
    paneId: string,
    updater: (pane: ChatPaneState) => ChatPaneState
  ) => void;

  /**
   * PRJ-012 v3.5.11 Chunk E (Cross-Project Events): 「active project なら panes を、
   * 非 active project なら projectSnapshots を」更新する便利な dispatcher。
   *
   * 全 project の sidecar event を常時購読する `useAllProjectsSidecarListener`
   * から呼ばれる。event handler 側で activeProjectId 判定をしないでも自動振分け。
   *
   * - 内部で `projectId === activeProjectId` を判定
   * - 一致 → `panes[paneId]` を updater で update（既存 `updatePane` 流用）
   * - 不一致 → `updateSnapshotPane` で snapshot 側を update（snapshot 無ければ初期化）
   */
  applyToProjectPane: (
    projectId: string,
    paneId: string,
    activeProjectId: string | null,
    updater: (pane: ChatPaneState) => ChatPaneState
  ) => void;

  // --- pane 内 action（paneId 省略時は activePaneId を使う compat shim） ---
  appendMessage: (paneIdOrMessage: string | ChatMessage, message?: ChatMessage) => void;
  updateStreamingMessage: (
    paneIdOrId: string,
    idOrDelta: string,
    delta?: string
  ) => void;
  setStreaming: (paneIdOrStreaming: string | boolean, streaming?: boolean) => void;
  setActivity: (
    paneIdOrActivity: string | ChatActivity,
    activity?: ChatActivity
  ) => void;
  finalizeStreamingMessage: (paneIdOrId: string, id?: string) => void;
  appendToolUse: (
    paneIdOrId: string,
    idOrEvent: string | ToolUseEvent,
    event?: ToolUseEvent
  ) => void;
  updateToolUseStatus: (
    paneIdOrId: string,
    idOrStatus: string | ToolUseEvent["status"],
    statusOrOutput?: ToolUseEvent["status"] | string,
    output?: string
  ) => void;
  appendAttachment: (
    paneIdOrAttachment: string | Attachment,
    attachment?: Attachment
  ) => void;
  removeAttachment: (paneIdOrId: string, id?: string) => void;
  clearAttachments: (paneId?: string) => void;
  clearSession: (paneId?: string) => void;
  setSessionId: (paneIdOrId: string | null, id?: string | null) => void;
  setMessages: (
    paneIdOrMessages: string | ChatMessage[],
    messages?: ChatMessage[]
  ) => void;
  scrollToMessageId: (paneIdOrId: string, id?: string) => void;
  clearHighlight: (paneId?: string) => void;
  clearScrollTarget: (paneId?: string) => void;
}

/** 空の pane state を生成する。 */
function makeEmptyPane(): ChatPaneState {
  return {
    messages: [],
    streaming: false,
    activity: { kind: "idle" },
    attachments: [],
    currentSessionId: null,
    scrollTargetMessageId: null,
    highlightedMessageId: null,
  };
}

/**
 * compat shim 用の引数解釈ヘルパ。第 1 引数が既存 paneId 一覧にあれば paneId、
 * 無ければ旧シグネチャ（paneId 省略）として activePaneId を返す。
 *
 * NOTE: paneId は crypto.randomUUID() 由来の uuid、もしくは "main" 固定。
 * ChatMessage.id / ToolUseEvent.name / "streaming" boolean 等と衝突しない。
 * ここでは panes map の key に含まれているかだけで判定する。
 */
function resolvePaneId(
  state: ChatState,
  first: unknown
): { paneId: string; usedFirstAsPaneId: boolean } {
  if (typeof first === "string" && Object.prototype.hasOwnProperty.call(state.panes, first)) {
    return { paneId: first, usedFirstAsPaneId: true };
  }
  return { paneId: state.activePaneId, usedFirstAsPaneId: false };
}

/** panes map 内の 1 pane を updater で更新する util。存在しない paneId なら no-op。 */
function updatePane(
  panes: Record<string, ChatPaneState>,
  paneId: string,
  updater: (p: ChatPaneState) => ChatPaneState
): Record<string, ChatPaneState> {
  const cur = panes[paneId];
  if (!cur) return panes;
  return { ...panes, [paneId]: updater(cur) };
}

/** 新しい pane id を生成。 */
function newPaneId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pane-${crypto.randomUUID()}`;
  }
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 1 pane 分の state を deep copy する。
 *
 * messages / attachments は配列、各 message 内の toolUse はネスト object なので
 * shared reference を断つためネストまで clone する。activity は discriminated
 * union なので shallow spread で十分。
 *
 * NOTE: JSON serialize/parse ではなく明示 clone。undefined / Map / Date が将来
 * 混ざったときに静かに壊れるのを避ける。
 */
function clonePaneState(p: ChatPaneState): ChatPaneState {
  return {
    messages: p.messages.map((m) => ({
      ...m,
      attachments: m.attachments ? m.attachments.map((a) => ({ ...a })) : undefined,
      toolUse: m.toolUse
        ? {
            ...m.toolUse,
            input: { ...m.toolUse.input },
          }
        : undefined,
    })),
    streaming: p.streaming,
    activity: { ...p.activity },
    attachments: p.attachments.map((a) => ({ ...a })),
    currentSessionId: p.currentSessionId,
    scrollTargetMessageId: p.scrollTargetMessageId,
    highlightedMessageId: p.highlightedMessageId,
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
// v3.5.13 crit fix: DB 永続化（append_message invoke ラッパ）
//
// chat store の appendMessage / finalizeStreamingMessage / appendToolUse /
// updateToolUseStatus から「確定メッセージのみ」1 回だけ呼ばれる。
// streaming 中の delta は都度書き込まない（パフォーマンス考慮、finalize 時に確定版を 1 回 append）。
//
// 二重 append を防ぐため、frontend 側で `persistedIds` セットを持ち、
// 同一 message id で 2 回呼ばれた場合は skip する（Rust 側の message.id は
// 別 UUID なので重複検出は frontend で完結する）。
// ---------------------------------------------------------------------------

/**
 * 既に DB に永続化済の message id を記録するセット。
 * ChatMessage.id 単位でユニーク管理し、streaming → finalize → append などの
 * 多重呼出しで二重 INSERT にならないよう guard する。
 *
 * メモリ上のみ（永続化不要）。リロード後は当然 empty から始まるが、
 * その時点では過去 session の message id 体系は DB から再ロードされる
 * （DB 側が真実）ので frontend の dedup は新規書込みパスでのみ意味を持つ。
 */
const persistedIds: Set<string> = new Set();

/** role 文字列を Rust 側（"user" / "assistant" / "tool"）に正規化する。 */
function normalizeRoleForDb(role: ChatMessage["role"]): string {
  // role 型は既に 3 種に絞られているため基本そのまま。
  return role;
}

/**
 * 1 message を Rust `append_message` に書き込む（DB 永続化）。
 *
 * 呼出元:
 *  - `appendMessage`            : user / assistant(完成版) / tool(完成版)
 *  - `finalizeStreamingMessage` : streaming 完了した assistant message を確定 append
 *  - `appendToolUse`            : tool event 検出時、content は tool_use JSON
 *  - `updateToolUseStatus`      : tool 完了（success/error）時、status/output 反映版を append
 *  - `useAllProjectsSidecarListener`: cross-project event で確定 assistant/tool を記録
 *
 * tool role の content は toolUse event を JSON serialize して格納する。復元時は
 * `session.ts toChatMessage` が content を parse して `toolUse` field を
 * 再構築するため（PM-880 で統合）、UI 側は structured `toolUse` を直接参照できる。
 * parse 失敗時は display 層 (`MessageList.tsx`) で最終 fallback が走る。
 *
 * 失敗は console.warn のみ（UX を止めない）。session 不在エラーは呼出側で
 * 防ぐ（InputArea が送信前に createNewSession を走らせる）。
 */
export async function persistMessageToDb(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  if (!sessionId) return;
  if (persistedIds.has(message.id)) return;
  // 先に mark することで concurrent 呼出での二重 invoke を抑止
  persistedIds.add(message.id);

  const role = normalizeRoleForDb(message.role);

  // tool role は toolUse event の shape を JSON で格納する（UI 復元時に parse 可能）
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
      // serialize 失敗は status 文字列のみでも記録（完全 drop を避ける）
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
    // DB 書込失敗は致命でない（UI state は既に反映済）。再送のため id を外す。
    persistedIds.delete(message.id);
    // eslint-disable-next-line no-console
    console.warn(
      `[chat] append_message 失敗 (session=${sessionId}, id=${message.id}):`,
      e
    );
  }
}

// NOTE: 将来 tool の status 変化 (pending → success/error) の「上書き append」が
// 必要になった場合は、`persistedIds.delete(id)` を呼んでから persistMessageToDb を
// 再呼出しすることで二重書きが可能。ただし `append_message` は id を backend で
// 採番するため、同一 ChatMessage.id に対して DB row が 2 件生まれる点に注意。
// v3.5.13 では tool は「完了時に 1 回だけ書く」設計で妥協し、delete API は未実装。

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      panes: { [DEFAULT_PANE_ID]: makeEmptyPane() },
      activePaneId: DEFAULT_PANE_ID,
      projectSnapshots: {},

      // --- pane lifecycle ------------------------------------------------

      addPane: () => {
        const state = get();
        const paneIds = Object.keys(state.panes);
        if (paneIds.length >= MAX_PANES) {
          // MAX_PANES 制限に到達、no-op + 既存 active を返す
          return state.activePaneId;
        }
        const id = newPaneId();
        // PM-979: 新規 chat pane に作成時 session を tag 付け（tray session filter 用）
        // session store から現在 session id を取得、なければ null で legacy 扱い
        let creatingSessionId: string | null = null;
        try {
          // 循環依存回避のため getState() を dynamic require
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const sessionModule = require("@/lib/stores/session") as {
            useSessionStore: {
              getState: () => { currentSessionId: string | null };
            };
          };
          creatingSessionId =
            sessionModule.useSessionStore.getState().currentSessionId;
        } catch {
          // session store 未 init 等は null で許容
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
        if (paneIds.length <= 1) return; // 最後の 1 件は消さない
        if (!state.panes[paneId]) return;
        const { [paneId]: _removed, ...rest } = state.panes;
        void _removed;
        let nextActive = state.activePaneId;
        if (nextActive === paneId) {
          // 削除された pane が active なら、残った中で先頭を active に
          nextActive = Object.keys(rest)[0];
        }
        set({ panes: rest, activePaneId: nextActive });
      },

      setActivePane: (paneId) => {
        if (!get().panes[paneId]) return;
        set({ activePaneId: paneId });
      },

      // --- v3.5.9 Chunk D: project snapshot ------------------------------

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
          // cache hit: panes を snapshot から deep copy で復元。
          // activePaneId は snapshot 側に保存していないため、現 activePaneId が
          // snapshot 内に居れば維持、居なければ snapshot の最初の paneId に倒す。
          const restored = clonePanes(snap);
          const nextActive =
            restored[state.activePaneId] !== undefined
              ? state.activePaneId
              : Object.keys(restored)[0] ?? DEFAULT_PANE_ID;
          set({ panes: restored, activePaneId: nextActive });
          return true;
        }
        // cache miss: 初期 pane 1 個にリセット
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
          let changed = false;
          const transformPane = (pane: ChatPaneState): ChatPaneState => {
            const hitCurrent =
              pane.currentSessionId !== null && ids.has(pane.currentSessionId);
            const hitCreating =
              pane.creatingSessionId != null && ids.has(pane.creatingSessionId);
            if (!hitCurrent && !hitCreating) return pane;
            changed = true;
            if (hitCurrent) {
              return {
                ...pane,
                messages: [],
                streaming: false,
                activity: { kind: "idle" },
                attachments: [],
                currentSessionId: null,
                scrollTargetMessageId: null,
                highlightedMessageId: null,
                creatingSessionId: hitCreating ? null : pane.creatingSessionId,
              };
            }
            return { ...pane, creatingSessionId: null };
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
          if (!changed) return state;
          return { panes: nextPanes, projectSnapshots: nextSnapshots };
        });
      },

      // --- v3.5.11 Chunk E: cross-project event dispatch ----------------

      updateSnapshotPane: (projectId, paneId, updater) => {
        if (!projectId || !paneId || typeof updater !== "function") return;
        set((state) => {
          // snapshot が無ければ「default pane 1 個の空 snapshot」を作って update。
          // これは「active 中に他 project の sidecar event が来た時に、その project
          // の snapshot を初めて作る」ケース（= 起動直後の他 project へ送信したが
          // ユーザは別 project を見ている、等）を吸収する。
          const existing = state.projectSnapshots[projectId];
          const snap: Record<string, ChatPaneState> = existing
            ? { ...existing }
            : { [DEFAULT_PANE_ID]: makeEmptyPane() };
          const targetPane = snap[paneId];
          if (!targetPane) {
            // paneId が snapshot に存在しない場合 (Split second pane 等) は
            // v3.5.11 Step 1 では受信対象外。silently no-op。
            // snapshot 自体は新規作成済だが、実害なし（次回 save で正規化される）。
            // 既存 snapshot を壊さないよう、変更がない場合は state を返さず early return。
            if (!existing) {
              return {
                projectSnapshots: {
                  ...state.projectSnapshots,
                  [projectId]: snap,
                },
              };
            }
            return state;
          }
          const nextPane = updater(targetPane);
          if (nextPane === targetPane) {
            // updater が同一参照を返したら no-op
            return existing
              ? state
              : {
                  projectSnapshots: {
                    ...state.projectSnapshots,
                    [projectId]: snap,
                  },
                };
          }
          return {
            projectSnapshots: {
              ...state.projectSnapshots,
              [projectId]: { ...snap, [paneId]: nextPane },
            },
          };
        });
      },

      applyToProjectPane: (projectId, paneId, activeProjectId, updater) => {
        if (!projectId || !paneId || typeof updater !== "function") return;
        if (projectId === activeProjectId) {
          // active project: live panes を update（既存 util 流用）
          set((state) => ({
            panes: updatePane(state.panes, paneId, updater),
          }));
          return;
        }
        // 非 active project: snapshot 側を update
        get().updateSnapshotPane(projectId, paneId, updater);
      },

      // --- pane 内 actions -----------------------------------------------
      //
      // 以下は「第 1 引数が panes の key と一致すれば paneId、そうでなければ
      // 旧シグネチャ」として振る舞う shim。ChatPanel 系は明示的に paneId を
      // 渡し、互換呼出元（SearchPalette 等）は paneId 省略で activePaneId に
      // 作用する。

      appendMessage: (a, b) => {
        let targetSessionId: string | null = null;
        let targetMessage: ChatMessage | null = null;
        let shouldPersistNow = false;
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const message = (usedFirstAsPaneId ? b : (a as ChatMessage)) as
            | ChatMessage
            | undefined;
          if (!message) return state;
          targetMessage = message;
          targetSessionId = state.panes[paneId]?.currentSessionId ?? null;
          // streaming 中の assistant は finalize で append するので skip（delta 書込み防止）。
          // tool も appendToolUse/updateToolUseStatus 側で管理するので skip。
          // ここで即 persist するのは user と、streaming を付けない確定済み assistant/tool のみ。
          shouldPersistNow =
            message.role === "user" ||
            (message.role === "assistant" && !message.streaming);
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages: [...p.messages, message],
            })),
          };
        });
        // v3.5.13: DB 永続化（set の外で async 発火、UI の同期 set を阻害しない）
        if (shouldPersistNow && targetSessionId && targetMessage) {
          void persistMessageToDb(targetSessionId, targetMessage);
        }
      },

      updateStreamingMessage: (a, b, c) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          const delta = (usedFirstAsPaneId ? c : b) as string;
          if (!id || typeof delta !== "string") return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages: p.messages.map((m) =>
                m.id === id
                  ? { ...m, content: m.content + delta, streaming: true }
                  : m
              ),
            })),
          };
        });
      },

      setStreaming: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const streaming = (usedFirstAsPaneId ? b : a) as boolean;
          if (typeof streaming !== "boolean") return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              streaming,
            })),
          };
        });
      },

      setActivity: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const activity = (usedFirstAsPaneId ? b : a) as ChatActivity;
          if (!activity || typeof activity !== "object") return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              activity,
            })),
          };
        });
      },

      finalizeStreamingMessage: (a, b) => {
        let targetSessionId: string | null = null;
        let targetMessage: ChatMessage | null = null;
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          if (!id) return state;
          const pane = state.panes[paneId];
          if (pane) {
            const match = pane.messages.find((m) => m.id === id);
            if (match) {
              // 確定版（streaming=false）を後で persist するためにコピー
              targetMessage = { ...match, streaming: false };
              targetSessionId = pane.currentSessionId ?? null;
            }
          }
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages: p.messages.map((m) =>
                m.id === id ? { ...m, streaming: false } : m
              ),
            })),
          };
        });
        // v3.5.13: streaming 終了時に 1 回だけ DB 永続化（delta 時は書かない）
        if (targetSessionId && targetMessage) {
          void persistMessageToDb(targetSessionId, targetMessage);
        }
      },

      appendToolUse: (a, b, c) => {
        // v3.5.13: appendToolUse 自体では DB 永続化しない（pending 状態は揮発で可）。
        // 完了時（updateToolUseStatus で success/error になった時）に 1 回だけ append する。
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          const event = (usedFirstAsPaneId ? c : b) as ToolUseEvent;
          if (!id || !event) return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages: [
                ...p.messages,
                { id, role: "tool", content: "", toolUse: event },
              ],
            })),
          };
        });
      },

      updateToolUseStatus: (a, b, c, d) => {
        let targetSessionId: string | null = null;
        let targetMessage: ChatMessage | null = null;
        let statusBecameTerminal = false;
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          const status = (usedFirstAsPaneId ? c : b) as ToolUseEvent["status"];
          const output = (usedFirstAsPaneId ? d : c) as string | undefined;
          if (!id || !status) return state;
          const pane = state.panes[paneId];
          if (pane) {
            const match = pane.messages.find((m) => m.id === id && m.toolUse);
            if (match && match.toolUse) {
              const nextToolUse: ToolUseEvent = {
                ...match.toolUse,
                status,
                output,
              };
              statusBecameTerminal = status === "success" || status === "error";
              if (statusBecameTerminal) {
                targetMessage = { ...match, toolUse: nextToolUse };
                targetSessionId = pane.currentSessionId ?? null;
              }
            }
          }
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages: p.messages.map((m) =>
                m.id === id && m.toolUse
                  ? { ...m, toolUse: { ...m.toolUse, status, output } }
                  : m
              ),
            })),
          };
        });
        // v3.5.13: tool 完了（success/error）時に DB 永続化（1 回のみ、pending 時は書かない）
        if (statusBecameTerminal && targetSessionId && targetMessage) {
          void persistMessageToDb(targetSessionId, targetMessage);
        }
      },

      appendAttachment: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const attachment = (usedFirstAsPaneId ? b : (a as Attachment)) as
            | Attachment
            | undefined;
          if (!attachment) return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              attachments: [...p.attachments, attachment],
            })),
          };
        });
      },

      removeAttachment: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          if (!id) return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              attachments: p.attachments.filter((at) => at.id !== id),
            })),
          };
        });
      },

      clearAttachments: (paneId) => {
        set((state) => {
          const id = paneId ?? state.activePaneId;
          return {
            panes: updatePane(state.panes, id, (p) => ({ ...p, attachments: [] })),
          };
        });
      },

      clearSession: (paneId) => {
        set((state) => {
          const id = paneId ?? state.activePaneId;
          return {
            panes: updatePane(state.panes, id, (p) => ({
              ...p,
              messages: [],
              attachments: [],
              streaming: false,
              // PM-910 (H4 対応): activity も idle に倒す。
              // 旧実装は streaming: false にしていたが activity は前回値
              // (thinking / tool_use / streaming / error) を残したままで、
              // /clear 直後の ActivityIndicator が「思考中」を表示し続ける
              // 体感不具合があった。/clear = 無活動状態として扱う。
              activity: { kind: "idle" },
              scrollTargetMessageId: null,
              highlightedMessageId: null,
            })),
          };
        });
      },

      setSessionId: (a, b) => {
        const state = get();
        const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
        const id = (usedFirstAsPaneId ? b : a) as string | null;
        set({
          panes: updatePane(state.panes, paneId, (p) => ({
            ...p,
            currentSessionId: id ?? null,
          })),
        });

        // v5 Chunk C (DEC-030) 互換: session が紐づいたら active project の
        // lastSessionId を最新に書き戻す。v3.5 Chunk B も同様のロジックで
        // 動作する（activePane 経由で session load されるため）。
        if (id && typeof window !== "undefined") {
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
                  lastSessionId: id,
                });
              }
            })
            .catch(() => {
              // silent fallback
            });
        }
      },

      setMessages: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const messages = (usedFirstAsPaneId ? b : a) as ChatMessage[];
          if (!Array.isArray(messages)) return state;
          // v3.5.13: loadSession 経路で DB から復元された messages は既に永続化済み。
          // 以降の appendMessage / finalizeStreamingMessage / updateToolUseStatus で
          // 同一 id が DB に二重 INSERT されるのを防ぐため persistedIds に登録する。
          for (const m of messages) {
            persistedIds.add(m.id);
          }
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              messages,
            })),
          };
        });
      },

      scrollToMessageId: (a, b) => {
        set((state) => {
          const { paneId, usedFirstAsPaneId } = resolvePaneId(state, a);
          const id = (usedFirstAsPaneId ? b : a) as string;
          if (!id) return state;
          return {
            panes: updatePane(state.panes, paneId, (p) => ({
              ...p,
              scrollTargetMessageId: id,
              highlightedMessageId: id,
            })),
          };
        });
      },

      clearHighlight: (paneId) => {
        set((state) => {
          const id = paneId ?? state.activePaneId;
          return {
            panes: updatePane(state.panes, id, (p) => ({
              ...p,
              highlightedMessageId: null,
            })),
          };
        });
      },

      clearScrollTarget: (paneId) => {
        set((state) => {
          const id = paneId ?? state.activePaneId;
          return {
            panes: updatePane(state.panes, id, (p) => ({
              ...p,
              scrollTargetMessageId: null,
            })),
          };
        });
      },
    }),
    {
      name: "ccmux-ide-gui:chat-panes",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          // SSR / テスト用 no-op storage
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      // messages / attachments / activity / streaming 等は揮発。
      // currentSessionId と pane レイアウトだけ永続化する。
      // projectSnapshots も揮発（v3.5.9 Chunk D / Project Switch History）。
      partialize: (state) => ({
        activePaneId: state.activePaneId,
        panes: Object.fromEntries(
          Object.entries(state.panes).map(([id, p]) => [
            id,
            {
              messages: [],
              streaming: false,
              activity: { kind: "idle" } as ChatActivity,
              attachments: [],
              currentSessionId: p.currentSessionId ?? null,
              scrollTargetMessageId: null,
              highlightedMessageId: null,
            } satisfies ChatPaneState,
          ])
        ),
      }),
      // 起動時に panes が空だった場合のフェールセーフ。
      // Zustand persist は空 state をそのまま復元するため、ここで最低 1 pane を担保。
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<ChatState>) };
        if (!merged.panes || Object.keys(merged.panes).length === 0) {
          merged.panes = { [DEFAULT_PANE_ID]: makeEmptyPane() };
          merged.activePaneId = DEFAULT_PANE_ID;
        }
        if (!merged.panes[merged.activePaneId]) {
          merged.activePaneId = Object.keys(merged.panes)[0] ?? DEFAULT_PANE_ID;
        }
        // v3.5.9 Chunk D: projectSnapshots は persist 対象外（揮発）なので
        // persisted 側には存在しない。起動毎に空 map から始める。
        merged.projectSnapshots = {};
        return merged;
      },
    }
  )
);

// ---------------------------------------------------------------------------
// 便利 helper（component 側で pane state を 1 発で引きたい時に使う）
// ---------------------------------------------------------------------------

/** 指定 paneId の state を取得。存在しなければ undefined。 */
export function selectPane(
  state: ChatState,
  paneId: string
): ChatPaneState | undefined {
  return state.panes[paneId];
}

/** 互換: singleton 時代の「現在の messages」を activePane から返す selector */
export function selectActivePaneMessages(state: ChatState): ChatMessage[] {
  return state.panes[state.activePaneId]?.messages ?? [];
}

// v3.3 DEC-033: 旧 persist key (`ccmux-ide-gui:chat-cwd`) は以降使用しない。
// localStorage に残っている古い値は起動時に silently 削除する（UX 阻害なし）。
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("ccmux-ide-gui:chat-cwd");
  } catch {
    // quota / SecurityError は無視
  }
}

// ---------------------------------------------------------------------------
// v3.5.9 Chunk D (Project Switch History): useProjectStore の projects 配列を
// 購読し、削除された projectId の projectSnapshots を自動破棄する。
//
// 循環 import を避けるため top-level import ではなく動的 import + 非同期購読。
// browser 限定（SSR は no-op）。session.ts と同じパターン。
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
        // 前回に居て今回に居ない → 削除された projectId
        for (const id of prevIds) {
          if (!nextIds.has(id)) {
            useChatStore.getState().clearProjectSnapshot(id);
          }
        }
        prevIds = nextIds;
      });
    } catch {
      // useProjectStore が未ロード / 存在しない場合は silent skip
    }
  })();
}
