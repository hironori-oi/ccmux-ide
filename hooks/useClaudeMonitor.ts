"use client";

import { useEffect } from "react";

import { onTauriEvent } from "@/lib/tauri-api";
import { useMonitorStore, type MonitorState } from "@/lib/stores/monitor";

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
        setMonitor(payload);
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
