"use client";

import { useEffect } from "react";

import { PermissionDialog } from "@/components/permission/PermissionDialog";
import { logger } from "@/lib/logger";
import { callTauri, onTauriEvent } from "@/lib/tauri-api";
import {
  usePermissionRequestsStore,
  type PermissionRequest,
} from "@/lib/stores/permission-requests";
import { useSessionPreferencesStore } from "@/lib/stores/session-preferences";
import { useChatStore } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";

/**
 * PRJ-012 v1.13.0 (DEC-059 案B): ツール承認ダイアログのグローバルマウント。
 *
 * ## 責務
 *  1. `sumi://permission-request` Tauri event を listen し、Frontend キューに
 *     enqueue する
 *  2. session-preferences の `allowedTools` / `deniedTools` にヒットする要求は
 *     dialog を出さずに自動で resolve する (auto-resolve 経路)
 *  3. PermissionDialog をシングルトンとしてマウント (app root から 1 箇所のみ)
 *
 * ## 循環依存対策
 *
 * useSessionPreferencesStore と usePermissionRequestsStore は相互 import
 * していない (permission-requests は session-preferences を知らない、
 * PermissionProvider のコールバック内で `getState()` 経由で参照)。循環なし。
 */
export function PermissionProvider(): React.ReactElement {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        unlisten = await onTauriEvent<RustPermissionEventPayload>(
          "sumi://permission-request",
          (payload) => {
            if (cancelled) return;
            const req = extractPermissionRequest(payload);
            if (!req) {
              logger.warn(
                "[permission] malformed permission-request event ignored",
                payload,
              );
              return;
            }
            // auto-resolve: session preferences に記録済なら dialog をスキップ
            if (tryAutoResolve(req)) return;
            usePermissionRequestsStore.getState().enqueue(req);
          },
        );
      } catch (e) {
        // tauri 未起動環境 (Storybook / 単体テスト) でも落とさない
        logger.warn("[permission] listen failed (non-tauri env?):", e);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // 無視
        }
      }
    };
  }, []);

  return <PermissionDialog />;
}

// ---------------------------------------------------------------------------
// payload parser
// ---------------------------------------------------------------------------

/**
 * Rust `dispatch_permission_request_if_any` が emit する event payload の shape。
 *
 *   {
 *     projectId: "<uuid>",
 *     envelope: {
 *       type: "permission_request",
 *       id:   "<prompt req id>",
 *       payload: {
 *         requestId:         "<sidecar-permId>",
 *         sessionId:         "<sidecar --project-id>",
 *         promptRequestId:   "<prompt req id>",
 *         toolName:          "WebSearch",
 *         toolInput:         { query: "..." },
 *         requestId (dup):    ditto  (sendWithReqId が requestId を重複で差す
 *                                      がここでは sidecar が先に書いたものが勝つ)
 *       }
 *     }
 *   }
 */
interface RustPermissionEventPayload {
  // DEC-063 (v1.17.0): Rust が転送時に sessionId / projectId を両方 payload に含める。
  sessionId: string;
  projectId: string;
  envelope: {
    type: string;
    id: string;
    payload: {
      requestId?: string;
      sessionId?: string | null;
      projectId?: string | null;
      toolName?: string;
      toolInput?: unknown;
    };
  };
}

function extractPermissionRequest(
  payload: RustPermissionEventPayload,
): PermissionRequest | null {
  const env = payload?.envelope;
  if (!env || env.type !== "permission_request") return null;
  const p = env.payload;
  if (!p) return null;
  if (typeof p.requestId !== "string" || p.requestId.length === 0) return null;
  if (typeof p.toolName !== "string" || p.toolName.length === 0) return null;

  const toolInput: Record<string, unknown> =
    p.toolInput && typeof p.toolInput === "object" && !Array.isArray(p.toolInput)
      ? (p.toolInput as Record<string, unknown>)
      : {};

  return {
    id: p.requestId,
    // DEC-063 (v1.17.0): Rust 側 event wrapper の sessionId を優先、envelope 側を fallback。
    sessionId: payload.sessionId || (typeof p.sessionId === "string" ? p.sessionId : ""),
    projectId: payload.projectId,
    toolName: p.toolName,
    toolInput,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// auto-resolve (session-preferences lookup)
// ---------------------------------------------------------------------------

/**
 * session-preferences の allowedTools / deniedTools を確認し、該当があれば
 * 自動 resolve する。該当無しなら false を返す (呼出側で enqueue する)。
 *
 * 判定 scope:
 *   1. 対象 pane の sessionPreferences[currentSessionId]
 *   2. 1 が未登録なら perProject[projectId] (sticky fallback)
 *
 * 優先順位は deniedTools > allowedTools (deny の方が保守的な挙動)。
 */
function tryAutoResolve(req: PermissionRequest): boolean {
  const prefs = pickPrefsForRequest(req);
  if (!prefs) return false;

  if (prefs.deniedTools?.includes(req.toolName)) {
    void sendAutoResponse(req, "deny");
    return true;
  }
  if (prefs.allowedTools?.includes(req.toolName)) {
    void sendAutoResponse(req, "allow");
    return true;
  }
  return false;
}

function pickPrefsForRequest(
  req: PermissionRequest,
):
  | { allowedTools?: string[]; deniedTools?: string[] }
  | null {
  const prefStore = useSessionPreferencesStore.getState();

  // session レベルの検索 (active pane の currentSessionId)
  try {
    const activeProjectId = useProjectStore.getState().activeProjectId;
    if (activeProjectId === req.projectId) {
      const chat = useChatStore.getState();
      const paneId = chat.activePaneId;
      const sid = chat.panes[paneId]?.currentSessionId ?? null;
      if (sid) {
        const s = prefStore.perSession[sid];
        if (s) return s;
      }
    }
  } catch {
    // noop
  }

  // project sticky fallback
  const p = prefStore.perProject[req.projectId];
  return p ?? null;
}

/**
 * auto-resolve 時の sidecar 応答送信 (PermissionDialog と同じ shape を直接送る)。
 * toolInput はそのまま echo する (updatedInput 省略時の sidecar デフォルト挙動と一致)。
 */
async function sendAutoResponse(
  req: PermissionRequest,
  behavior: "allow" | "deny",
): Promise<void> {
  try {
    await callTauri<void>("resolve_permission_request", {
      // DEC-063 (v1.17.0): sidecar は session 単位。
      sessionId: req.sessionId,
      requestId: req.id,
      decision:
        behavior === "allow"
          ? { behavior: "allow", updatedInput: req.toolInput }
          : {
              behavior: "deny",
              message: "セッション設定により拒否されました",
              interrupt: false,
            },
    });
    logger.debug("[permission] auto-resolve", {
      tool: req.toolName,
      behavior,
    });
  } catch (e) {
    // Rust / sidecar への書込失敗は致命。log のみ残し、sidecar 側 auto-deny
    // timer (60秒) に任せる fail-safe 動作で終息させる。
    logger.error("[permission] auto-resolve send failed", e);
  }
}
