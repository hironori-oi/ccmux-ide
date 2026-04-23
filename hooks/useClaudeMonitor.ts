"use client";

import { useEffect } from "react";

import { onTauriEvent } from "@/lib/tauri-api";
import { useMonitorStore, type MonitorState } from "@/lib/stores/monitor";
import { useSessionStore } from "@/lib/stores/session";

/**
 * `monitor:tick` を listen して Zustand store に同期するグローバル hook
 * （PM-164）。
 *
 * `Shell` コンポーネント（ルート 3 ペイン）が 1 度だけマウントすることを想定。
 * 同一 event に対して複数 listener を張っても機能はするが、store 更新は冪等
 * なので害はない。それでも一応 unmount 時に unlisten する。
 *
 * 使い方:
 *
 * ```tsx
 * export default function Shell() {
 *   useClaudeMonitor();
 *   return ...;
 * }
 * ```
 */
export function useClaudeMonitor(): void {
  const setMonitor = useMonitorStore((s) => s.setMonitor);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    void (async () => {
      unlistenFn = await onTauriEvent<MonitorState>("monitor:tick", (payload) => {
        // payload は Rust 側 serde で JSON 化されたもの。field 名は snake_case。
        // PM-984: tick 時点の currentSessionId を snapshot key に使い、
        // session 別の直近値を保持する。TrayContextBar が session 切替時に
        // その session の snapshot を引くのに使う。
        const sid = useSessionStore.getState().currentSessionId;
        setMonitor(payload, sid);
      });
    })();

    return () => {
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, [setMonitor]);
}
