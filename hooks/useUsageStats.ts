"use client";

import { useEffect } from "react";

import { useUsageStore } from "@/lib/stores/usage";

/**
 * Claude Pro/Max 使用量の自動 fetch hook（PRJ-012 Stage B）。
 *
 * - マウント時 1 回 + 30 秒間隔で `get_usage_stats` を poll。
 * - store の `fetchStats()` 自体に二重 fetch ガードがあるので、他の場所で
 *   同じ hook を複数マウントしても害はない（ただし通常は `UsageStatsCard` が
 *   サイドバーに 1 つだけ）。
 * - unmount 時に `clearInterval` する。
 *
 * 使い方:
 * ```tsx
 * function UsageStatsCard() {
 *   useUsageStats();
 *   const stats = useUsageStore((s) => s.stats);
 *   ...
 * }
 * ```
 */
const POLL_INTERVAL_MS = 30_000;

export function useUsageStats(): void {
  const fetchStats = useUsageStore((s) => s.fetchStats);

  useEffect(() => {
    // 初回 fetch
    void fetchStats();

    // 定期更新
    const id = window.setInterval(() => {
      void fetchStats();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [fetchStats]);
}
