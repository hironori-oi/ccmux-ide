"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type { UsageStats } from "@/lib/types";

/**
 * Claude Pro/Max 使用量の Zustand store（PRJ-012 Stage B）。
 *
 * Rust backend の `get_usage_stats` command を叩いて
 * `~/.claude/projects/**\/*.jsonl` の集計値を取得する。
 *
 * - イベント駆動ではなく poll ベース（`hooks/useUsageStats.ts` が 30s 間隔で
 *   `fetchStats()` を呼ぶ）。JSONL は Claude Code CLI の書き込み頻度が低いため
 *   30s で十分。
 * - 集計処理は Rust 側 `spawn_blocking` に乗せているので UI スレッドは
 *   ブロックされない。
 */

interface UsageStoreState {
  stats: UsageStats | null;
  isLoading: boolean;
  error: string | null;
  /** 最後に成功した fetch の epoch ms（UI でデバッグ表示する場合に使用）。 */
  lastFetchedAt: number | null;
}

interface UsageStoreActions {
  fetchStats: () => Promise<void>;
  reset: () => void;
}

type UsageStore = UsageStoreState & UsageStoreActions;

const INITIAL: UsageStoreState = {
  stats: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
};

export const useUsageStore = create<UsageStore>((set, get) => ({
  ...INITIAL,

  async fetchStats() {
    // 二重 fetch の防止（前回 fetch 中なら skip）。
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const stats = await callTauri<UsageStats>("get_usage_stats");
      set({
        stats,
        isLoading: false,
        error: null,
        lastFetchedAt: Date.now(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ isLoading: false, error: msg });
    }
  },

  reset() {
    set({ ...INITIAL });
  },
}));
