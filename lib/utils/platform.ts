/**
 * PRJ-012 v1.25.0: OS 判定 + 修飾キー表記の小ヘルパ。
 *
 * `navigator.platform` / `navigator.userAgentData.platform` を見て
 * macOS かどうかだけを判定し、修飾キー (Ctrl / Cmd) の表記を切替える。
 *
 * - getModifierLabel(): "Cmd" or "Ctrl"
 * - getModifierGlyph(): "⌘" or "Ctrl"
 *
 * ## 判定ロジック
 *
 * 1. `navigator.userAgentData.platform` ("macOS" / "Windows" / "Linux" 等) を優先
 * 2. fallback に `navigator.platform` ("MacIntel" / "Win32" 等) と
 *    `navigator.userAgent` の "Mac" 含有判定
 * 3. SSR / non-browser 環境 (Node.js テスト等) では Windows/Linux 扱いで Ctrl を返す
 *
 * モジュール load 時に 1 回だけ判定 → memo cache に保持する (毎フレーム判定不要)。
 */

let cachedIsMac: boolean | null = null;

/** 現在の実行環境が macOS かどうか。SSR では false。 */
export function isMacPlatform(): boolean {
  if (cachedIsMac !== null) return cachedIsMac;
  if (typeof navigator === "undefined") {
    cachedIsMac = false;
    return cachedIsMac;
  }
  try {
    // 新しい API (Chrome 90+, navigator.userAgentData)
    const uad: { platform?: string } | undefined = (
      navigator as unknown as { userAgentData?: { platform?: string } }
    ).userAgentData;
    if (uad && typeof uad.platform === "string") {
      cachedIsMac = uad.platform.toLowerCase().includes("mac");
      return cachedIsMac;
    }
  } catch {
    // 取得失敗時は fallback へ
  }
  const platform =
    typeof navigator.platform === "string" ? navigator.platform : "";
  const ua =
    typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  cachedIsMac =
    /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua);
  return cachedIsMac;
}

/**
 * 修飾キーの短縮表記を返す。
 *
 * - Mac: "Cmd"
 * - その他: "Ctrl"
 */
export function getModifierLabel(): "Cmd" | "Ctrl" {
  return isMacPlatform() ? "Cmd" : "Ctrl";
}

/**
 * 修飾キーのグリフ表記を返す。kbd 等で 1 文字表示したい時用。
 *
 * - Mac: "⌘"
 * - その他: "Ctrl"
 */
export function getModifierGlyph(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/**
 * Shift キーのグリフ。Mac では `⇧`、それ以外は `Shift` を返す。
 */
export function getShiftGlyph(): string {
  return isMacPlatform() ? "⇧" : "Shift";
}

/**
 * テスト用: cache をリセットする。本番コードでは呼ばれない。
 *
 * @internal
 */
export function _resetPlatformCacheForTest(): void {
  cachedIsMac = null;
}
