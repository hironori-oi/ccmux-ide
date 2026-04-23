"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type {
  Session,
  SessionSummary,
  StoredMessage,
} from "@/lib/types";
import { useChatStore, type ToolUseEvent } from "@/lib/stores/chat";
import { parseToolMessageContent } from "@/lib/tool-content-parser";

/**
 * セッション一覧ドメインの Zustand store (PM-152)。
 *
 * Chunk B が管轄する `~/.sumi/history.db`（旧 `~/.ccmux-ide-gui/history.db`）の内容を frontend と sync する
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
 *
 * ## v5 Chunk B / DEC-032: project_id filter
 *
 * sessions テーブルに `project_id` 列が追加されたのに合わせ、本 store は
 * `useProjectStore.activeProjectId` を参照して:
 *  - `fetchSessions()`: activeProjectId != null なら project filter で fetch、
 *    null なら全件 fetch（未分類含む）
 *  - `createNewSession()`: activeProjectId を自動 attach（呼出側は明示不要）
 *  - project 切替時: useProjectStore.subscribe で `fetchSessions` を自動再実行
 *
 * ## 循環依存の回避
 *
 * `lib/stores/project.ts` は SessionList から pull 参照を受けるため、import を
 * top-level で行うと両方向依存になり得る。安全のため本ファイルでは
 * `await import(...)` の動的 import で useProjectStore を取得し、state 値のみを
 * `getState()` で取り出す。型情報も避けたい箇所は構造型推論で扱う。
 */

interface SessionState {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  isLoading: boolean;
  /** 最新の fetch でエラーが出たときのメッセージ（UI で banner 表示用） */
  error: string | null;

  /**
   * SQLite から session 一覧を取得して state に反映。
   *
   * v5 Chunk B: useProjectStore.activeProjectId が null なら全件（未分類含む）、
   * 非 null なら当該 project のみを Rust 側 WHERE で絞り込む。
   */
  fetchSessions: () => Promise<void>;
  /** 指定 session のメッセージをロードして chat store に投入 */
  loadSession: (id: string) => Promise<void>;
  /**
   * 新規 session を作成 → current に設定 → chat store もクリア。
   *
   * v5 Chunk B: activeProjectId を自動 attach する（呼出側の明示指定は不要、
   * 従来シグネチャは維持）。projectPath は legacy 互換のため残す。
   */
  createNewSession: (title?: string, projectPath?: string) => Promise<Session>;
  /** session 削除 → current と被っていれば chat store もクリア */
  deleteSession: (id: string) => Promise<void>;
  /** session rename → 一覧を再取得 */
  renameSession: (id: string, title: string) => Promise<void>;

  /**
   * PM-830 (v3.5.14): 指定 session の sdkSessionId を更新する。
   *
   * - DB (`sessions.sdk_session_id`) を `update_session_sdk_id` で更新
   * - frontend 側 `sessions` cache の該当エントリも同期して reactive に追従
   * - sdkSessionId = null で reset（resume 失敗時の fallback）
   *
   * 呼出元:
   *  - sidecar `sdk_session_ready` event ハンドラ (初回送信完了時に attach)
   *  - sidecar `error.kind === "resume_failed"` ハンドラ (null reset)
   */
  updateSessionSdkId: (
    sessionId: string,
    sdkSessionId: string | null
  ) => Promise<void>;
}

/**
 * Rust `StoredMessage` → Chunk A `ChatMessage` への変換。
 *
 * role は Rust 側が "user" / "assistant" / "tool" / "system" を混在で持つため、
 * Chunk A の型に合わせて単純 cast する（"tool_use" / "tool_result" / "system" は
 * "tool" に寄せる）。
 *
 * ## PM-880: tool content の JSON parse 統合
 *
 * `persistMessageToDb` (lib/stores/chat.ts) は tool role message の content に
 * `{ name, input, status, output }` を JSON.stringify した文字列を入れている。
 * PM-831 までは display 層（MessageList.tsx）で parse していたが、DB 復元経路で
 * ある本関数に parse を統合することで以降の全経路（MessageList / SearchPalette
 * 等）で structured `toolUse` field が揃った ChatMessage が流れるようになる。
 *
 * parse 失敗時は `toolUse` を付けずに raw content のまま返す（display 層の
 * fallback で AssistantMessage に流れる）。これは元の挙動との互換性維持のため。
 */
