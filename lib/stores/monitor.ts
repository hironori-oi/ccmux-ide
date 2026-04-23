"use client";

import { create } from "zustand";

/**
 * Claude セッションモニタの Zustand store (PM-164)。
 *
 * Rust 側 `src-tauri/src/events/monitor.rs` が `monitor:tick` として push する
 * `MonitorState` を受け取り、サイドバー UI
 * （ContextGauge / SubAgentsList / TodosList）の描画ソースにする。
 *
 * イベント購読は `hooks/useClaudeMonitor.ts` が行う。本 store は値の格納庫。
 *
 * Rust の struct 名とキーは 1:1。数値・文字列・配列のみで `Date` / 関数を
 * 含まないので serde_json の JSON 化を経由しても欠損しない。
 */

/** 稼働中サブエージェント 1 件（Rust `SubAgentInfo`）。 */
export interface SubAgentInfo {
  id: string;
  name: string;
  /** "running" | "done" | "error" */
  status: "running" | "done" | "error" | string;
}

/** Todo 1 件（Rust `TodoItem`）。 */
export interface TodoItem {
  id: string;
  content: string;
  /** "pending" | "in_progress" | "completed" */
  status: "pending" | "in_progress" | "completed" | string;
}

/** Rust `MonitorState` と 1:1。snake_case に注意。 */
export interface MonitorState {
  tokens_used: number;
  tokens_max: number;
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_creation: number;
  model: string;
  git_branch: string | null;
  sub_agents: SubAgentInfo[];
  todos: TodoItem[];
  stop_reason: string | null;
  current_tool: string | null;
}

interface MonitorStore {
  /** 直近の push 値（全 session 共通の "latest"）。初期値は null。 */
  monitor: MonitorState | null;
  /**
   * PM-984: session 別の直近 monitor snapshot。
   * `monitor:tick` を受けた時点の currentSessionId をキーに保存する。
   * session 切替時はその snapshot を参照して「その session のコンテキスト
   * 使用量」を表示する。
   */
  perSession: Record<string, MonitorState>;
  setMonitor: (state: MonitorState, sessionId?: string | null) => void;
  reset: () => void;
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  monitor: null,
  perSession: {},
  setMonitor: (monitor, sessionId) =>
    set((s) => {
      // global monitor は常に最新値で上書き
      const next: Partial<MonitorStore> = { monitor };
      // PM-984: sessionId があれば perSession にも保存
      if (sessionId) {
        next.perSession = { ...s.perSession, [sessionId]: monitor };
      }
      return next;
    }),
  reset: () => set({ monitor: null, perSession: {} }),
}));

/** コンテキスト使用率（0..1）。monitor 未ロード時は 0。 */
export function selectContextRatio(s: MonitorStore): number {
  const m = s.monitor;
  if (!m || m.tokens_max === 0) return 0;
  return Math.min(1, m.tokens_used / m.tokens_max);
}

/** コンテキスト使用率（%、0..100）。表示用の整数。 */
export function selectContextPercent(s: MonitorStore): number {
  return Math.round(selectContextRatio(s) * 100);
}

/** 85% 以上で true（警告色切替用）。 */
export function selectIsNearLimit(s: MonitorStore): boolean {
  return selectContextPercent(s) >= 85;
}

/**
 * PM-984 / PM-985: 指定 session の monitor snapshot を取得するヘルパ。
 *
 * PM-985 で global fallback を廃止: session に固有の snapshot が無ければ null を
 * 返し、UI 側は「—」を表示する。session 別表示の意味を厳密にするため
 * （ユーザー要望: 無関係の session で最新値が出るのは混乱の元）。
 *
 * - session id が null （session 未選択）の場合は null を返す
 * - snapshot が無い session も null を返す（fallback せず）
 */
export function selectMonitorForSession(
  s: MonitorStore,
  sessionId: string | null
): MonitorState | null {
  if (!sessionId) return null;
  return s.perSession[sessionId] ?? null;
}

