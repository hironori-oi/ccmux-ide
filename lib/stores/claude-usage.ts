"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type { ClaudeRateLimits } from "@/lib/types";

/**
 * Claude CLI 公式レート制限の Zustand store（PRJ-012 Round A）。
 *
 * Rust backend `get_claude_rate_limits` を叩いて、`claude /usage` の TUI 出力
 * から抽出された 5h / weekly / Sonnet only の残量 / reset 時刻を取得する。
 *
 * - Stage B の `useUsageStore`（JSONL 集計）と独立して動作する。UI 側で
 *   両者を並べて表示し、公式値を優先扱いにする。
 * - 30 秒 poll（`hooks/useClaudeRateLimits.ts` 側で interval を制御）。Rust
 *   backend にも 30 秒 cache があるので、interval を縮めても backend 側で
 *   guard される。
 * - `isLoading` 中は再 fetch を skip する二重ガード。
 */

interface ClaudeUsageState {
  limits: ClaudeRateLimits | null;
  isLoading: boolean;
  error: string | null;
  /** 最後に成功した fetch の epoch ms（UI のデバッグ表示用）。 */
  lastFetchedAt: number | null;
}

interface ClaudeUsageActions {
  fetchLimits: () => Promise<void>;
  reset: () => void;
}

type ClaudeUsageStore = ClaudeUsageState & ClaudeUsageActions;

const INITIAL: ClaudeUsageState = {
  limits: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
};

export const useClaudeUsageStore = create<ClaudeUsageStore>((set, get) => ({
  ...INITIAL,

  async fetchLimits() {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const limits = await callTauri<ClaudeRateLimits>("get_claude_rate_limits");
      set({
        limits,
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
