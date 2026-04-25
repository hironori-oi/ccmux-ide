"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { logger } from "@/lib/logger";

/**
 * PRJ-012 v1.26.0 (2026-04-26): ターミナル出力 buffer store。
 * PRJ-012 v1.27.0 (2026-04-26): localStorage persist 化 + 容量縮小。
 *
 * ## 目的
 *
 * Sumi をリロード（page refresh / Tauri WebView 再描画）したり、TerminalView が
 * 何らかの理由で unmount → remount された場合でも、xterm.js の DOM canvas に
 * 蓄積された出力が消えないように、pty 単位で raw output stream を rolling buffer
 * として保持する。`TerminalPane` は mount 時に buffer 内容を `term.write()` で
 * replay することで履歴を復元する。
 *
 * ## v1.27.0 変更
 *
 * - **localStorage 永続化 (key: `sumi:terminal-buffers`)** に切り替え、Sumi の
 *   フルリロード後も履歴を保持する。
 * - 1 pty あたりの上限を **1 MiB → 256 KiB** に縮小（localStorage の 5–10 MB
 *   制約を踏まえ、複数 pty 同時運用時に枯渇しないよう調整）。
 * - **総容量 5 MiB ガード**: 全 pty の buffer 合計が 5 MiB を超える場合、最終
 *   更新が古い pty から evict する。新規 chunk 受信時 / persist 直前に走らせる。
 *
 * ## v1.26.0 → v1.27.0 migration
 *
 * persist version `1`（旧 memory only から localStorage に切替えた最初の版）。
 * 旧 v1.26.x で localStorage に書かれていたデータは存在しないため、migration は
 * 単に空 state を返す（実質 default 適用と同じ）。
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
 * - `useTerminalHydrationListener` (v1.27.0): list_active_terminals に居ない
 *   pty の buffer を起動時に評価し、最終更新が古ければ evict する。
 */

/**
 * pty 1 本あたりの buffer 上限 (UTF-16 code unit / `string.length` ベース)。
 * v1.27.0: 1 MiB → 256 KiB に縮小（localStorage の 5–10 MB 制約のため）。
 */
export const TERMINAL_BUFFER_MAX_CHARS = 256 * 1024; // 256 KiB

/**
 * 全 pty の buffer 合計上限。これを超えると最終更新が古い pty から evict する。
 * 5 MiB を選んだ理由: Tauri WebView (Edge / WebKit) の localStorage 上限は
 * 5 MB / 10 MB / origin で揺れるため、安全マージンを取って 5 MiB 設定。
 */
export const TERMINAL_BUFFER_TOTAL_MAX_CHARS = 5 * 1024 * 1024;

interface TerminalBufferState {
  /** pty_id → 直近 256KiB の rolling buffer。 */
  bufferByPtyId: Record<string, string>;

  /** pty_id → 最終 append 時刻 (UNIX ms)。LRU evict 用。 */
  lastTouchedByPtyId: Record<string, number>;

  /**
   * 出力 chunk を pty の buffer 末尾に append。256KiB を超えたら head を切り捨てる
   * (rolling buffer)。総容量 5 MiB を超える場合は最古 pty から evict する。
   */
  appendOutput: (ptyId: string, chunk: string) => void;

  /**
   * pty の buffer を取得。`TerminalPane` mount 時に呼び、`term.write(...)` で
   * 一括 replay する。未登録の pty は空文字列を返す。
   */
  getBuffer: (ptyId: string) => string;

  /**
   * pty の buffer を削除。pty が kill / close / purge されたタイミングで呼ぶ。
   * 既に存在しない pty に対して呼んでも no-op。
   */
  clearBuffer: (ptyId: string) => void;

  /** 複数 pty の buffer を一括削除。`purgeProject` 等の cascade 経路で利用。 */
  clearBuffers: (ptyIds: readonly string[]) => void;

  /**
   * v1.27.0: 起動時に Rust list_active_terminals の結果を渡し、生きていない
   * pty の buffer を一括 evict する。生存 pty の buffer は保持して replay に使う。
   */
  reconcileWithLivePtys: (livePtyIds: readonly string[]) => void;
}

/**
 * 総容量を計算する。`string.length` (UTF-16 code unit) ベース。
 */
function totalBufferLength(buf: Record<string, string>): number {
  let total = 0;
  for (const v of Object.values(buf)) {
    total += v.length;
  }
  return total;
}

/**
 * 総容量が上限を超えていれば、最終更新が古い pty から evict する。
 * touched が同値なら id 辞書順（決定論性のため）。
 */
