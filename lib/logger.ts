/**
 * PRJ-012 PM-746 (Tier 1-C) — production console gate.
 *
 * 本番 build (`NODE_ENV === "production"`) では `debug` / `info` を silent にして、
 * 個人 path (`C:\Users\hiron\...`) や内部 state が browser devtools に露出しない
 * ように gate する。dev build / `next dev` / Tauri dev では従来どおり `console.log`
 * 等にフォワードされるので、開発時の可観測性は維持する。
 *
 * ## 方針
 * - `debug` / `info`: dev のみ出力（本番では no-op）
 * - `warn` / `error`: **本番でも常に出す**（ユーザ起因エラー解析に必要）
 *
 * ## 置換ルール（PM-746）
 * - `console.log(...)`   → `logger.debug(...)`
 * - `console.debug(...)` → `logger.debug(...)`
 * - `console.info(...)`  → `logger.info(...)`
 * - `console.warn(...)`  → **そのまま残置**（production でも出す）
 * - `console.error(...)` → **そのまま残置**（production でも出す）
 *
 * ## 実装メモ
 * - `process.env.NODE_ENV` は Next.js が build 時に静的 inline する（dead-code
 *   elimination 可能）。Tauri dev は `next dev` を噛ませているので development 扱い。
 * - ESLint の `no-console` rule 下でも logger 経由は指摘されない（wrapper 自身のみ
 *   `eslint-disable` で許可）。
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.info(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
};
