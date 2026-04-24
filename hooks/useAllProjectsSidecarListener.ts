"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { logger } from "@/lib/logger";
import { onTauriEvent } from "@/lib/tauri-api";
import {
  useChatStore,
  persistMessageToDb,
  type ChatMessage,
  type ToolUseEvent,
} from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import type { SessionSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// PRJ-012 v1.18.0 (DEC-064): Session 単位 event routing
// ---------------------------------------------------------------------------
//
// v1.17.0 までは pane 単位で event を dispatch していた (reqId FIFO → paneId
// 逆引き、fallback で active pane)。この方式は session A 送信中に pane を B
// に切替えると A の応答が B 表示中の pane に誤表示される混線を起こした。
//
// v1.18.0 では event は **session_id で直接 append** する。event の届いた
// session に対して `useChatStore.getState().appendMessage(sessionId, ...)` を
// 呼ぶだけで、pane は viewport として currentSessionId === sessionId の時だけ
// MessageList selector が描画する。pane 切替とは完全独立。
//
// InputArea の `claimNextSendForPane` / reqId FIFO 仕組みは不要になった
// （session_id が event に乗っているので逆引き不要）。InputArea 側の呼出も
// v1.18.0 で撤去する。

/**
 * InputArea の handleSend 冒頭から呼ばれていた legacy API。v1.18.0 で no-op
 * 化し、呼出側削除までの過渡措置として残す（type 破壊的変更を避ける）。
 */
export function claimNextSendForPane(
  _projectId: string,
  _paneId: string,
): void {
  // no-op (v1.18.0 DEC-064)
}

/**
 * PRJ-012 v3.5.11 Chunk E (Cross-Project Events) — 全 session の sidecar event
 * を常時購読する hook。v1.18.0 では session_id で直接 dispatch する。
 */
export function useAllProjectsSidecarListener(): void {
  // session 追加 / 削除で再登録するための key。
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
      const s = useSessionStore
        .getState()
        .sessions.find((x: SessionSummary) => x.id === sessionId);
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
            const activeProjectId = useProjectStore.getState().activeProjectId;
            const projectId = projectIdOf(sessionId);
            dispatchSidecarEvent(projectId, sessionId, payload, activeProjectId);
          });
          const u2 = await onTauriEvent<string>(stderrEvent, (payload) => {
            const trimmed = payload.trim();
            if (!trimmed) return;
            // eslint-disable-next-line no-console
            console.warn(`[sidecar stderr:${sessionId}]`, trimmed);
            const activeProjectId = useProjectStore.getState().activeProjectId;
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
            const activeProjectId = useProjectStore.getState().activeProjectId;
            const projectId = projectIdOf(sessionId);
            // v1.18.0: session 単位で streaming / activity を idle に戻す。
            useChatStore.getState().setSessionStreaming(sessionId, false);
            useChatStore
              .getState()
              .setSessionActivity(sessionId, { kind: "idle" });
            useSessionStore.getState().setSessionStatus(sessionId, "idle");
            if (projectId && activeProjectId === projectId) {
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

// ---------------------------------------------------------------------------
// NDJSON dispatch
// ---------------------------------------------------------------------------

/**
 * v1.18.0 (DEC-064): session 単位 event `agent:{sessionId}:raw` の payload
 * (NDJSON 1〜複数行) を 1 レコードずつ parse し、session 単位で state に反映する。
 */
function dispatchSidecarEvent(
  projectId: string | null,
  sessionId: string,
  payload: string,
  activeProjectId: string | null
): void {
  const lines = payload.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as SidecarEvent;
      applyEventToSession(projectId, sessionId, activeProjectId, ev);
    } catch {
      // 行境界またぎや非 JSON は無視
    }
  }
}

/**
 * sidecar event 1 件を session state に反映する（v1.18.0 DEC-064）。
 */
function applyEventToSession(
  projectId: string | null,
  sessionId: string,
  activeProjectId: string | null,
  ev: SidecarEvent
): void {
  const chat = useChatStore.getState();
  const sessionStore = useSessionStore.getState();

  const markActivity = () => {
    sessionStore.touchSessionActivity(sessionId);
  };

  const readMessages = (): ChatMessage[] =>
    useChatStore.getState().sessionMessages[sessionId] ?? [];

  if (ev.type === "ready") {
    return;
  }

  // PM-830: SDK 側 session UUID attach 通知
  if (ev.type === "sdk_session_ready") {
    const p = ev.payload as
      | { sdkSessionId?: unknown; resumed?: unknown }
      | undefined;
    const sdkSessionId =
      typeof p?.sdkSessionId === "string" && p.sdkSessionId.length > 0
        ? p.sdkSessionId
        : null;
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
    void (async () => {
      await useSessionStore
        .getState()
        .updateSessionSdkId(sessionId, sdkSessionId);
      const hasEntry = useSessionStore
        .getState()
        .sessions.some((s) => s.id === sessionId);
      if (!hasEntry) {
        // eslint-disable-next-line no-console
        console.warn(
          "[sdk_session_ready] cache miss after update, refetching sessions",
          { sessionId, sdkSessionId },
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
      markActivity();

      if (toolUses.length > 0) {
        const tu = toolUses[0];
        chat.setSessionActivity(sessionId, {
          kind: "tool_use",
          toolName: tu.name,
          toolInput: tu.input,
        });
        sessionStore.setSessionStatus(sessionId, "streaming");
      } else if (text) {
        chat.setSessionActivity(sessionId, { kind: "streaming" });
        sessionStore.setSessionStatus(sessionId, "streaming");
      }

      if (text) {
        const existed = readMessages().find((m) => m.id === assistantId);
        if (existed) {
          const delta = text.slice(existed.content.length);
          if (delta) {
            chat.updateStreamingMessage(sessionId, assistantId, delta);
          }
        } else {
          const newMessage: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: text,
            streaming: true,
          };
          chat.appendMessage(sessionId, newMessage);
        }
      }

      for (const tu of toolUses) {
        const tuId = `${ev.id}:t:${tu.id}`;
        const existed = readMessages().find((m) => m.id === tuId);
        if (!existed) {
          const toolEvent: ToolUseEvent = {
            name: tu.name,
            input: tu.input,
            status: "pending",
          };
          chat.appendToolUse(sessionId, tuId, toolEvent);
        }
      }
      return;
    }

    if (p.type === "user" && p.message) {
      const results = extractToolResults(p.message.content);
      if (results.length > 0) {
        chat.setSessionActivity(sessionId, { kind: "streaming" });
        sessionStore.setSessionStatus(sessionId, "streaming");
      }
      for (const r of results) {
        const match = readMessages().find(
          (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
        );
        const targetId = match ? match.id : `${ev.id}:t:${r.tool_use_id}`;
        chat.updateToolUseStatus(
          sessionId,
          targetId,
          r.is_error ? "error" : "success",
          r.content,
        );
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
      chat.setSessionActivity(sessionId, { kind: "streaming" });
      sessionStore.setSessionStatus(sessionId, "streaming");
    }
    for (const r of results) {
      const match = readMessages().find(
        (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
      );
      const targetId = match ? match.id : `${ev.id}:t:${r.tool_use_id}`;
      chat.updateToolUseStatus(
        sessionId,
        targetId,
        r.is_error ? "error" : "success",
        r.content,
      );
    }
    return;
  }

  if (ev.type === "result") {
    // streaming 中だった assistant messages を確定 & DB 永続化
    const before = readMessages();
    const streamingAssistants = before.filter(
      (m) => m.role === "assistant" && m.streaming
    );
    for (const m of streamingAssistants) {
      chat.finalizeStreamingMessage(sessionId, m.id);
    }
    chat.setSessionStreaming(sessionId, false);
    chat.setSessionActivity(sessionId, { kind: "complete" });
    sessionStore.setSessionStatus(sessionId, "idle");
    markActivity();
    return;
  }

  if (ev.type === "error") {
    const payload = ev.payload as
      | { message?: string; kind?: string; requestedResume?: string }
      | undefined;
    const msg = payload?.message ?? "unknown";

    // PM-830: resume 失敗時の fallback
    if (payload?.kind === "resume_failed") {
      void useSessionStore.getState().updateSessionSdkId(sessionId, null);
      if (projectId === activeProjectId) {
        toast.warning(
          "Claude の前回会話を引き継げませんでした。新規セッションとして再送信してください。"
        );
      }
      chat.setSessionStreaming(sessionId, false);
      chat.setSessionActivity(sessionId, { kind: "error", message: msg });
      sessionStore.setSessionStatus(sessionId, "error");
      return;
    }

    if (projectId === activeProjectId) {
      toast.error(`Claude エラー: ${msg}`);
    }
    chat.setSessionStreaming(sessionId, false);
    chat.setSessionActivity(sessionId, { kind: "error", message: msg });
    sessionStore.setSessionStatus(sessionId, "error");
    return;
  }

  if (ev.type === "done") {
    const before = readMessages();
    const streamingAssistants = before.filter(
      (m) => m.role === "assistant" && m.streaming
    );
    for (const m of streamingAssistants) {
      chat.finalizeStreamingMessage(sessionId, m.id);
    }
    chat.setSessionStreaming(sessionId, false);
    chat.setSessionActivity(sessionId, { kind: "complete" });
    sessionStore.setSessionStatus(sessionId, "idle");
    markActivity();
    return;
  }

  if (ev.type === "interrupted") {
    chat.setSessionStreaming(sessionId, false);
    chat.setSessionActivity(sessionId, { kind: "idle" });
    sessionStore.setSessionStatus(sessionId, "idle");
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
    | "interrupted"
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

// suppress unused var lint for persistMessageToDb import retention (used by chat store)
void persistMessageToDb;
