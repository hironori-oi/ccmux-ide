import type { Page } from "@playwright/test";

/**
 * PM-290: Tauri `invoke` / `event` を window 上に mock 注入する fixture。
 *
 * ## 背景
 * Next.js dev server 配下では `window.__TAURI_INTERNALS__` が存在しないので、
 * `@tauri-apps/api/core::invoke` がエラーになる。このモジュールは Next.js が
 * 実行される**前に** `addInitScript` で投入することで、Tauri API を差し替える。
 *
 * @tauri-apps/api v2 の実装は:
 *  - `invoke(cmd, args, opts?)` → `window.__TAURI_INTERNALS__.invoke(cmd, args, opts)`
 *  - `listen(event, handler)` → `invoke('plugin:event|listen', {event, target, handler})`
 *     - handler は `transformCallback(cb)` で登録番号に変換される
 *     - 戻り値 eventId は unlisten 時に `invoke('plugin:event|unlisten', {event, eventId})`
 *       へ渡される
 *
 * モック戦略:
 *  - __TAURI_INTERNALS__.invoke(cmd, args) を switch 文で分岐
 *  - plugin:event|listen は `listeners: Map<event, Set<handler>>` に格納
 *  - emit はテスト側から `page.evaluate(() => window.__mockEmit(ev, payload))`
 *
 * ## サポート command
 *  - agent sidecar: start/stop/send_agent_prompt
 *  - sessions: list/get_messages/create/delete/rename_session
 *  - api key: set/get/delete_api_key
 *  - image: save_clipboard_image / paste_image_from_clipboard
 *  - slash / memory / worktree: list_slash_commands / scan_memory_tree / list_worktrees
 *  - project: list_projects / read_project_file
 *  - search: search_messages
 *  - updater: check_updates / install_update
 *  - plugin:* (fs/shell/dialog/path): no-op 成功
 */

export interface TauriFixtureOptions {
  /** 初期 API Key（get_api_key の返値）。null で未設定扱い */
  apiKey?: string | null;
  /** 初期セッション一覧（list_sessions の返値） */
  sessions?: Array<{
    id: string;
    title: string | null;
    createdAt: number;
    updatedAt: number;
    projectPath: string | null;
    lastMessageExcerpt: string | null;
    lastMessageRole: string | null;
  }>;
  /**
   * 初期 slash コマンド一覧。
   *
   * DEC-027 v4 Chunk B: `isOrganization` フィールドは Rust 側 SlashCmd から
   * 削除されたため、ここでも optional 扱い（残しておくが型上は許容）にした。
   */
  slashCommands?: Array<{
    name: string;
    description: string;
    argumentHint: string | null;
    source: "global" | "project" | "cwd";
    filePath: string;
  }>;
  /** 検索結果 */
  searchResults?: Array<{
    messageId: string;
    sessionId: string;
    sessionTitle: string | null;
    role: string;
    snippetHtml: string;
    createdAt: number;
  }>;
  /** save_clipboard_image の返す絶対パス（null で「画像なし」） */
  clipboardImagePath?: string | null;
  /**
   * v3.3.1 Chunk B (S-1): 初期 project registry。
   *
   * 渡された場合、`installTauriMock` が `localStorage["ccmux-project-registry"]`
   * へ zustand persist 互換の shape で書き込む。これにより `/workspace` を
   * 開いた直後から `useProjectStore.activeProjectId` が確定し、ChatPanel が
   * `agent:${activeProjectId}:raw` を listen する。spec 側からは
   * `TEST_PROJECT_ID` を使って `agent:${id}:raw` を `emitMockEvent` で発火する。
   *
   * 省略時は registry を書かない（旧挙動: 「未選択」状態で start）。
   */
  initialProjects?: Array<{
    id: string;
    path: string;
    title: string;
    phase?: string;
    colorIdx?: number;
    lastSessionId?: string | null;
    addedAt?: number;
  }>;
  /** 初期 active project id（initialProjects と組で使う）。 */
  activeProjectId?: string | null;
}

/**
 * v3.3.1 Chunk B: e2e spec 共通で使う固定 project id。
 *
 * `agent:${TEST_PROJECT_ID}:raw` 等の event 名で emit する spec が複数あり、
 * 値を 1 か所に集約してずれを防ぐ。spec 側は registerProject の代わりに
 * `setupE2EPage(page, FIXTURE_WITH_TEST_PROJECT)` を呼ぶだけで registry が
 * 整い、`emitMockEvent(page, AGENT_RAW_EVENT, ...)` で listener に届く。
 */
