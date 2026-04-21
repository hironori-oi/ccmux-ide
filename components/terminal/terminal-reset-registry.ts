"use client";

/**
 * PRJ-012 v1.0 / PM-921 Bug 1 対応: xterm viewport reset 関数の module-level registry。
 *
 * ## 背景
 * claude CLI (Claude Code) の `/exit` は alternate screen buffer
 * (`\033[?1049h` / `\033[?1049l`) を使うが、終了時に scroll region reset や
 * cursor reset が完全に送られないケースがあり、cmd.exe の prompt が左端から
 * 描画されずに中央寄りから表示される事象が発生する (オーナー実機報告)。
 *
 * ## 設計
 * - `TerminalPane` が mount 時に `register(ptyId, fn)` で自身の reset 関数を登録し、
 *   unmount 時に `unregister(ptyId, fn)` で解除する。
 * - `TerminalView` の「クリア」ボタンや `useTerminalListener` の exit auto-reset は
 *   `resetTerminalViewport(ptyId)` を呼ぶだけで registry 越しに reset が走る。
 *
 * ## SSR-safe
 * 本 file は xterm.js を import せず `Map` のみを保持するため、Next.js の
 * SSR 側に resolve されても実害なし (TerminalPane 本体は dynamic(ssr:false) を維持)。
 */

const terminalResetRegistry = new Map<string, () => void>();

/** TerminalPane mount 時に reset 関数を登録。 */
export function registerTerminalReset(ptyId: string, fn: () => void): void {
  terminalResetRegistry.set(ptyId, fn);
}

/**
 * TerminalPane unmount 時に解除。
 *
 * `fn` が現在登録中の関数と同一の場合のみ削除する (remount で別 fn が既に
 * 登録済の場合に古い cleanup で新 fn を誤削除しないため)。
 */
export function unregisterTerminalReset(ptyId: string, fn: () => void): void {
  if (terminalResetRegistry.get(ptyId) === fn) {
    terminalResetRegistry.delete(ptyId);
  }
}

/**
 * 外部から reset を依頼する (UI ボタン / exit auto-reset)。
 * pane が未 mount or 既 unmount の場合は no-op。
 */
export function resetTerminalViewport(ptyId: string): void {
  const fn = terminalResetRegistry.get(ptyId);
  if (fn) fn();
}
