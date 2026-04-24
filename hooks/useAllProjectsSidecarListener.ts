"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { logger } from "@/lib/logger";
import { onTauriEvent } from "@/lib/tauri-api";
import {
  useChatStore,
  DEFAULT_PANE_ID,
  persistMessageToDb,
  type ChatPaneState,
  type ChatMessage,
  type ToolUseEvent,
} from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import type { SessionSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// PRJ-012 PM-810 (v3.6 Step 1): Split pane session ID routing
// ---------------------------------------------------------------------------
//
// sidecar event の payload には PM-810 以降 `requestId` が同梱される (sidecar
// 側 `sendWithReqId` helper)。InputArea は送信直前に `claimNextSendForPane` を
// 呼んで project ごとの FIFO キューに paneId を push し、listener は当該 project
// からの最初の event 到着時に FIFO から pop → `reqIdToPane` に固定 mapping を
// 作る。以降同 requestId の event は map から paneId を引いて dispatch する。
//
// ## map lifecycle
// - claim: InputArea の handleSend 冒頭で push
// - resolve (最初の event): `pendingSendsByProject[projectId]` から FIFO pop →
//   `reqIdToPane[reqId] = paneId`
// - cleanup: result / done / error / interrupted 受信時に `reqIdToPane` から delete
//
// ## Fallback
// - 旧 sidecar (requestId 無し) or map lookup 失敗時は `DEFAULT_PANE_ID` に dispatch
//   (後方互換 / graceful degrade)

interface ReqIdPane {
  projectId: string;
  paneId: string;
}

/** requestId (ev.id or ev.payload.requestId) → paneId の確定 mapping。 */
const reqIdToPane = new Map<string, ReqIdPane>();

/** 送信時に push、最初の event 到着時に pop される per-project FIFO キュー。 */
const pendingSendsByProject = new Map<string, string[]>();

/**
 * InputArea の handleSend 冒頭で呼ぶ: この project の次回送信 requestId を
 * 当該 paneId に予約する。並列送信でも FIFO で順番通りに紐付く。
 *
 * sidecar が `sendWithReqId` 経由で `payload.requestId` を乗せているため、
 * 厳密には最初の event 到着時点で map に落とし込まれれば、以降は reqId で
 * 直接引けるようになる。
 */
export function claimNextSendForPane(
  projectId: string,
  paneId: string,
): void {
  const arr = pendingSendsByProject.get(projectId) ?? [];
  arr.push(paneId);
  pendingSendsByProject.set(projectId, arr);
  // PM-810 regression hotfix (2026-04-20): dogfood 中の pane routing 可視化。
  // grep pattern: "[pm810-claim]". queue が増えない / 減らないと送信結果の
  // dispatch 先が DEFAULT_PANE_ID に fallback する signal。
  // PM-746 (2026-04-20): production gate のため logger.debug に移行。
  logger.debug("[pm810-claim]", {
    projectId,
    paneId,
    queue: [...arr],
    mapSize: reqIdToPane.size,
  });
}

/**
 * sidecar event から当該 paneId を逆引きする。
 *
 * 優先順位:
 *   1. `ev.payload.requestId` / `ev.id` が `reqIdToPane` 確定済 → その paneId
 *   2. 初見 reqId → `pendingSendsByProject[projectId]` から FIFO pop して
 *      `reqIdToPane` に記録 → 以降同 reqId は 1 で引ける
 *   3. FIFO も空なら DEFAULT_PANE_ID (後方互換 fallback)
 *
 * `ready` / parse error 等で reqId が prompt に紐づかないケースは
 * pending queue を汚さないため FIFO pop しない (step 3 の DEFAULT で return)。
 */
function resolvePaneForEvent(
  projectId: string,
  ev: SidecarEvent,
): string {
  const payloadReqId =
    ev.payload &&
    typeof ev.payload === "object" &&
    !Array.isArray(ev.payload) &&
    typeof (ev.payload as { requestId?: unknown }).requestId === "string"
      ? ((ev.payload as { requestId: string }).requestId)
      : null;
  const reqId = payloadReqId ?? ev.id;

  // prompt と無関係な event (ready / parse error) は FIFO pop しない。
  // ready は main loop 起動時の 1 回だけ、parse は reqId="parse" 固定。
  if (ev.type === "ready" || reqId === "parse" || reqId === "ready") {
    return DEFAULT_PANE_ID;
  }

  const known = reqIdToPane.get(reqId);
  if (known) return known.paneId;

  const queue = pendingSendsByProject.get(projectId);
  const popped =
    queue && queue.length > 0 ? queue.shift() ?? DEFAULT_PANE_ID : DEFAULT_PANE_ID;
  // queue を即 empty にするなら Map entry 自体はそのまま (次 push で再利用)。
  reqIdToPane.set(reqId, { projectId, paneId: popped });
  // PM-810 regression hotfix (2026-04-20): dogfood 中の pane routing 可視化。
  // grep pattern: "[pm810-resolve]". `paneId==="main"` 固定で流れ続けたら
  // claim 側が送信前に呼ばれていない = regression。
  // PM-746 (2026-04-20): production gate のため logger.debug に移行。
  logger.debug("[pm810-resolve]", {
    projectId,
    paneId: popped,
    reqId,
    type: ev.type,
    hadPayloadReqId: payloadReqId !== null,
    queueLeft: queue?.length ?? 0,
  });
  return popped;
}

/**
 * prompt lifecycle 終了 event で reqIdToPane を掃除する (メモリリーク防止)。
 *
 * `result` / `done` / `error` / `interrupted` のいずれかを受けたら map から削除。
 * 同 reqId が以降再登場することは SDK プロトコル上ない。
 */
function releaseReqIdIfTerminal(ev: SidecarEvent): void {
  if (
    ev.type === "done" ||
    ev.type === "result" ||
    ev.type === "error" ||
    ev.type === "interrupted"
  ) {
    const payloadReqId =
      ev.payload &&
      typeof ev.payload === "object" &&
      !Array.isArray(ev.payload) &&
      typeof (ev.payload as { requestId?: unknown }).requestId === "string"
        ? ((ev.payload as { requestId: string }).requestId)
        : null;
    const reqId = payloadReqId ?? ev.id;
    if (reqId && reqId !== "parse" && reqId !== "ready") {
      const existed = reqIdToPane.has(reqId);
      reqIdToPane.delete(reqId);
      // PM-810 regression hotfix (2026-04-20): dogfood 中の release 可視化。
      // grep pattern: "[pm810-release]".
      // PM-746 (2026-04-20): production gate のため logger.debug に移行。
      logger.debug("[pm810-release]", {
        reqId,
        type: ev.type,
        existed,
        mapSize: reqIdToPane.size,
      });
    }
  }
}

/**
 * PRJ-012 v3.5.11 Chunk E (Cross-Project Events) — 全 project の sidecar event を
 * 常時購読する hook。
 *
 * ## 背景（v3.5.10 までの致命バグ）
 *
 * 旧 `ChatPanel` は `agent:${activeProjectId}:raw` を listen しており、
 * `activeProjectId` 変化のたびに unlisten → 新 activeProjectId で再 listen して
 * いた。結果として、project A で送信中に B に切替えると **A の sidecar event を
 * 誰も受け取らない** → A の `streaming` / `activity` が永久 stuck し、戻ってきても
 * 「思考中」のままで完了しないバグになっていた。
 *
 * ## 新方針
 *
 * - Shell から 1 回だけ呼ぶ singleton hook。
 * - 登録済み全 project の `agent:{projectId}:raw` / `:stderr` / `:terminated`
 *   を listen 登録する。
 * - event 受信時、`projectId === activeProjectId` なら `panes` を更新、
 *   そうでなければ `projectSnapshots[projectId]` を更新する
 *   （`useChatStore.applyToProjectPane`）。
 * - これにより:
 *   1. 切替後も前 project の thinking → tool_use → streaming → complete が裏で進行
 *   2. ProjectRail の activity dot が独立して動き続ける（snapshot 経由で読まれる）
 *   3. project に戻ってきた瞬間に最新 state が `restoreProjectSnapshot` で復元
 *
 * ## listener の重複登録対策
 *
 * - useEffect deps は `projects.map(p => p.id).join("|")`。
 *   配列 reference が変わっても **id 集合が同じなら再登録しない**。
 * - cancelled flag で StrictMode の double-invoke / race による二重 listen を防ぐ。
 *
 * ## 受信 pane 制約 (v3.5.11 Step 1)
 *
 * sidecar event 自体に session_id / pane_id が含まれていないため、event は
 * **全て DEFAULT_PANE_ID ("main")** に dispatch する。Split mode の second
 * pane が送信した結果も "main" に書き込まれる（旧来の挙動踏襲）。
 *
 * Split second pane を独立 streaming させる正解は v3.6 PM-810 で sidecar event
 * に session_id を同梱する設計拡張で対応予定。
 */
export function useAllProjectsSidecarListener(): void {
  // DEC-063 (v1.17.0): event prefix が session 単位になったため、sessions 配列を
  // key 化して subscribe する。session 追加 / 削除で再登録。
  const sessions = useSessionStore((s) => s.sessions);

  const sessionIdsKey = sessions
    .map((s) => s.id)
    .sort()
    .join("|");

  useEffect(() => {
    let cancelled = false;
    // sessionId -> [unlisten_raw, unlisten_stderr, unlisten_terminated]
    const unlisteners: Record<string, Array<() => void>> = {};

    const liveSessions = useSessionStore.getState().sessions;

    const projectIdOf = (sessionId: string): string | null => {
      const s = useSessionStore.getState().sessions.find((x: SessionSummary) => x.id === sessionId);
      return s?.projectId ?? null;
    };

    liveSessions.forEach((session) => {
      const sessionId = session.id;
      const rawEvent = `agent:${sessionId}:raw`;
      const stderrEvent = `agent:${sessionId}:stderr`;
      const termEvent = `agent:${sessionId}:terminated`;

      void (async () => {
        try {
          const u1 = await onTauriEvent<string>(rawEvent, (payload) => {
            const activeProjectId =
              useProjectStore.getState().activeProjectId;
            const projectId = projectIdOf(sessionId);
            if (!projectId) return;
            dispatchSidecarEvent(projectId, sessionId, payload, activeProjectId);
          });
          const u2 = await onTauriEvent<string>(stderrEvent, (payload) => {
            const trimmed = payload.trim();
            if (!trimmed) return;
            // eslint-disable-next-line no-console
            console.warn(`[sidecar stderr:${sessionId}]`, trimmed);
            const activeProjectId =
              useProjectStore.getState().activeProjectId;
            const projectId = projectIdOf(sessionId);
            if (
              projectId &&
              activeProjectId === projectId &&
              /ready$|sidecar starting|parent disconnected|stdin closed/i.test(
                trimmed
              )
            ) {
              toast.message(`sidecar: ${trimmed.slice(0, 120)}`);
            }
          });
          const u3 = await onTauriEvent<number | null>(termEvent, (code) => {
            const activeProjectId =
              useProjectStore.getState().activeProjectId;
            const projectId = projectIdOf(sessionId);
            if (!projectId) return;
            // 該当 session が紐づく pane を idle に戻す (session 単位の逆引き)。
            const paneId = findPaneIdForSession(projectId, sessionId, activeProjectId) ?? DEFAULT_PANE_ID;
            useChatStore.getState().applyToProjectPane(
              projectId,
              paneId,
              activeProjectId,
              (p) => ({
                ...p,
                streaming: false,
                activity: { kind: "idle" },
              })
            );
            if (activeProjectId === projectId) {
              toast.error(`Claude sidecar が終了しました: ${code ?? "unknown"}`);
            }
          });

          if (cancelled) {
            u1?.();
            u2?.();
            u3?.();
            return;
          }
          unlisteners[sessionId] = [u1, u2, u3];
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            `[useAllProjectsSidecarListener] listen failed for session ${sessionId}:`,
            e
          );
        }
      })();
    });

    return () => {
      cancelled = true;
      for (const fns of Object.values(unlisteners)) {
        for (const f of fns) {
          try {
            f();
          } catch {
            // unlisten 失敗は無視
          }
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey]);
}

/**
 * DEC-063 (v1.17.0): 該当 sessionId が紐づく paneId を逆引きする。
 *
 * - active project 内の panes: currentSessionId or creatingSessionId が一致する pane
 * - 非 active project の snapshot: 同上
 * - 見つからなければ null (呼出側は DEFAULT_PANE_ID fallback)
 */
function findPaneIdForSession(
  projectId: string,
  sessionId: string,
  activeProjectId: string | null,
): string | null {
  const chatState = useChatStore.getState();
  const paneMap: Record<string, ChatPaneState> | undefined =
    projectId === activeProjectId
      ? chatState.panes
      : chatState.projectSnapshots[projectId];
  if (!paneMap) return null;
  for (const [paneId, pane] of Object.entries(paneMap)) {
    if (pane.currentSessionId === sessionId) return paneId;
    if (pane.creatingSessionId === sessionId) return paneId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NDJSON dispatch
// ---------------------------------------------------------------------------

/**
 * DEC-063 (v1.17.0): session 単位 event `agent:{sessionId}:raw` の payload
 * (NDJSON 1〜複数行) を 1 レコードずつ parse し、chat store に反映する。
 */
function dispatchSidecarEvent(
  projectId: string,
  sessionId: string,
  payload: string,
  activeProjectId: string | null
): void {
  const lines = payload.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as SidecarEvent;
      applyEventToState(projectId, sessionId, activeProjectId, ev);
      releaseReqIdIfTerminal(ev);
    } catch {
      // 行境界またぎや非 JSON は無視
    }
  }
}

/**
 * sidecar event 1 件を chat store に反映する。
 *
 * 旧 `ChatPanel.handleSidecarEvent` の closure ベース実装を、
 * `applyToProjectPane(projectId, paneId, activeProjectId, updater)` 経由で
 * **active 判定を内包した state mutation** に置き換えたもの。
 *
 * - apply: 単一 pane を 1 回 update する shorthand。
 * - readPane: 「現在の pane state」を読む（snapshot or panes）。streaming
 *   message の存在判定や ID 検索で使う。
 *
 * v3.5.11 Step 1 では DEFAULT_PANE_ID 固定。Split second pane への独立配信は
 * v3.6 PM-810 で sidecar event に session_id を同梱する形で対応する。
 */
function applyEventToState(
  projectId: string,
  sessionId: string,
  activeProjectId: string | null,
  ev: SidecarEvent
): void {
  // DEC-063 (v1.17.0): event は session 単位で届くため、session → pane の
  // 逆引きを第一優先にする。見つからなければ PM-810 の reqId / FIFO ベース
  // 逆引き、それも空なら DEFAULT_PANE_ID。
  const paneFromSession = findPaneIdForSession(projectId, sessionId, activeProjectId);
  const paneId = paneFromSession ?? resolvePaneForEvent(projectId, ev);

  const apply = (updater: (p: ChatPaneState) => ChatPaneState) => {
    useChatStore.getState().applyToProjectPane(
      projectId,
      paneId,
      activeProjectId,
      updater
    );
  };

  const readPane = (): ChatPaneState | undefined => {
    const state = useChatStore.getState();
    if (projectId === activeProjectId) {
      return state.panes[paneId];
    }
    return state.projectSnapshots[projectId]?.[paneId];
  };

  /**
   * v3.5.13 crit fix: 確定メッセージ（assistant 完成版 / tool 完了版）を DB に永続化する。
   *
   * applyEventToState は chat store の action（setMessages / updateStreamingMessage 等）を
   * 経由せず、panes / projectSnapshots を直接 mutate する設計のため、chat.ts 側の
   * 永続化パスが走らない。本 helper で pane の currentSessionId を引いて append_message
   * invoke を直接呼び、active / 非 active どちらの project でも DB に残す。
   *
   * - session id が null の場合 skip（= InputArea 経由で送信前に createNewSession 済み
   *   のはずだが、想定外 event でも落ちない defensive なガード）
   * - persistMessageToDb 内部で id dedup が効くため streaming 中に多重で呼んでも冪等
   *
   * NOTE: streaming delta は persist しない（finalize 相当のタイミング = result/done
   *       / tool_result 確定時にのみ呼ぶ）。パフォーマンスとコスト最適化のため。
   */
  const persistIfSession = (message: ChatMessage): void => {
    const pane = readPane();
    const sid = pane?.currentSessionId ?? null;
    if (!sid) return;
    void persistMessageToDb(sid, message);
  };

  if (ev.type === "ready") {
    return;
  }

  // PM-830 (v3.5.14): SDK 側 session UUID の attach 通知。
  // sidecar が `system.subtype === "init"` を捕捉した直後に 1 回 emit する。
  // 該当 pane の currentSessionId を引き、DB の sessions.sdk_session_id に保存する。
  // active project でも非 active project でも、その pane の session に紐づくため
  // readPane() (active 経路は panes、非 active は projectSnapshots) を再利用する。
  if (ev.type === "sdk_session_ready") {
    const p = ev.payload as
      | { sdkSessionId?: unknown; resumed?: unknown }
      | undefined;
    const sdkSessionId =
      typeof p?.sdkSessionId === "string" && p.sdkSessionId.length > 0
        ? p.sdkSessionId
        : null;
    // v3.5.18 PM-830 hotfix debug (2026-04-20): SDK 初期化直後の session_id と
    // pane の currentSessionId マッピング状況を log。resumed=false なのに 2 回目
    // 以降の prompt で来たら resume が効いていない signal。dogfood 期間中残置。
    // PM-746 (2026-04-20): production gate のため logger.debug に移行。
    logger.debug(
      "[sdk_session_ready]",
      {
        projectId,
        activeProjectId,
        sdkSessionId,
        resumed: p?.resumed,
      },
    );
    if (!sdkSessionId) return;
    const pane = readPane();
    const targetSessionId = pane?.currentSessionId ?? null;
    if (!targetSessionId) {
      // session id 未紐付 (送信前に createNewSession を await していない経路) の
      // 場合は安全のため skip。次回送信で再度 init event が emit され attach される。
      // eslint-disable-next-line no-console
      console.warn(
        "[sdk_session_ready] skipped: pane has no currentSessionId",
        { projectId, activeProjectId, sdkSessionId },
      );
      return;
    }
    // v3.5.19 PM-830 hotfix (2026-04-20): session cache 二重 safety net.
    //
    // root cause: 新規 session 作成後 (createNewSession) に sessions 配列が stale な
    // ままだと、updateSessionSdkId の楽観更新 (state.sessions.map(...)) は該当 entry
    // が無いため no-op となり、cache に sdkSessionId が反映されない。結果、次回送信
    // 時に getSdkSessionIdFromCache が null を返し resume=undefined で送ってしまう。
    //
    // fix: 楽観更新 → DB 書込の後、cache に当該 sessionId が存在するか確認し、
    // 不在なら fetchSessions() で cache を強制 refresh する（activeProjectId 経由の
    // filter 付き）。これにより新規 session + sdk_session_ready 組合せでも確実に
    // cache に載る。
    //
    // 注: updateSessionSdkId の内部で set() が走った直後なので、一度 getState() で
    // 最新 sessions を読み直してから判定する。
    void (async () => {
      await useSessionStore
        .getState()
        .updateSessionSdkId(targetSessionId, sdkSessionId);
      const hasEntry = useSessionStore
        .getState()
        .sessions.some((s) => s.id === targetSessionId);
      if (!hasEntry) {
        // eslint-disable-next-line no-console
        console.warn(
          "[sdk_session_ready] cache miss after update, refetching sessions",
          { targetSessionId, sdkSessionId },
        );
        await useSessionStore.getState().fetchSessions();
      }
    })();
    return;
  }

  if (ev.type === "message") {
    const p = ev.payload as AgentSdkMessage | undefined;
    if (!p) return;

    if (p.type === "assistant" && p.message) {
      const text = extractText(p.message.content);
      const toolUses = extractToolUses(p.message.content);
      const assistantId = `${ev.id}:a`;

      // activity を先に倒す
      if (toolUses.length > 0) {
        const tu = toolUses[0];
        apply((pane) => ({
          ...pane,
          activity: {
            kind: "tool_use",
            toolName: tu.name,
            toolInput: tu.input,
          },
        }));
      } else if (text) {
        apply((pane) => ({
          ...pane,
          activity: { kind: "streaming" },
        }));
      }

      if (text) {
        const cur = readPane();
        const existed = cur?.messages.find((m) => m.id === assistantId);
        if (existed) {
          const delta = text.slice(existed.content.length);
          if (delta) {
            apply((pane) => ({
              ...pane,
              messages: pane.messages.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + delta, streaming: true }
                  : m
              ),
            }));
          }
        } else {
          const newMessage: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: text,
            streaming: true,
          };
          apply((pane) => ({
            ...pane,
            messages: [...pane.messages, newMessage],
          }));
        }
      }

      for (const tu of toolUses) {
        const tuId = `${ev.id}:t:${tu.id}`;
        const cur = readPane();
        const existed = cur?.messages.find((m) => m.id === tuId);
        if (!existed) {
          const toolEvent: ToolUseEvent = {
            name: tu.name,
            input: tu.input,
            status: "pending",
          };
          apply((pane) => ({
            ...pane,
            messages: [
              ...pane.messages,
              { id: tuId, role: "tool", content: "", toolUse: toolEvent },
            ],
          }));
        }
      }
      return;
    }

    if (p.type === "user" && p.message) {
      const results = extractToolResults(p.message.content);
      if (results.length > 0) {
        apply((pane) => ({ ...pane, activity: { kind: "streaming" } }));
      }
      for (const r of results) {
        const tuId = `${ev.id}:t:${r.tool_use_id}`;
        const cur = readPane();
        const match = cur?.messages.find(
          (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
        );
        const targetId = match ? match.id : tuId;
        apply((pane) => ({
          ...pane,
          messages: pane.messages.map((m) =>
            m.id === targetId && m.toolUse
              ? {
                  ...m,
                  toolUse: {
                    ...m.toolUse,
                    status: r.is_error ? "error" : "success",
                    output: r.content,
                  },
                }
              : m
          ),
        }));
        // v3.5.13: tool 完了（success/error）時に 1 回だけ DB 永続化
        const updatedPane = readPane();
        const finalizedTool = updatedPane?.messages.find(
          (m) => m.id === targetId && m.toolUse
        );
        if (finalizedTool) {
          persistIfSession(finalizedTool);
        }
      }
      return;
    }
    return;
  }

  if (ev.type === "tool_result") {
    const p = ev.payload as AgentSdkMessage | undefined;
    if (!p || !p.message) return;
    const results = extractToolResults(p.message.content);
    if (results.length > 0) {
      apply((pane) => ({ ...pane, activity: { kind: "streaming" } }));
    }
    for (const r of results) {
      const tuId = `${ev.id}:t:${r.tool_use_id}`;
      const cur = readPane();
      const match = cur?.messages.find(
        (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
      );
      const targetId = match ? match.id : tuId;
      apply((pane) => ({
        ...pane,
        messages: pane.messages.map((m) =>
          m.id === targetId && m.toolUse
            ? {
                ...m,
                toolUse: {
                  ...m.toolUse,
                  status: r.is_error ? "error" : "success",
                  output: r.content,
                },
              }
            : m
        ),
      }));
      // v3.5.13: tool 完了時に DB 永続化
      const updatedPane = readPane();
      const finalizedTool = updatedPane?.messages.find(
        (m) => m.id === targetId && m.toolUse
      );
      if (finalizedTool) {
        persistIfSession(finalizedTool);
      }
    }
    return;
  }

  if (ev.type === "result") {
    // v3.5.13: streaming 中だった assistant messages を確定 & DB 永続化
    const before = readPane();
    const streamingAssistants =
      before?.messages.filter(
        (m) => m.role === "assistant" && m.streaming
      ) ?? [];
    apply((pane) => ({
      ...pane,
      streaming: false,
      activity: { kind: "complete" },
      messages: pane.messages.map((m) =>
        m.role === "assistant" && m.streaming ? { ...m, streaming: false } : m
      ),
    }));
    for (const m of streamingAssistants) {
      persistIfSession({ ...m, streaming: false });
    }
    return;
  }

  if (ev.type === "error") {
    const payload = ev.payload as
      | { message?: string; kind?: string; requestedResume?: string }
      | undefined;
    const msg = payload?.message ?? "unknown";

    // PM-830: resume 先 SDK session が見つからない / expired 等で失敗した場合、
    // sidecar が kind:"resume_failed" を payload に含めて通知してくる。
    // 該当 session の sdkSessionId を null reset → 次回送信は新規 session 扱い
    // (= context は失われるが UX は止まらない fallback)。toast でユーザに通知する。
    if (payload?.kind === "resume_failed") {
      const pane = readPane();
      const targetSessionId = pane?.currentSessionId ?? null;
      if (targetSessionId) {
        void useSessionStore
          .getState()
          .updateSessionSdkId(targetSessionId, null);
      }
      if (projectId === activeProjectId) {
        toast.warning(
          "Claude の前回会話を引き継げませんでした。新規セッションとして再送信してください。"
        );
      }
      apply((pane) => ({
        ...pane,
        streaming: false,
        activity: { kind: "error", message: msg },
      }));
      return;
    }

    // active project の error のみ toast
    if (projectId === activeProjectId) {
      toast.error(`Claude エラー: ${msg}`);
    }
    apply((pane) => ({
      ...pane,
      streaming: false,
      activity: { kind: "error", message: msg },
    }));
    return;
  }

  if (ev.type === "done") {
    // v3.5.13: "done" 単独でも streaming 中の assistant を確定 + DB 永続化
    const before = readPane();
    const streamingAssistants =
      before?.messages.filter(
        (m) => m.role === "assistant" && m.streaming
      ) ?? [];
    apply((pane) => ({
      ...pane,
      streaming: false,
      activity: { kind: "complete" },
      messages: pane.messages.map((m) =>
        m.role === "assistant" && m.streaming ? { ...m, streaming: false } : m
      ),
    }));
    for (const m of streamingAssistants) {
      persistIfSession({ ...m, streaming: false });
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// helpers (旧 ChatPanel から移植、shape は同一)
// ---------------------------------------------------------------------------

interface SidecarEvent {
  type:
    | "ready"
    | "message"
    | "tool_result"
    | "result"
    | "error"
    | "done"
    | "system"
    /** v3.3.1: interrupt 要求で query を AbortController 経由で中断完了した通知。 */
    | "interrupted"
    /** PM-830: SDK 側 session UUID の attach 通知 (sidecar → frontend)。 */
    | "sdk_session_ready";
  id: string;
  payload: unknown;
}

interface AgentSdkMessage {
  type: "assistant" | "user" | "system";
  message?: {
    content?: unknown;
  };
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function extractToolUses(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUseBlock[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "tool_use" &&
      typeof (block as { id?: unknown }).id === "string" &&
      typeof (block as { name?: unknown }).name === "string"
    ) {
      const b = block as {
        id: string;
        name: string;
        input?: Record<string, unknown>;
      };
      out.push({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.input ?? {},
      });
    }
  }
  return out;
}

function extractToolResults(content: unknown): Array<{
  tool_use_id: string;
  is_error: boolean;
  content: string;
}> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ tool_use_id: string; is_error: boolean; content: string }> =
    [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as ToolResultBlock).type === "tool_result" &&
      typeof (block as ToolResultBlock).tool_use_id === "string"
    ) {
      const b = block as ToolResultBlock;
      let text = "";
      if (typeof b.content === "string") {
        text = b.content;
      } else if (Array.isArray(b.content)) {
        text = extractText(b.content);
      }
      out.push({
        tool_use_id: b.tool_use_id,
        is_error: Boolean(b.is_error),
        content: text,
      });
    }
  }
  return out;
}