export const TEST_PROJECT_ID = "e2e-project-fixed-uuid-0000-0001";
export const TEST_PROJECT_PATH = "/tmp/ccmux-e2e/project-1";
export const AGENT_RAW_EVENT = `agent:${TEST_PROJECT_ID}:raw`;
export const AGENT_STDERR_EVENT = `agent:${TEST_PROJECT_ID}:stderr`;
export const AGENT_TERMINATED_EVENT = `agent:${TEST_PROJECT_ID}:terminated`;

/** 1 件 project が登録された状態で /workspace を開く共通 fixture。 */
export const FIXTURE_WITH_TEST_PROJECT: TauriFixtureOptions = {
  initialProjects: [
    {
      id: TEST_PROJECT_ID,
      path: TEST_PROJECT_PATH,
      title: "E2E テスト用プロジェクト",
      colorIdx: 0,
      lastSessionId: null,
      addedAt: Date.now(),
    },
  ],
  activeProjectId: TEST_PROJECT_ID,
};

const DEFAULT_OPTIONS: Required<TauriFixtureOptions> = {
  apiKey: null,
  sessions: [],
  slashCommands: [
    {
      name: "/ceo",
      description: "CEO - 最高経営責任者",
      argumentHint: "{指示}",
      source: "global",
      filePath: "/home/user/.claude/commands/ceo.md",
    },
    {
      name: "/dev",
      description: "開発部門",
      argumentHint: "{指示}",
      source: "global",
      filePath: "/home/user/.claude/commands/dev.md",
    },
    {
      name: "/pm",
      description: "PM - プロジェクトマネージャー",
      argumentHint: "{指示}",
      source: "global",
      filePath: "/home/user/.claude/commands/pm.md",
    },
  ],
  searchResults: [],
  clipboardImagePath: "/tmp/ccmux-images/mock-clipboard.png",
  initialProjects: [],
  activeProjectId: null,
};

/**
 * window に Tauri モック一式を投入する。
 */
