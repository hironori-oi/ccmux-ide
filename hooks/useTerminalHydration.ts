"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";
import { useTerminalBufferStore } from "@/lib/stores/terminal-buffer";
import { useTerminalStore } from "@/lib/stores/terminal";
import { useProjectStore } from "@/lib/stores/project";
import { useWorkspaceLayoutStore } from "@/lib/stores/workspace-layout";

/**
 * PRJ-012 v1.27.0 (2026-04-26): リロード後のターミナル復元 hook。
 *
 * Sumi をリロード（Ctrl+R / Tauri WebView 再描画）すると、Frontend の
 * `useTerminalStore` (memory only) は空になる一方、Rust 側 `PtyState` は
 * 親 Tauri プロセスが生きている限り pty を保持し続ける。v1.26.x までは
 * Frontend がこの「生きている pty」を完全に忘れて、UI から触れない状態に
 * なっていた（再 D&D で新規 pty が spawn される / workspace-layout の
 * slot.refId は dead 参照に）。
 *
 * 本 hook は Sumi mount 直後に **1 度だけ**:
 *   1. Rust `list_active_terminals` を呼び、生きている pty 一覧を取得
 *   2. `useTerminalBufferStore.reconcileWithLivePtys` で死んだ pty の buffer
 *      を localStorage から evict
 *   3. `useTerminalStore.hydrateFromActive` で未知 pty を terminals map に補充
 *      （これにより `useTerminalListener.reconcile` が data + exit listener を
 *      attach し、入力が届くようになる）
 *   4. `useWorkspaceLayoutStore.repairDeadTerminalRefs` で slot.refId が死んだ
 *      pty を指している slot を null に戻す
 *   5. 復元 pty 数 >= 1 のときだけ toast.info で 1 行通知
 *
 * Shell.tsx から `useTerminalListener` の隣に 1 回だけ mount される singleton。
 *
 * ## React.StrictMode 二重 mount への配慮
 *
 * dev mode で useEffect が 2 回走ってもリスト取得 + hydrate は idempotent
 * （`hydrateFromActive` は既知 entry を skip する。`repairDeadTerminalRefs` は
 * 同 ref が live なら no-op）。toast の重複だけ避けるため `didRunRef` で
 * 一度動いたら早期 return する。
 */
export function useTerminalHydration(): void {
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const list = await callTauri<
          Array<{
            ptyId: string;
            projectId: string | null;
            sessionId: string | null;
            cwd: string;
            shell: string;
            startedAt: number;
          }>
        >("list_active_terminals");

        if (cancelled) return;
        const livePtyIds = list.map((p) => p.ptyId);

        // 1) buffer 側の dead pty 掃除（localStorage 容量を解放）。
        useTerminalBufferStore.getState().reconcileWithLivePtys(livePtyIds);

        // 2) terminals store 側の hydration（既知 entry は保持、未知 pty を補充）。
        const defaultProjectId =
          useProjectStore.getState().activeProjectId ?? null;
        const added = useTerminalStore
          .getState()
          .hydrateFromActive(list, defaultProjectId);

        // 3) workspace-layout 側の slot.refId 修復。
        const repaired = useWorkspaceLayoutStore
          .getState()
          .repairDeadTerminalRefs(livePtyIds);

        logger.debug("[useTerminalHydration] reconciled", {
          live: livePtyIds.length,
          added,
          repairedSlots: repaired,
        });

        // 4) UI 通知: 実際に生きていた pty が >= 1 個ある場合のみ。
        // 「未知 pty を新たに store に追加した」場合に限る（既知のままなら通知不要）。
        if (added >= 1) {
          toast.info(
            `${added} 個のターミナルを復元しました`,
            { duration: 3000 },
          );
        }
      } catch (e) {
        // list_active_terminals が失敗しても致命でない（hot reload 等で
        // 既に handler が register されていない瞬間に呼ぶと空 / error が返る）。
        logger.warn("[useTerminalHydration] list_active_terminals failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
