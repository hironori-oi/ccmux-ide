"use client";

import { useEffect, useRef } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";

import { logger } from "@/lib/logger";
import { onTauriEvent } from "@/lib/tauri-api";
import { resetTerminalViewport } from "@/components/terminal/terminal-reset-registry";
import { useTerminalStore } from "@/lib/stores/terminal";
import { useTerminalBufferStore } from "@/lib/stores/terminal-buffer";

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
 * 1. `pty:{id}:data` event を **singleton で常時購読** し、shadow buffer
 *    (1MB / pty, `useTerminalBufferStore` 管理) に追記する。Terminal
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
 *
 * ## v1.26.0 (2026-04-26): buffer を Zustand store に移行 + 1MB 化
 *
 * PM-941 では module-level の `Map<string, string>` を 256KB 上限で管理して
 * いたが、以下の理由で `useTerminalBufferStore` (1MB / pty) に移管した。
 *
 *   1. PM-941 の 256KB は実セッションでは早期 trim され、ユーザーが「少し前の
 *      コマンド出力」を確認したいケースで欠落することがあった。1MB に増量。
 *   2. devtools / store snapshot で buffer 状態を観察可能にし、debug 性を向上。
 *   3. `purgeProject` (DEC-058) と `closeTerminal` の cascade を一元化し、pty
 *      削除時の buffer cleanup を store の action として明示的に呼ぶ経路に統一。
 *
 * `activeTerminals` map (現在描画中の xterm instance のレジストリ) は
 * 引き続き module-level で持つ。store には xterm instance を入れない方が
 * subscribe 経路の余計な re-render を避けられるため。
 */

// ---------------------------------------------------------------------------
// PM-941 / v1.26.0: active terminal registry (module-level singleton)。
// scrollback buffer 自体は `useTerminalBufferStore` に移管済 (v1.26.0)。
// ---------------------------------------------------------------------------

/** pty_id -> 現在画面に描画中の xterm instance (= subscriber)。 */
const activeTerminals = new Map<string, XTermTerminal>();

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
  const buf = useTerminalBufferStore.getState().getBuffer(ptyId);
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
    replayChars: buf.length,
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
 *
 * v1.26.0: buffer 実体は `useTerminalBufferStore` に移管。本 API は後方互換の
 * ラッパとして維持（既存呼び出し箇所がない場合でもデバッグ用に export 維持）。
 */
export function clearPtyScrollback(ptyId: string): void {
  useTerminalBufferStore.getState().clearBuffer(ptyId);
}

/**
 * テスト / デバッグ用に buffer 内容を取得する。通常 UI は
 * registerActiveTerminal 経由で透過に再現されるため本 API を直接使う必要はない。
 */
export function getPtyScrollback(ptyId: string): string {
  return useTerminalBufferStore.getState().getBuffer(ptyId);
}

// ---------------------------------------------------------------------------
// useTerminalListener (Shell 直下で 1 度だけ mount される singleton hook)
// ---------------------------------------------------------------------------

export function useTerminalListener(): void {
  // 既に listen 済の pty_id を tracking (重複登録回避)。
  // value は `{ dispose: () => void }` で data / exit 両方の listener cleanup を集約する。
  const subscribedRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    /**
     * v1.26.1 (hotfix): 現在の terminals state に対して listener を reconcile する。
     *
     * - 新規 pty: exit + data listener を登録
     * - 消えた pty: listener 解除 + buffer / active registry cleanup
     *
     * 旧実装は `useTerminalStore.subscribe()` の change callback でしか reconcile
     * せず、Zustand の `subscribe` は **登録時に初回 callback を呼ばない** 仕様の
     * ため、以下の条件で listener が永久に attach されない致命的 bug が発生する:
     *
     *   1. page reload / Tauri WebView refresh: terminals store は persist しない
     *      ため通常空だが、HMR や React.StrictMode の二重 mount 等で本 useEffect の
     *      cleanup → 再 mount が走った場合、cleanup で全 listener 解除されたのに
     *      再 mount 時の subscribe 登録だけでは現在の terminals に listener が
     *      attach されない。
     *   2. Sumi UI の通常リロード経路でも、auto-spawn / restore 処理が
     *      `useTerminalListener` の mount より早く完了した場合に同様の経路。
     *
     * v1.26.0 で buffer 経路を Zustand store 化した際の sub-symptom として、
     * 「リロード後に terminal 入力が一切届かない / scrollback も復元しない」
     * 報告があった。listener (exit + data) が一切 attach されないため、
     * pty の存続自体は OK だが UI 側で全く反応しない状態になる。
     * （term.onData → pty_write の経路自体は TerminalPane.tsx 内で attach されており
     *  生きているが、pty:{id}:data / exit の listener が無いため画面更新もない。
     *  ただ、attach 直後の term は既に scroll 済の状態で、入力結果が画面に反映
     *  されないためユーザには「入力もできない」ように見える。）
     *
     * 修正: subscribe 登録の直後に **初回明示的に reconcile を 1 回呼ぶ**。
     * これで mount 時点で既に store にある全 pty に listener を確実に attach する。
     */
    const reconcile = (state: { terminals: Record<string, unknown> }) => {
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

        // PM-941 / v1.26.0: data listener (scrollback 保持用)。
        // buffer 追記 (terminal-buffer store) + active term への forward を
        // 1 handler で atomic に実行。
        void onTauriEvent<string>(`pty:${id}:data`, (payload) => {
          if (typeof payload !== "string") return;
          useTerminalBufferStore.getState().appendOutput(id, payload);
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
          // PM-941 / v1.26.0: memory leak 防止。pty が store から消えた =
          // kill 済 / removeTerminalPane 済のため、buffer も保持する意味がない。
          useTerminalBufferStore.getState().clearBuffer(id);
          activeTerminals.delete(id);
        }
      }
    };

    // v1.26.1 hotfix: 初回明示 reconcile（store 既存 entry に listener attach する）。
    // Zustand subscribe は変化検知のみで初回 callback を発火しないため必須。
    reconcile(useTerminalStore.getState());

    // 以降の terminals 変化は subscribe で reconcile する。
    const unsubscribeStore = useTerminalStore.subscribe((state) => {
      reconcile(state);
    });

    return () => {
      unsubscribeStore();
      for (const cleanup of subscribedRef.current.values()) {
        cleanup();
      }
      subscribedRef.current.clear();
      // PM-941 / v1.26.0: Shell unmount (= アプリ終了相当) で active registry を
      // cleanup しておく。buffer 自体は store に残置（StrictMode 二重 mount 等で
      // 一旦 unmount されたが直後に再 mount された場合に履歴を維持するため）。
      // pty が完全に kill された場合は上の subscribe 内で per-pty に
      // `clearBuffer` 済なので、ここでは触らない。
      activeTerminals.clear();
    };
  }, []);
}
