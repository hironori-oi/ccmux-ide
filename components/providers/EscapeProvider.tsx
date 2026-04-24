"use client";

import { useEffect } from "react";

import { logger } from "@/lib/logger";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";
import { usePermissionRequestsStore } from "@/lib/stores/permission-requests";
import { useSessionStore } from "@/lib/stores/session";

/**
 * PRJ-012 v1.21.0 (DEC-067): グローバル Esc キー listener。
 *
 * Cursor の Claude Code 互換 UX として、応答中 (thinking / streaming) に Esc を
 * 押すと現 active session の query を sidecar 側で interrupt する。
 *
 * ## 設計方針
 *
 * - Tauri WebView2 全体で window.addEventListener("keydown") に capture せず
 *   bubble phase で listen する (IME composition / Radix Dialog 等の Escape を
 *   先に拾わない)。
 * - 以下のいずれかに該当する場合は no-op (= 既存挙動を尊重):
 *   1. IME composition 中 (`event.isComposing` または `keyCode === 229`)
 *   2. PermissionDialog が開いている (permission-requests.pending.length > 0)
 *      → PermissionDialog 自身の Esc=deny ハンドラに任せる
 *   3. その他の Radix Dialog (open 状態) が DOM に存在
 *      → `[role="dialog"][data-state="open"]` を querySelector で検出
 *   4. 現 active pane の active session が無い、または status が idle / completed
 *      （応答中でなければ interrupt する意味がない、modifier 含めデフォルト挙動を尊重）
 * - modifier 状態 (Ctrl / Shift / Alt / Meta) はチェックしない (Cursor 互換)。
 *   ただし上記の no-op 条件はそのまま適用される。
 *
 * ## 失敗時の挙動
 *
 * - send_agent_interrupt が throw した場合は logger.debug で残し、UI は黙って継続。
 *   (interrupt は idempotent なので「該当 session に in-flight 無し」エラーは無害)
 * - status の reset は sidecar からの `interrupted` event 経由で
 *   useAllProjectsSidecarListener が捌く (本 provider は明示的に reset しない)。
 */
export function EscapeProvider(): null {
  useEffect(() => {
    function isOpenDialogPresent(): boolean {
      // Radix Dialog (Permission / Updater 等) は open 時に
      // `[role="dialog"][data-state="open"]` で表現される。Permission は別途
      // store でチェック済だが、UpdateDialog 等の他 dialog も尊重する。
      try {
        const found = document.querySelectorAll(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
        );
        return found.length > 0;
      } catch {
        return false;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // IME 変換中の Esc は IME 解除を優先 (compositionend を待つ)
      if (e.isComposing || e.keyCode === 229) return;

      // 既に preventDefault 済 (textarea 内 SlashPalette / AtMentionPicker close 等)
      if (e.defaultPrevented) return;

      // PermissionDialog 表示中は dialog 側 Esc=deny ハンドラ優先
      const pendingPerm = usePermissionRequestsStore.getState().pending;
      if (pendingPerm.length > 0) return;

      // その他 Radix Dialog open 中は dialog の close を優先
      if (isOpenDialogPresent()) return;

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

      // ここまで来たら interrupt を発火する。preventDefault は不要 (Esc の他副作用なし)。
      void (async () => {
        try {
          await callTauri<void>("send_agent_interrupt", { sessionId });
          logger.debug("[escape] sent interrupt", { sessionId });
        } catch (err) {
          // 該当 session に in-flight 無し等は idempotent (Rust 側 Err でも UX 害なし)
          logger.debug("[escape] interrupt failed (may be benign)", err);
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
