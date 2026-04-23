"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";

/**
 * PRJ-012 v1.13.0 (DEC-059 案B): ツール実行承認 UI の保留キュー store。
 *
 * ## 責務
 *
 * sidecar が canUseTool callback 内で emit した `permission_request` を
 * Rust 経由で `sumi://permission-request` Tauri event として受け取り、
 * Frontend 側のキューに積む。PermissionDialog が `pending[0]` を表示し、
 * ユーザー応答を `resolve_permission_request` command で sidecar に返送する。
 *
 * ## 非循環依存メモ
 *
 * session-preferences store は本 store から **動的 import では無く** zustand の
 * `getState()` 経由で直接参照する (PermissionProvider が listen callback 内で
 * 呼ぶ)。両 store は相互に importしないため循環は発生しない。
 *
 * ## 複数 session/ project の扱い
 *
 * DEC-059 の初期段階では全 project 分の request を単一キューに積み、Dialog 先頭
 * から 1 件ずつ捌く。Dialog には `sessionId` と `toolName` をバッジ表示して、
 * どの project に対する要求かを視認できるようにする。
 */

export interface PermissionRequest {
  /** sidecar 発行の UUID (permission_response の request_id として返す)。 */
  id: string;
  /**
   * Rust 側 agent.rs が同梱する project_id (sidecar 起動時の argv
   * `--project-id=<uuid>` 由来)。sidecar stdin に permission_response を
   * 書き戻すときに callTauri に渡す。
   */
  projectId: string;
  /**
   * UI 表示用の session バッジ。sidecar argv の project_id を echo している
   * だけだが、将来の拡張 (session_id 伝搬) に備えて独立 field とする。
   */
  sessionId: string | null;
  /** SDK が呼び出そうとした tool 名 (例: "WebSearch" / "mcp__server__tool")。 */
  toolName: string;
  /** tool input (任意の shape)。Dialog 側で tool に応じた summary 整形を行う。 */
  toolInput: Record<string, unknown>;
  /** キューに enqueue した時刻 (UNIX ms)。stale 判定や表示順に使う。 */
  createdAt: number;
}

/**
 * PermissionDialog が「常に許可/拒否」を選択した際の永続スコープ。
 *
 * - "once"    : 今回のみ (session-preferences に記録しない)
 * - "session" : 当 session + 当 project (perProject 経由 sticky)
 */
export type PermissionRememberScope = "once" | "session";

export interface PermissionDecisionPayload {
  behavior: "allow" | "deny";
  /** allow 時のみ。未指定なら sidecar は原 input を pass-through。 */
  updatedInput?: Record<string, unknown>;
  /** deny 時のメッセージ。未指定時は sidecar 側で既定文言が適用される。 */
  message?: string;
  /** deny 時に assistant を interrupt するか (通常 false)。 */
  interrupt?: boolean;
  /** "session" なら session-preferences に記録し以降同 tool は auto-resolve する。 */
  remember: PermissionRememberScope;
}

interface PermissionRequestsState {
  pending: PermissionRequest[];
  /** `sumi://permission-request` 受信時の入口。既に同 id が居る場合は de-dup。 */
  enqueue: (req: PermissionRequest) => void;
  /**
   * ユーザー応答を Rust / sidecar に返送してキューから除去する。
   *
   * `remember: "session"` の場合、呼び出し側は本 store とは別に
   * session-preferences.rememberToolPermission も呼ぶ責務を持つ
   * (本 store は永続設定を知らない = 責務分離)。
   */
  resolve: (
    requestId: string,
    decision: PermissionDecisionPayload,
  ) => Promise<void>;
  /** 特定 id を (UI 未操作で) 破棄したい場合の逃げ道。主にテスト用。 */
  dismiss: (requestId: string) => void;
  /** 全消去 (セッション切替 / project 削除等)。 */
  clearAll: () => void;
}

export const usePermissionRequestsStore = create<PermissionRequestsState>(
  (set, get) => ({
    pending: [],

    enqueue: (req) =>
      set((state) => {
        // 同じ id が既に居れば de-dup (Rust 側の event 多重 emit 保険)
        if (state.pending.some((p) => p.id === req.id)) {
          return state;
        }
        return { pending: [...state.pending, req] };
      }),

    resolve: async (requestId, decision) => {
      const target = get().pending.find((p) => p.id === requestId);
      if (!target) {
        // 既に別経路 (interrupt / clearAll) で除去済: no-op
        return;
      }
      // Rust へ決定を送信。失敗時は UI にトーストで通知したいが、sonner は
      // PermissionDialog 側で catch して表示する (循環依存を避けるため本 store
      // は toast を直接触らない)。
      await callTauri<void>("resolve_permission_request", {
        projectId: target.projectId,
        requestId,
        decision: buildSidecarDecision(decision, target),
      });

      // dequeue
      set((state) => ({
        pending: state.pending.filter((p) => p.id !== requestId),
      }));
    },

    dismiss: (requestId) =>
      set((state) => ({
        pending: state.pending.filter((p) => p.id !== requestId),
      })),

    clearAll: () => set({ pending: [] }),
  }),
);

/**
 * Frontend の decision payload を sidecar が期待する shape に整形する。
 *
 * sidecar 側 (`handlePermissionResponse`) は以下を受け付ける:
 *   - `{ behavior: "allow", updatedInput?: Record<string, unknown> }`
 *   - `{ behavior: "deny",  message?: string, interrupt?: boolean }`
 *
 * `remember` は sidecar に渡さない (session-preferences への記録は Frontend 側
 * の責務)。updatedInput 未指定時は request 時の toolInput を echo する (SDK は
 * `updatedInput` 省略でも動くが、明示しておく方が sidecar ログの可読性が高い)。
 */
function buildSidecarDecision(
  decision: PermissionDecisionPayload,
  target: PermissionRequest,
): Record<string, unknown> {
  if (decision.behavior === "allow") {
    return {
      behavior: "allow",
      updatedInput: decision.updatedInput ?? target.toolInput,
    };
  }
  return {
    behavior: "deny",
    message: decision.message ?? "ユーザーが拒否しました",
    interrupt: decision.interrupt ?? false,
  };
}
