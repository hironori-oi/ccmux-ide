"use client";

import { create } from "zustand";

import { callTauri } from "@/lib/tauri-api";
import type { ClaudeOAuthUsage } from "@/lib/types";

/**
 * Anthropic 公式 OAuth Usage API (`GET /api/oauth/usage`) の Zustand store
 * （PRJ-012 Round D'）。
 *
 * Rust backend `get_oauth_usage` を叩いて Pro/Max プランの 5 時間 / 7 日
 * ウィンドウ + 追加クレジットの使用率を取得する。
 *
 * - Round A / Round C の `claude-usage.ts`（CLI TUI parse）は廃止。
 * - Stage B の `useUsageStore` (JSONL 集計) と併用する前提。UI 側で公式値を
 *   「正規値」として優先表示し、Stage B は local 実測値として並べて出す。
 * - Rust backend に 5 分 cache が入っているため、frontend hook の 1 分
 *   interval 呼び出しでも実 HTTP は 5 分に 1 回。
 * - `isLoading` 中は再 fetch を skip する二重ガード。
 * - エラーは文字列で保持（Rust 側の日本語メッセージがそのまま表示される）。
 */

interface OAuthUsageState {
  usage: ClaudeOAuthUsage | null;
  isLoading: boolean;
  error: string | null;
  /** 最後に成功した fetch の epoch ms（UI の "N 分前" 算出用）。 */
  lastFetchedAt: number | null;
}

interface OAuthUsageActions {
  fetchUsage: () => Promise<void>;
  reset: () => void;
}

type OAuthUsageStore = OAuthUsageState & OAuthUsageActions;

const INITIAL: OAuthUsageState = {
  usage: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
};

export const useOAuthUsageStore = create<OAuthUsageStore>((set, get) => ({
  ...INITIAL,

  async fetchUsage() {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const usage = await callTauri<ClaudeOAuthUsage>("get_oauth_usage");
      set({
        usage,
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
