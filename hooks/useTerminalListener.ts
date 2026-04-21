"use client";

import { useEffect, useRef } from "react";

import { logger } from "@/lib/logger";
import { onTauriEvent } from "@/lib/tauri-api";
import { resetTerminalViewport } from "@/components/terminal/terminal-reset-registry";
import { useTerminalStore } from "@/lib/stores/terminal";

/**
 * PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル singleton listener。
 *
 * `pty:{id}:exit` event を全 pty について購読し、terminal store に exit code を
 * 反映する。`pty:{id}:data` は TerminalPane が自前で listen するので本 hook では
 * 扱わない (xterm.write は React ref 経由で同期に必要なため)。
 *
 * Shell.tsx から **1 度だけ** mount されることを想定 (singleton)。
 * 全 pty の exit を 1 listener で捌くため、pty 毎の listener 登録は不要。
 * （`pty:*:exit` という glob listen は Tauri 2.x では提供されていないので、
 *  store の terminals map を subscribe して「新しく増えた pty_id に対応する
 *  listener を per-pty で動的 register + cleanup」する戦略を取る。）
 */
export function useTerminalListener(): void {
  // 既に listen 済の pty_id を tracking (重複登録回避)。
  const subscribedRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const unsubscribeStore = useTerminalStore.subscribe((state) => {
      const current = subscribedRef.current;
      const liveIds = new Set(Object.keys(state.terminals));

      // 新規 pty: listener を登録。
      for (const id of liveIds) {
        if (current.has(id)) continue;
        let unlistenFn: (() => void) | null = null;
        let disposed = false;
        current.set(id, () => {
          disposed = true;
          if (unlistenFn) unlistenFn();
        });
        void onTauriEvent<{ code: number | null } | number | null>(
          `pty:${id}:exit`,
          (payload) => {
            const code =
              typeof payload === "number"
                ? payload
                : payload && typeof payload === "object" && "code" in payload
                  ? payload.code
                  : null;
            useTerminalStore.getState().markExited(id, code ?? null);
            logger.debug("[terminal-listener] exit", { ptyId: id, code });
            // PM-921 Bug 1 auto-reset: claude CLI の `/exit` で子プロセスが
            // 終了した直後に xterm viewport を強制 reset する。これだけでは
            // cmd.exe の prompt 描画崩れが完全には直らないケースもあるが、
            // 手動「クリア」ボタン (Ctrl+Shift+L) で確実に復旧できる。
            // 注: pty が既に kill 済 (× ボタン) の場合も exit event は発火するが
            // TerminalPane は pty kill 後すぐ unmount されるので registry が
            // 空になり resetTerminalViewport は no-op で安全。
            resetTerminalViewport(id);
          }
        )
          .then((unlisten) => {
            if (disposed) {
              unlisten();
              return;
            }
            unlistenFn = unlisten;
          })
          .catch((e) => {
            logger.warn("[terminal-listener] listen failed", { id, e });
          });
      }

      // 消えた pty: listener を解除。
      for (const [id, cleanup] of current) {
        if (!liveIds.has(id)) {
          cleanup();
          current.delete(id);
        }
      }
    });

    return () => {
      unsubscribeStore();
      for (const cleanup of subscribedRef.current.values()) {
        cleanup();
      }
      subscribedRef.current.clear();
    };
  }, []);
}