export async function installTauriMock(
  page: Page,
  options: TauriFixtureOptions = {}
): Promise<void> {
  const merged = { ...DEFAULT_OPTIONS, ...options };

  await page.addInitScript((opts) => {
    type Handler = (payload: unknown) => void;

    // ------------------------------------------------------------------
    // state（spec 側から mutate 可能）
    // ------------------------------------------------------------------
    const mockState: {
      apiKey: string | null;
      sessions: typeof opts.sessions;
      slashCommands: typeof opts.slashCommands;
      searchResults: typeof opts.searchResults;
      clipboardImagePath: string | null;
      messagesBySession: Record<string, unknown[]>;
      invokeLog: Array<{ cmd: string; args: unknown }>;
    } = {
      apiKey: opts.apiKey as string | null,
      sessions: [...opts.sessions],
      slashCommands: [...opts.slashCommands],
      searchResults: [...opts.searchResults],
      clipboardImagePath: opts.clipboardImagePath as string | null,
      messagesBySession: {},
      invokeLog: [],
    };

    (window as unknown as { __mockState: typeof mockState }).__mockState =
      mockState;

    // ------------------------------------------------------------------
    // transformCallback 実装（Tauri v2 の listener 登録用）
    //
    // @tauri-apps/api の `transformCallback(cb)` は:
    //   - cb を 一意な id で登録し、その id を返す
    //   - Rust 側（mock では invoke handler）はこの id を使って
    //     `window[`_{id}`](payload)` でコールバック実行
    // ------------------------------------------------------------------
    let callbackCounter = 0;
    const transformCallback = (cb: (...a: unknown[]) => void) => {
      const id = ++callbackCounter;
      (window as unknown as Record<string, (...a: unknown[]) => void>)[
        `_${id}`
      ] = cb;
      return id;
    };

    // ------------------------------------------------------------------
    // event listener（plugin:event|listen 用）
    // ------------------------------------------------------------------
    // event 名 → { eventId: number, handlerId: number }[]
    // handlerId は transformCallback で発行された window[`_{id}`] を参照する
    const listeners = new Map<
      string,
      Map<number, number>
    >(); // event -> (eventId -> handlerId)
    let eventIdCounter = 0;

    const emit = (event: string, payload: unknown) => {
      const set = listeners.get(event);
      if (!set) return;
      for (const [, handlerId] of set) {
        const cb = (
          window as unknown as Record<
            string,
            (e: { event: string; payload: unknown; id: number }) => void
          >
        )[`_${handlerId}`];
        if (typeof cb === "function") {
          try {
            cb({ event, payload, id: handlerId });
          } catch {
            // ignore
          }
        }
      }
    };
    (
      window as unknown as {
        __mockEmit: (event: string, payload: unknown) => void;
      }
    ).__mockEmit = emit;

    // ------------------------------------------------------------------
    // invoke 実装
    // ------------------------------------------------------------------
    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      mockState.invokeLog.push({ cmd, args: args ?? {} });

      // ---------- plugin:event|listen / unlisten ----------
      if (cmd === "plugin:event|listen") {
        const event = args?.event as string;
        const handlerId = args?.handler as number;
        if (typeof event === "string" && typeof handlerId === "number") {
          const eventId = ++eventIdCounter;
          if (!listeners.has(event)) listeners.set(event, new Map());
          listeners.get(event)!.set(eventId, handlerId);
          return eventId;
        }
        return 0;
      }
      if (cmd === "plugin:event|unlisten") {
        const event = args?.event as string;
        const eventId = args?.eventId as number;
        if (typeof event === "string" && typeof eventId === "number") {
          listeners.get(event)?.delete(eventId);
        }
        return null;
      }

      // ---------- agent sidecar (v3.3 DEC-033 Multi-Sidecar) ----------
      if (cmd === "start_agent_sidecar") return null;
      if (cmd === "stop_agent_sidecar") return null;
      if (cmd === "send_agent_interrupt") return null;
      if (cmd === "list_active_sidecars") return [];
      if (cmd === "send_agent_prompt") {
        const id = (args?.id as string) ?? "mock-id";
        const projectId = (args?.projectId as string | undefined) ?? null;
        // v3.3: event は `agent:{projectId}:raw` を優先、projectId 無しなら legacy
        const rawEvent = projectId ? `agent:${projectId}:raw` : "agent:raw";
        // 非同期で assistant 応答を mock stream
        setTimeout(() => {
          emit(
            rawEvent,
            JSON.stringify({
              type: "message",
              id,
              payload: {
                type: "assistant",
                message: {
                  content: [
                    { type: "text", text: "こんにちは、Claude です。" },
                  ],
                },
              },
            })
          );
          setTimeout(() => {
            emit(
              rawEvent,
              JSON.stringify({ type: "result", id, payload: {} })
            );
          }, 50);
        }, 40);
        return null;
      }

      // ---------- sessions ----------
      if (cmd === "list_sessions") return mockState.sessions;
      if (cmd === "get_session_messages") {
        const sid = (args?.sessionId as string) ?? "";
        return mockState.messagesBySession[sid] ?? [];
      }
      if (cmd === "create_session") {
        const now = Math.floor(Date.now() / 1000);
        const id = `sess-${now}-${Math.floor(Math.random() * 1e6)}`;
        const created = {
          id,
          title: (args?.title as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
          projectPath: (args?.projectPath as string | null) ?? null,
        };
        mockState.sessions = [
          {
            ...created,
            lastMessageExcerpt: null,
            lastMessageRole: null,
          },
          ...mockState.sessions,
        ];
        return created;
      }
      if (cmd === "delete_session") {
        const id = args?.sessionId as string;
        mockState.sessions = mockState.sessions.filter((s) => s.id !== id);
        return null;
      }
      if (cmd === "rename_session") {
        const id = args?.sessionId as string;
        const title = args?.title as string;
        mockState.sessions = mockState.sessions.map((s) =>
          s.id === id ? { ...s, title } : s
        );
        return null;
      }

      // ---------- api key ----------
      if (cmd === "set_api_key") {
        mockState.apiKey = (args?.key as string) ?? null;
        return null;
      }
      if (cmd === "get_api_key") return mockState.apiKey;
      if (cmd === "delete_api_key") {
        mockState.apiKey = null;
        return null;
      }

      // ---------- image ----------
      if (cmd === "save_clipboard_image") return mockState.clipboardImagePath;
      if (cmd === "paste_image_from_clipboard")
        return { savedPath: mockState.clipboardImagePath };

      // ---------- slash / memory / worktree ----------
      if (cmd === "list_slash_commands") return mockState.slashCommands;
      if (cmd === "scan_memory_tree") return [];
      if (cmd === "list_worktrees") return [];
      if (cmd === "add_worktree" || cmd === "delete_worktree") return null;

      // ---------- project ----------
      if (cmd === "list_projects") return [];
      if (cmd === "read_project_file") return "# mock\n";

      // ---------- search ----------
      if (cmd === "search_messages") return mockState.searchResults;

      // ---------- updater ----------
      if (cmd === "check_updates") return { available: false };
      if (cmd === "install_update") return null;

      // ---------- plugin:* passthrough ----------
      if (cmd.startsWith("plugin:")) {
        if (cmd === "plugin:fs|exists") return false;
        if (cmd === "plugin:fs|read_dir") return [];
        if (cmd === "plugin:fs|read_text_file") return "# mock\n";
        if (cmd === "plugin:path|resolve_directory") return "/tmp";
        if (cmd === "plugin:path|app_local_data_dir") return "/tmp";
        if (cmd === "plugin:path|join") return "/tmp/mock";
        // plugin-updater の check() は `plugin:updater|check` を呼ぶ。
        // 「更新なし」で返すことで UpdateNotifier の早期 return を誘導する。
        if (cmd === "plugin:updater|check") return null;
        if (cmd === "plugin:shell|open") return null;
        if (cmd === "plugin:dialog|open") return null;
        if (cmd === "plugin:notification|is_permission_granted") return true;
        if (cmd === "plugin:notification|notify") return null;
        // PM-943: WebviewWindow 系 invoke を空 stub で返す（E2E 環境では Tauri 本体
        // が不在なので、通常は never called だが、`getByLabel` が
        // `plugin:window|get_all_windows` を呼ぶので配列を返す必要がある）。
        if (cmd === "plugin:window|get_all_windows") return [];
        if (cmd === "plugin:webview|create_webview_window") return null;
        if (cmd === "plugin:window|set_focus") return null;
        if (cmd === "plugin:window|close") return null;
        if (cmd === "plugin:window|destroy") return null;
        return null;
      }

      // eslint-disable-next-line no-console
      console.warn("[mock] unhandled invoke:", cmd, args);
      return null;
    };

    // ------------------------------------------------------------------
    // __TAURI_INTERNALS__ を window に実装
    // ------------------------------------------------------------------
    (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: typeof invoke;
          transformCallback: typeof transformCallback;
          convertFileSrc: (path: string, protocol?: string) => string;
          ipc: (msg: unknown) => void;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke,
      transformCallback,
      // convertFileSrc: Tauri は asset:// や http://localhost/asset を返すが、
      // テスト環境では一意な文字列が返せれば十分。画像が表示できなくても
      // alt / aria-label でアサーションは通る。
      convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
      // IPC noop（Rust → JS のメッセージング用、テストでは不要）
      ipc: () => {
        /* noop */
      },
    };

    // withGlobalTauri 相当。__TAURI__.core / event を参照するコードへのフォールバック。
    (
      window as unknown as { __TAURI__?: { core?: unknown; event?: unknown } }
    ).__TAURI__ = {
      core: { invoke, transformCallback },
      event: {},
    };

    // HelloBubble を抑制（初回 onboarding 吹き出しが E2E で邪魔になるケース対策）
    try {
      window.localStorage.setItem("hasSeenWelcome", "1");
    } catch {
      // ignore
    }

    // -----------------------------------------------------------------
    // v3.3.1 Chunk B (Should Fix S-1): zustand persist 互換 shape で
    // project registry を初期投入する。
    //
    // useProjectStore は `persist({ name: "ccmux-project-registry", version: 1 })`
    // で localStorage に `{ state: {...}, version: 1 }` の形で書く。
    // partialize で persist 対象は `projects` / `activeProjectId` のみ。
    // -----------------------------------------------------------------
    if (Array.isArray(opts.initialProjects) && opts.initialProjects.length > 0) {
      try {
        const projects = (
          opts.initialProjects as Array<{
            id: string;
            path: string;
            title: string;
            phase?: string;
            colorIdx?: number;
            lastSessionId?: string | null;
            addedAt?: number;
          }>
        ).map((p) => ({
          id: p.id,
          path: p.path,
          title: p.title,
          phase: p.phase,
          colorIdx: typeof p.colorIdx === "number" ? p.colorIdx : 0,
          lastSessionId: p.lastSessionId ?? null,
          preferredModel: undefined,
          addedAt: p.addedAt ?? Date.now(),
        }));
        const payload = {
          state: {
            projects,
            activeProjectId: (opts.activeProjectId as string | null) ?? null,
          },
          version: 1,
        };
        window.localStorage.setItem(
          "ccmux-project-registry",
          JSON.stringify(payload)
        );
      } catch {
        // localStorage 失敗時は spec 側で activeProject 未設定として扱う
      }
    }
  }, merged as unknown as Record<string, unknown>);
}

/**
 * spec 側から mock event を発火するヘルパ（agent:raw や monitor:tick 用）。
 */
export async function emitMockEvent(
  page: Page,
  event: string,
  payload: unknown
): Promise<void> {
  await page.evaluate(
    ([ev, p]) => {
      const w = window as unknown as {
        __mockEmit?: (event: string, payload: unknown) => void;
      };
      w.__mockEmit?.(ev as string, p);
    },
    [event, payload] as const
  );
}

/**
 * invoke ログを取得する（assertion 用、`start_agent_sidecar` が呼ばれた等）。
 */
export async function getInvokeLog(
  page: Page
): Promise<Array<{ cmd: string; args: unknown }>> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __mockState?: { invokeLog: Array<{ cmd: string; args: unknown }> };
    };
    return w.__mockState?.invokeLog ?? [];
  });
}
