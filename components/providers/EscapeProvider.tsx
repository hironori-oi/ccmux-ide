"use client";

import { useEffect } from "react";

import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";
import { usePermissionRequestsStore } from "@/lib/stores/permission-requests";
import { useSessionStore } from "@/lib/stores/session";

/**
 * PRJ-012 v1.21.0 (DEC-067) → v1.25.0 で hotkey を独立化。
 *
 * 旧仕様 (v1.21.0): Esc キーで応答中の query を sidecar 側 interrupt。
 *   問題: Esc は modal 閉じる用途と競合し、PermissionDialog 中に応答も走ると
 *   「停止したつもりが拒否になった」事故が起きていた。
 *
 * 新仕様 (v1.25.0): 停止専用ホットキー **Cmd/Ctrl+.** を新設し、
 *   Esc は modal 閉じる専用に整理 (interrupt は呼ばない)。
 *
 *   ChatGPT / Claude.ai / Cursor 等で広く使われている "Stop generation" 系
 *   ショートカット慣習に揃える。Tauri WebView2 全体で window keydown を
 *   bubble phase listen して捕捉する。
 *
 * ## 設計方針
 *
 * - 起動条件: `event.key === "."` AND (event.ctrlKey || event.metaKey)
 *   - shiftKey / altKey は無視 (誤爆防止のため厳密判定はしない)
 *   - IME composition 中は no-op (compositionend 待ち)
 *   - 別 modifier (Ctrl+Shift+.) でも反応してよい (停止意図が明確)
 * - 以下のいずれかに該当する場合は no-op:
 *   1. IME composition 中 (`event.isComposing` または `keyCode === 229`)
 *   2. 現 active pane の active session が無い、または status が idle / completed
 *      (応答中でなければ interrupt する意味がない)
 * - PermissionDialog 等の他 modal 表示中でも Cmd/Ctrl+. は受理する
 *   (Esc と違い停止専用 hotkey なので競合する modal close 操作が無い)。
 *
 * ## 失敗時の挙動
 *
 * - send_agent_interrupt が throw した場合は logger.debug で残し、UI は黙って継続。
 *   (interrupt は idempotent なので「該当 session に in-flight 無し」エラーは無害)
 * - status の reset は sidecar からの `interrupted` event 経由で
 *   useAllProjectsSidecarListener が捌く (本 provider は明示的に reset しない)。
 *
 * ## 命名
 *
 * 後方互換のため component 名は `EscapeProvider` のまま。export を変えると
 * Shell.tsx 側 import を破壊するため改名は v2 以降に持ち越す。実体は
 * 「応答停止 hotkey provider」だが、ファイル名は段階的に rename 予定。
 */
export function EscapeProvider(): null {
  useEffect(() => {
    function isStopHotkey(e: KeyboardEvent): boolean {
      // `.` キー + Ctrl もしくは Cmd (Meta)。
      // `e.key` は IME や locale で揺れる可能性があるが、`.` は ASCII で安定。
      if (e.key !== ".") return false;
      return e.ctrlKey || e.metaKey;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!isStopHotkey(e)) return;
      // IME 変換中は no-op
      if (e.isComposing || e.keyCode === 229) return;
      // 既に preventDefault 済の場合は尊重
      if (e.defaultPrevented) return;

      // active pane の current session を引き、応答中なら interrupt
      const chat = useChatStore.getState();
      const activePaneId = chat.activePaneId;
      const sessionId = chat.panes[activePaneId]?.currentSessionId ?? null;
      if (!sessionId) return;

      const sessionStore = useSessionStore.getState();
      const volatile = sessionStore.volatile[sessionId];
      const status = volatile?.status ?? "idle";
      if (status !== "thinking" && status !== "streaming") {
        // idle / completed / error は interrupt 対象外
        return;
      }

      // 停止 hotkey として消費するため preventDefault。
      // (browser default は無いが念のため将来の binding 衝突を防ぐ)
      e.preventDefault();

      // PermissionDialog 表示中でも停止 hotkey は受理する。
      // (本 hotkey は modal close と競合しないため抑制不要)
      const pendingPerm = usePermissionRequestsStore.getState().pending;
      void (async () => {
        try {
          await callTauri<void>("send_agent_interrupt", { sessionId });
          logger.debug("[stop-hotkey] sent interrupt", {
            sessionId,
            permissionPending: pendingPerm.length,
          });
        } catch (err) {
          // 該当 session に in-flight 無し等は idempotent (Rust 側 Err でも UX 害なし)
          logger.debug("[stop-hotkey] interrupt failed (may be benign)", err);
        }
      })();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
