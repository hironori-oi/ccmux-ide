"use client";

import { useEffect, useRef } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";

import { logger } from "@/lib/logger";
import { onTauriEvent } from "@/lib/tauri-api";
import { resetTerminalViewport } from "@/components/terminal/terminal-reset-registry";
import { useTerminalStore } from "@/lib/stores/terminal";

/**
 * PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル singleton listener。
 *
 * `pty:{id}:exit` event を全 pty について購読し、terminal store に exit code を
 * 反映する。
 *
 * ## PM-941 (2026-04-20): scrollback 保持対応
 *
 * PM-935 で Terminal container を `viewMode === "terminal"` 時のみ React mount
 * する conditional mount に変更した結果、0x0 canvas race は構造的に消滅したが
 * tradeoff として tab 切替で xterm が dispose → scrollback が reset される
 * 回帰が残った。
 *
 * これを解消するため本 hook を以下のように拡張する:
 *
 * 1. `pty:{id}:data` event を **singleton で常時購読** し、module-level の
 *    shadow ring buffer (`ptyBuffers`, 上限 256KB / pty) に追記する。Terminal
 *    tab が closed (TerminalView unmount) の間も listener は生存し続けるため、
 *    再 mount 時に buffer を再現できる。
 * 2. subscriber pattern: `activeTerminals` map に **現在描画中の xterm instance**
 *    を tracking し、`pty:{id}:data` 到着時に buffer 追記と live write の両方を
 *    1 イベントハンドラで atomic に処理する (JS event loop 上、sync で動作)。
 * 3. TerminalPane は mount 時に `registerActiveTerminal(ptyId, term)` を呼ぶ。
 *    registration の瞬間に buffer 内容を `term.write` で一括再現し、その後の
 *    live event は subscriber 経路で流れる。unmount 時は
 *    `unregisterActiveTerminal(ptyId)` で解除するだけで buffer は保持される。
 * 4. pty 終了 (exit event 受信) または `removeTerminalPane` / `closeTerminal`
 *    で store から pty が消えたタイミングで buffer を clear する
 *    (memory leak 防止)。
 *
 * Shell.tsx から **1 度だけ** mount されることを想定 (singleton)。
 * 全 pty の exit を 1 listener で捌くため、pty 毎の listener 登録は不要。
 * （`pty:*:exit` という glob listen は Tauri 2.x では提供されていないので、
 *  store の terminals map を subscribe して「新しく増えた pty_id に対応する
 *  listener を per-pty で動的 register + cleanup」する戦略を取る。）
 */

// ---------------------------------------------------------------------------
// PM-941: scrollback buffer + active terminal registry (module-level singleton)
// ---------------------------------------------------------------------------

/**
 * ring buffer 上限。UTF-16 char 長ベースで conservative に 256KB (≒ 26 万文字)。
 * 実 byte では ASCII なら 256KB、multibyte でも概ね 512KB 以内に収まる。
 * pty あたり最大でも 1MB 未満なので pty 10 本でも 10MB 以内、実用上問題ない。
 */
const MAX_BUFFER_CHARS = 256 * 1024;

/** pty_id -> shadow scrollback buffer (TerminalView unmount 中も保持)。 */
const ptyBuffers = new Map<string, string>();

/** pty_id -> 現在画面に描画中の xterm instance (= subscriber)。 */
const activeTerminals = new Map<string, XTermTerminal>();

/** buffer に追記 (ring buffer trim 付き)。 */
function appendToBuffer(ptyId: string, chunk: string): void {
  if (!chunk) return;
  const prev = ptyBuffers.get(ptyId) ?? "";
  let next = prev + chunk;
  if (next.length > MAX_BUFFER_CHARS) {
    next = next.slice(next.length - MAX_BUFFER_CHARS);
  }
  ptyBuffers.set(ptyId, next);
}

/**
 * TerminalPane が mount し term.open() が成功した直後に呼ぶ。
 *
 * buffer 内容を一括 write してから active map に登録する。registration は
 * 同期実行されるため、登録直前に新規 data event が到着しても:
 *   - 登録前に handler が走る場合: buffer に append されるだけで term には
 *     まだ write されない。registration 時に buffer → term.write() で再現。
 *   - 登録後に handler が走る場合: buffer に append + term.write() の両方が
 *     実行される (正しい順序)。
 * いずれも重複 / 欠落なしで scrollback が再現される。
 */
export function registerActiveTerminal(
  ptyId: string,
  term: XTermTerminal,
): void {
  const buf = ptyBuffers.get(ptyId);
  if (buf) {
    try {
      term.write(buf);
    } catch (e) {
      logger.debug("[terminal-listener] replay write failed", { ptyId, e });
    }
  }
  activeTerminals.set(ptyId, term);
  logger.debug("[terminal-listener] register active", {
    ptyId,
    replayChars: buf?.length ?? 0,
  });
}

