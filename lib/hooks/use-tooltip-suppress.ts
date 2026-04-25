/**
 * PRJ-012 v1.25.0: Tooltip と DropdownMenu (or Popover) の重複表示を抑制する Hook。
 *
 * ## 背景
 *
 * Radix UI の Tooltip と DropdownMenu/Popover は独立したレイヤとして実装されている
 * ため、同じトリガ要素から両方を開くと「Tooltip が浮いた状態で DropdownMenu の
 * 中身が表示される」という重なりが起きる。特に右クリック起動の context menu と
 * hover Tooltip を同居させた場合に、瞬間的にも視覚ノイズが出る。
 *
 * ## 用途
 *
 * - DropdownMenu / Popover などが open === true のときに Tooltip を強制 close
 *   したい場面で使う。返り値の `tooltipOpen` を Tooltip の `open` prop に渡し、
 *   `setTooltipOpen` を `onOpenChange` に渡す。
 *
 * ```tsx
 * const { tooltipOpen, setTooltipOpen } = useTooltipSuppressOnMenuOpen(menuOpen);
 *
 * <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
 *   ...
 * </Tooltip>
 * ```
 *
 * ## 実装方針
 *
 * - menuOpen が true のあいだは tooltipOpen を強制 false に固定する
 * - menuOpen が false に戻ったら、Radix Tooltip の通常 hover/focus 駆動に
 *   制御を戻すため undefined を返す (controlled → uncontrolled 切替)
 *
 * 戻り値:
 * - `tooltipOpen`: Tooltip の `open` prop に渡す値。`undefined` のときは
 *   Tooltip 自身の hover/focus 制御に任せる (uncontrolled)。
 * - `setTooltipOpen`: Tooltip の `onOpenChange` に渡す setter。menuOpen 中は
 *   no-op で隠蔽し、それ以外では通常通り state を反映する。
 */

import { useCallback, useEffect, useState } from "react";

export interface TooltipSuppressResult {
  tooltipOpen: boolean | undefined;
  setTooltipOpen: (next: boolean) => void;
}

export function useTooltipSuppressOnMenuOpen(
  menuOpen: boolean,
): TooltipSuppressResult {
  // undefined = uncontrolled (Radix Tooltip 既定挙動に任せる)
  const [tooltipOpen, setTooltipOpenState] = useState<boolean | undefined>(
    undefined,
  );

  useEffect(() => {
    if (menuOpen) {
      // menu が開いている間は Tooltip を強制 false で隠す
      setTooltipOpenState(false);
    } else {
      // menu が閉じたら Tooltip の制御を Radix に戻す (uncontrolled)
      setTooltipOpenState(undefined);
    }
  }, [menuOpen]);

  const setTooltipOpen = useCallback(
    (next: boolean) => {
      // menu が開いている間は Tooltip 開閉要求を無視する
      if (menuOpen) return;
      setTooltipOpenState(next);
    },
    [menuOpen],
  );

  return { tooltipOpen, setTooltipOpen };
}
