"use client";

import { useEffect } from "react";

import { useClaudeUsageStore } from "@/lib/stores/claude-usage";

/**
 * Claude CLI 公式レート制限の自動 fetch hook（PRJ-012 Round A）。
 *
 * - マウント時に 1 回 + 30 秒間隔で `get_claude_rate_limits` を poll。
 * - store の `fetchLimits()` 自体に二重 fetch ガードがあるので、複数の
 *   コンポーネントで同時にマウントしても害はない（StatusBar と
 *   UsageStatsCard の双方で呼ぶ前提）。
 * - unmount 時に `clearInterval` する。
 *
 * Rust backend 側にも 30 秒 cache があるため、実際に CLI を spawn する頻度は
 * 30 秒に 1 回に抑えられる。
 */
const POLL_INTERVAL_MS = 30_000;

export function useClaudeRateLimits(): void {
  const fetchLimits = useClaudeUsageStore((s) => s.fetchLimits);

  useEffect(() => {
    void fetchLimits();

    const id = window.setInterval(() => {
      void fetchLimits();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [fetchLimits]);
}
