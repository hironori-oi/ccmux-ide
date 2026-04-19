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
  /** 直近の push 値。初期値は null（UI 側は placeholder を出す）。 */
  monitor: MonitorState | null;
  setMonitor: (state: MonitorState) => void;
  reset: () => void;
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  monitor: null,
  setMonitor: (monitor) => set({ monitor }),
  reset: () => set({ monitor: null }),
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
