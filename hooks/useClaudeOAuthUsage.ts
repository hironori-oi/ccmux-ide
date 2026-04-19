"use client";

import { useEffect } from "react";

import { useOAuthUsageStore } from "@/lib/stores/oauth-usage";

/**
 * Anthropic 公式 OAuth Usage API の自動 fetch hook（PRJ-012 Round D'）。
 *
 * - マウント時に 1 回 + 60 秒間隔で `get_oauth_usage` を poll。
 * - store の `fetchUsage()` 自体に二重 fetch ガードがあるので、複数の
 *   コンポーネント（StatusBar + UsageStatsCard）で同時にマウントしても
 *   害はない。
 * - Rust backend 側に 5 分 cache があるため、1 分間隔で叩いても実 HTTP
 *   リクエストは 5 分に 1 回に抑えられる（Beta API 側への配慮）。
 * - unmount 時に `clearInterval` する。
 */
const POLL_INTERVAL_MS = 60_000;

export function useClaudeOAuthUsage(): void {
  const fetchUsage = useOAuthUsageStore((s) => s.fetchUsage);

  useEffect(() => {
    void fetchUsage();

    const id = window.setInterval(() => {
      void fetchUsage();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [fetchUsage]);
}