function enforceTotalCap(
  buf: Record<string, string>,
  touched: Record<string, number>,
): { buffer: Record<string, string>; touched: Record<string, number> } {
  let total = totalBufferLength(buf);
  if (total <= TERMINAL_BUFFER_TOTAL_MAX_CHARS) {
    return { buffer: buf, touched };
  }
  const sortedIds = Object.keys(buf).sort((a, b) => {
    const ta = touched[a] ?? 0;
    const tb = touched[b] ?? 0;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : 1;
  });
  const nextBuf = { ...buf };
  const nextTouched = { ...touched };
  for (const id of sortedIds) {
    if (total <= TERMINAL_BUFFER_TOTAL_MAX_CHARS) break;
    const len = nextBuf[id]?.length ?? 0;
    delete nextBuf[id];
    delete nextTouched[id];
    total -= len;
    logger.debug("[terminal-buffer] evict (total cap)", { ptyId: id, freedChars: len });
  }
  return { buffer: nextBuf, touched: nextTouched };
}

const STORAGE_KEY = "sumi:terminal-buffers";

const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return window.localStorage;
});

export const useTerminalBufferStore = create<TerminalBufferState>()(
  persist(
    (set, get) => ({
      bufferByPtyId: {},
      lastTouchedByPtyId: {},

      appendOutput: (ptyId, chunk) => {
        if (!ptyId || !chunk) return;
        set((state) => {
          const prev = state.bufferByPtyId[ptyId] ?? "";
          let next = prev + chunk;
          if (next.length > TERMINAL_BUFFER_MAX_CHARS) {
            next = next.slice(next.length - TERMINAL_BUFFER_MAX_CHARS);
          }
          const nextBuf = {
            ...state.bufferByPtyId,
            [ptyId]: next,
          };
          const nextTouched = {
            ...state.lastTouchedByPtyId,
            [ptyId]: Date.now(),
          };
          // 総容量 evict は append のたびに評価。append 直後にしか cap 違反は
          // 発生しないため最小限のオーバーヘッドで済む。
          const capped = enforceTotalCap(nextBuf, nextTouched);
          return {
            bufferByPtyId: capped.buffer,
            lastTouchedByPtyId: capped.touched,
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
          const { [ptyId]: _t, ...restTouched } = state.lastTouchedByPtyId;
          void _t;
          logger.debug("[terminal-buffer] clear", { ptyId });
          return {
            bufferByPtyId: rest,
            lastTouchedByPtyId: restTouched,
          };
        });
      },

      clearBuffers: (ptyIds) => {
        if (!ptyIds || ptyIds.length === 0) return;
        set((state) => {
          const next = { ...state.bufferByPtyId };
          const nextTouched = { ...state.lastTouchedByPtyId };
          let touched = false;
          for (const id of ptyIds) {
            if (id in next) {
              delete next[id];
              delete nextTouched[id];
              touched = true;
            }
          }
          if (!touched) return state;
          logger.debug("[terminal-buffer] clear bulk", { count: ptyIds.length });
          return {
            bufferByPtyId: next,
            lastTouchedByPtyId: nextTouched,
          };
        });
      },

      reconcileWithLivePtys: (livePtyIds) => {
        const live = new Set(livePtyIds);
        set((state) => {
          const next = { ...state.bufferByPtyId };
          const nextTouched = { ...state.lastTouchedByPtyId };
          let removed = 0;
          for (const id of Object.keys(next)) {
            if (!live.has(id)) {
              delete next[id];
              delete nextTouched[id];
              removed++;
            }
          }
          if (removed === 0) return state;
          logger.debug("[terminal-buffer] reconcile evict (dead pty)", {
            removed,
            kept: Object.keys(next).length,
          });
          return {
            bufferByPtyId: next,
            lastTouchedByPtyId: nextTouched,
          };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      version: 1,
      migrate: (persisted, version) => {
        // v0 (memory only) → v1 (localStorage): persist 範囲が変わったので空状態
        // から開始するのが安全（旧データは存在しない）。
        if (version < 1) {
          return {
            bufferByPtyId: {},
            lastTouchedByPtyId: {},
          } as TerminalBufferState;
        }
        return persisted as TerminalBufferState;
      },
      // partialize: 関数 / setter を除いて state プロパティのみ persist する。
      partialize: (state) => ({
        bufferByPtyId: state.bufferByPtyId,
        lastTouchedByPtyId: state.lastTouchedByPtyId,
      }),
    },
  ),
);
