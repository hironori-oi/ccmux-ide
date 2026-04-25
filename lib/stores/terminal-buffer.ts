"use client";

import { create } from "zustand";

import { logger } from "@/lib/logger";

/**
 * PRJ-012 v1.26.0 (2026-04-26): ターミナル出力 buffer store。
 *
 * ## 目的
 *
 * Sumi をリロード（page refresh / Tauri WebView 再描画）したり、TerminalView が
 * 何らかの理由で unmount → remount された場合でも、xterm.js の DOM canvas に
 * 蓄積された出力が消えないように、pty 単位で raw output stream を JS メモリ上の
 * rolling buffer に保持する。`TerminalPane` は mount 時に buffer 内容を
 * `term.write()` で replay することで履歴を復元する。
 *
 * ## PM-941 との関係
 *
 * v1.0 / PM-941 で `useTerminalListener` 内に同等の shadow buffer
 * (`ptyBuffers`, 上限 256KB / pty) が module-level の `Map<string, string>` で
 * 実装済みだった。本 store は PM-941 の shadow buffer 機能を Zustand store に
 * 統合し、上限を **1MB / pty** に拡張したもの。
 *
 * - 旧: `useTerminalListener.ts` の `appendToBuffer` / `ptyBuffers.get` /
 *       `ptyBuffers.delete` 経路（256KB 上限 / module-level Map）
 * - 新: 本 store の `appendOutput` / `getBuffer` / `clearBuffer`
 *       （1MB 上限 / Zustand store）
 *
 * Zustand 化したことで:
 *   1. devtools / store snapshot で buffer 状態が観察可能
 *   2. 他の store (purge-project / terminal) からの cleanup が直感的
 *   3. テスト時に `useTerminalBufferStore.setState({ ... })` で初期化可
 *
 * ## 1MB 上限の根拠
 *
 * 一般的なターミナル 1 行を 200 文字とすると 1MB ≒ 5,000 行。Claude CLI の
 * 出力でも十分余裕があり、典型的なセッションを丸ごと保持できる。`string.length`
 * (UTF-16 code unit) ベースで計測するため、ASCII / 多バイト文字を区別しない。
 * 多バイト文字でも実バイトは長くて 4 倍程度（4MB 相当）に収まり、pty 10 本
 * でも 40MB 以内なので実用上問題ない。
 *
 * ## 永続化
 *
 * メモリのみ（zustand のデフォルト）。Sumi 終了 / Tauri WebView 完全リロードで
 * 破棄される。ディスク永続化（sessionStorage / localStorage）は v1.27 以降で
 * 検討する（output に escape sequence や認証 token / API key 出力が含まれる
 * リスクがあるため、persist 範囲には注意が必要）。
 *
 * ## ANSI escape sequence
 *
 * raw bytes をそのまま保存すれば、replay 時に xterm.js が再評価して色 / カーソル
 * 位置を正しく再現する。escape sequence を分解 / 解釈する必要はない。
 *
 * ## pty 削除時の cascade
 *
 * - `useTerminalStore.closeTerminal` / `purgeProject` / `removeTerminalPane` /
 *   `useTerminalListener` の exit subscription cleanup → `clearBuffer(ptyId)`
 * - DEC-058 (project 削除 cascade) → `purge-project.ts` 内で対象 pty 群を
 *   個別に `clearBuffer` する経路を追加。
 */

/** pty 1 本あたりの buffer 上限 (UTF-16 code unit / `string.length` ベース)。 */
export const TERMINAL_BUFFER_MAX_CHARS = 1024 * 1024; // 1 MiB

interface TerminalBufferState {
  /** pty_id → 直近 1MB の rolling buffer。 */
  bufferByPtyId: Record<string, string>;

  /**
   * 出力 chunk を pty の buffer 末尾に append。1MB を超えたら head を切り捨てる
   * (rolling buffer)。`useTerminalListener` の `pty:{id}:data` handler で呼ぶ。
   */
  appendOutput: (ptyId: string, chunk: string) => void;

  /**
   * pty の buffer を取得。`TerminalPane` mount 時に呼び、`term.write(...)` で
   * 一括 replay する。未登録の pty は空文字列を返す（type-safe な扱いのため）。
   */
  getBuffer: (ptyId: string) => string;

  /**
   * pty の buffer を削除。pty が kill / close / purge されたタイミングで呼ぶ。
   * 既に存在しない pty に対して呼んでも no-op。
   */
  clearBuffer: (ptyId: string) => void;

  /**
   * 複数 pty の buffer を一括削除。`purgeProject` 等の cascade 経路で利用。
   */
  clearBuffers: (ptyIds: readonly string[]) => void;
}

export const useTerminalBufferStore = create<TerminalBufferState>(
  (set, get) => ({
    bufferByPtyId: {},

    appendOutput: (ptyId, chunk) => {
      if (!ptyId || !chunk) return;
      set((state) => {
        const prev = state.bufferByPtyId[ptyId] ?? "";
        let next = prev + chunk;
        if (next.length > TERMINAL_BUFFER_MAX_CHARS) {
          // rolling: 古い head を捨てて末尾 1MB だけ残す。
          next = next.slice(next.length - TERMINAL_BUFFER_MAX_CHARS);
        }
        return {
          bufferByPtyId: {
            ...state.bufferByPtyId,
            [ptyId]: next,
          },
        };
      });
    },

    getBuffer: (ptyId) => {
      if (!ptyId) return "";
      return get().bufferByPtyId[ptyId] ?? "";
    },

    clearBuffer: (ptyId) => {
      if (!ptyId) return;
      set((state) => {
        if (!(ptyId in state.bufferByPtyId)) return state;
        const { [ptyId]: _removed, ...rest } = state.bufferByPtyId;
        void _removed;
        logger.debug("[terminal-buffer] clear", { ptyId });
        return { bufferByPtyId: rest };
      });
    },

    clearBuffers: (ptyIds) => {
      if (!ptyIds || ptyIds.length === 0) return;
      set((state) => {
        const next = { ...state.bufferByPtyId };
        let touched = false;
        for (const id of ptyIds) {
          if (id in next) {
            delete next[id];
            touched = true;
          }
        }
        if (!touched) return state;
        logger.debug("[terminal-buffer] clear bulk", { count: ptyIds.length });
        return { bufferByPtyId: next };
      });
    },
  }),
);