/**
 * TerminalPane unmount / dispose 時に呼ぶ。
 *
 * buffer は保持 (次回 mount で再現するため)。`term` 引数を取って現在登録中の
 * instance と一致する場合のみ削除する (remount 順序入れ替えで別 instance が
 * 既に register 済の場合に古い cleanup で新 instance を誤削除しないため)。
 */
export function unregisterActiveTerminal(
  ptyId: string,
  term: XTermTerminal,
): void {
  if (activeTerminals.get(ptyId) === term) {
    activeTerminals.delete(ptyId);
    logger.debug("[terminal-listener] unregister active", { ptyId });
  }
}

/**
 * buffer を明示削除する (pty 終了 / close 時の memory cleanup)。
 *
 * 本 hook 内部からは store 購読の cleanup で自動呼び出しされるため、通常は
 * 外部から呼ぶ必要はない。デバッグや将来の「terminal clear」UI 拡張用に
 * export しておく。
 */
export function clearPtyScrollback(ptyId: string): void {
  if (ptyBuffers.has(ptyId)) {
    ptyBuffers.delete(ptyId);
    logger.debug("[terminal-listener] clear scrollback", { ptyId });
  }
}

/**
 * テスト / デバッグ用に buffer 内容を取得する。通常 UI は
 * registerActiveTerminal 経由で透過に再現されるため本 API を直接使う必要はない。
 */
export function getPtyScrollback(ptyId: string): string {
  return ptyBuffers.get(ptyId) ?? "";
}

// ---------------------------------------------------------------------------
// useTerminalListener (Shell 直下で 1 度だけ mount される singleton hook)
// ---------------------------------------------------------------------------

export function useTerminalListener(): void {
  // 既に listen 済の pty_id を tracking (重複登録回避)。
  // value は `{ dispose: () => void }` で data / exit 両方の listener cleanup を集約する。
  const subscribedRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const unsubscribeStore = useTerminalStore.subscribe((state) => {
      const current = subscribedRef.current;
      const liveIds = new Set(Object.keys(state.terminals));

      // 新規 pty: exit + data listener を登録。
      for (const id of liveIds) {
        if (current.has(id)) continue;

        let exitUnlisten: (() => void) | null = null;
        let dataUnlisten: (() => void) | null = null;
        let disposed = false;

        // cleanup 関数を集約。disposed flag + 両 unlisten 実行。
        const dispose = () => {
          disposed = true;
          if (exitUnlisten) {
            try {
              exitUnlisten();
            } catch {
              // noop
            }
          }
          if (dataUnlisten) {
            try {
              dataUnlisten();
            } catch {
              // noop
            }
          }
        };
        current.set(id, dispose);

        // exit listener
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
          },
        )
          .then((unlisten) => {
            if (disposed) {
              unlisten();
              return;
            }
            exitUnlisten = unlisten;
          })
          .catch((e) => {
            logger.warn("[terminal-listener] listen exit failed", { id, e });
          });

        // PM-941: data listener (scrollback 保持用)。
        // buffer 追記 + active term への forward を 1 handler で atomic に実行。
        void onTauriEvent<string>(`pty:${id}:data`, (payload) => {
          if (typeof payload !== "string") return;
          appendToBuffer(id, payload);
          const term = activeTerminals.get(id);
          if (term) {
            try {
              term.write(payload);
            } catch (e) {
              // xterm が dispose 中などに write が失敗するケース。
              // buffer には残っているため次回 mount で復元できる。
              logger.debug("[terminal-listener] live write failed", {
                ptyId: id,
                e,
              });
            }
          }
        })
          .then((unlisten) => {
            if (disposed) {
              unlisten();
              return;
            }
            dataUnlisten = unlisten;
          })
          .catch((e) => {
            logger.warn("[terminal-listener] listen data failed", { id, e });
          });
      }

      // 消えた pty: listener を解除 + scrollback buffer / active registry も cleanup。
      for (const [id, cleanup] of current) {
        if (!liveIds.has(id)) {
          cleanup();
          current.delete(id);
          // PM-941: memory leak 防止。pty が store から消えた = kill 済 /
          // removeTerminalPane 済のため、buffer も保持する意味がない。
          ptyBuffers.delete(id);
          activeTerminals.delete(id);
        }
      }
    });

    return () => {
      unsubscribeStore();
      for (const cleanup of subscribedRef.current.values()) {
        cleanup();
      }
      subscribedRef.current.clear();
      // PM-941: Shell unmount (= アプリ終了相当) で全 buffer / active registry
      // を cleanup しておく。通常 Shell は singleton で unmount されないが、
      // StrictMode / test 環境で再 mount される場合の衛生のため。
      ptyBuffers.clear();
      activeTerminals.clear();
    };
  }, []);
}