function toChatMessage(m: StoredMessage): {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  attachments?: { id: string; path: string }[];
  toolUse?: ToolUseEvent;
} {
  const role: "user" | "assistant" | "tool" =
    m.role === "user"
      ? "user"
      : m.role === "assistant"
        ? "assistant"
        : "tool";

  // PM-880: tool role に限り content を JSON parse して toolUse を復元する。
  // parse 失敗時 (想定外 shape / 旧データ等) は toolUse 未設定で fallback。
  const toolUse =
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

/**
 * useProjectStore から activeProjectId を取得する（動的 import + getState）。
 *
 * 循環依存を避けるため top-level import は行わず、必要時に都度 import する。
 * SSR や hydration 未完了で読めない場合は null を返す。
 */
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

/**
 * v1.11.0 (DEC-057): 新規 session 確定直後に session-preferences store を
 * **当該 project の perProject** (無ければ HARD_DEFAULT_PREFERENCES) で seed する。
 * 既に登録済なら no-op (initializeSession 内部で guard 済)。
 *
 * DEC-053 で使っていた dialog.selectedModel / selectedEffort 参照は除去。
 * project 切替時の設定 leak を根治する（DEC-057）。
 *
 * 循環依存を避けるため動的 import で都度ロードする。
 */
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

/**
 * v1.11.0 (DEC-057): 既存 session の lazy 初期化。
 *
 * 過去バージョンで作成された session (= session-preferences に未登録)
 * を UI で開いた際に呼ぶ。登録済なら ensureSessionPreferences 内で no-op。
 */
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

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  error: null,

  fetchSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      // v5 Chunk B / DEC-032: activeProjectId があれば Rust 側の WHERE で絞り込む。
      // null なら全件（Rust 側で project_id 条件を付けない → 未分類も返る）。
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
      // Chunk A の chat store に流し込む
      useChatStore.getState().clearSession();
      useChatStore.getState().setMessages(chatMessages);
      useChatStore.getState().setSessionId(id);
      set({ currentSessionId: id, isLoading: false });
      // v1.11.0 (DEC-057): 既存 session の lazy 初期化（未登録なら perProject or
      // HARD_DEFAULT で seed）。所属 projectId は sessions cache から解決する。
      const owningProjectId =
        get().sessions.find((s) => s.id === id)?.projectId ?? null;
      void ensureSessionPreferences(id, owningProjectId);
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
      // PM-939 (v3.5.22): セッションは必ずプロジェクトに紐づく。
      //
      // 旧（v5 Chunk B / DEC-032）: activeProjectId = null でも未分類セッションとして
      // INSERT していたが、オーナー要望（2026-04-20）で「プロジェクト → セッション」の
      // 作成順を強制することになった。UI 層（SessionList / ChatPaneHeader /
      // CommandPalette / InputArea）でも disable ガードを張っているが、将来のコード
      // 追加や slash / keyboard shortcut 経由の抜け穴を塞ぐため store 層でも reject する。
      //
      // 既存の未分類 session (DB に project_id IS NULL で残存) は読込 / 表示側では
      // 従来どおり扱える（SessionList の「未分類を表示」トグル経由）。本 guard は
      // あくまで **新規作成** のみに効くので後方互換性は維持。
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
      // 直後に一覧を再取得して state を同期（fetchSessions 経由で projectId filter）
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      // chat store をクリアして session id を紐付け
      useChatStore.getState().clearSession();
      useChatStore.getState().setSessionId(session.id);
      set({
        sessions: list,
        currentSessionId: session.id,
        isLoading: false,
      });
      // v1.11.0 (DEC-057): 新規 session の preferences を当該 project の perProject
      // (無ければ HARD_DEFAULT_PREFERENCES) で seed する。dialog store は参照しない。
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
      await callTauri<void>("delete_session", { sessionId: id });
      // 現在の project filter を維持したまま再取得
      const projectId = await readActiveProjectId();
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
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
      // v1.9.0 (DEC-053): session 削除時は preferences も掃除。
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
      // 現在の project filter を維持したまま再取得
      const projectId = await readActiveProjectId();
      const args: Record<string, unknown> = { limit: 200, offset: 0 };
      if (projectId !== null) args.projectId = projectId;
      const list = await callTauri<SessionSummary[]>("list_sessions", args);
      set({ sessions: list, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  // PM-830 (v3.5.14): SDK side session id を frontend cache + DB に書き戻す。
  // sidecar の sdk_session_ready event / resume 失敗時 reset の双方から呼ばれる。
  updateSessionSdkId: async (sessionId, sdkSessionId) => {
    // 楽観更新: 先に store cache を上書きして UI に即反映 (送信時 resume に使えるよう)
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
      // DB 書き込み失敗: error 文字列のみ state に積み、cache は維持 (再送で復旧可能)
      set({ error: String(e) });
      // eslint-disable-next-line no-console
      console.warn(
        `[session] update_session_sdk_id 失敗 (id=${sessionId}, sdk=${sdkSessionId}):`,
        e
      );
    }
  },
}));

/**
 * PM-830: 指定 sessionId の sdkSessionId を session store cache から引く。
 *
 * - cache に hit すれば即返す (fetchSessions 経由で常時最新化されている前提)
 * - cache miss (例: 別 project の session を resume したい等) は null を返す
 * - InputArea の handleSend が「null なら resume なし」「string なら resume 付き送信」
 *   として分岐する
 *
 * Hook ではなく純関数として export することで、React 外 (chat store の listener 等)
 * からも利用可能にする。
 */
export function getSdkSessionIdFromCache(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const list = useSessionStore.getState().sessions;
  const found = list.find((s) => s.id === sessionId);
  return found?.sdkSessionId ?? null;
}

// ---------------------------------------------------------------------------
// v5 Chunk B / DEC-032: useProjectStore.activeProjectId 変更の subscribe
//
// project 切替時に session 一覧を自動で再 fetch する。循環 import を避けるため
// 動的 import で購読を張る（browser のみ、SSR は no-op）。
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // 非同期で購読開始（top-level await は CJS 互換性のため避ける）
  void (async () => {
    try {
      const mod = await import("@/lib/stores/project");
      const store = mod.useProjectStore;
      if (!store || typeof store.subscribe !== "function") return;

      // 直前値との比較を関数スコープに閉じ込める（zustand v4 の subscribe シグネチャ）
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
        // 既存 loader パターンに合わせ fetchSessions を再実行
        void useSessionStore.getState().fetchSessions();
      });
    } catch {
      // useProjectStore が未ロード / 存在しない場合は黙って skip
    }
  })();
}
