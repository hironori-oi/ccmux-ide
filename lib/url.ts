/**
 * v1.10.0 (DEC-056): URL の host が localhost 相当 (internal) かを判定する util。
 *
 * Preview Pane が「アプリ内 iframe」と「別ウィンドウ (WebviewWindowBuilder)」を
 * 使い分けるために使う。
 *
 * ## 判定ルール
 *
 * 以下のいずれかの host は internal (loopback) として `true` を返す:
 * - `localhost`
 * - `127.0.0.1`
 * - `0.0.0.0`
 * - `*.localhost` サブドメイン (例: `app.localhost`)
 * - IPv6 loopback `::1` (URL parse で hostname は `[::1]` 形式になる)
 *
 * ## 失敗時
 *
 * URL が parse できない場合 (相対パス、空文字、不正形式) は `false` を返す。
 * これは「internal か不明 → 安全側 (iframe に流さない)」の判断。
 *
 * ## 注意
 *
 * port / path / protocol は判定に影響しない。`http://localhost:3000/foo` も
 * `https://localhost/` もどちらも true。
 */
export function isLocalUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  if (hostname.endsWith(".localhost")) return true;
  if (hostname === "127.0.0.1") return true;
  if (hostname === "0.0.0.0") return true;
  // IPv6 loopback: URL.hostname は角括弧を除去して `::1` を返す（Node / browser 共通）。
  if (hostname === "::1" || hostname === "[::1]") return true;
  return false;
}
