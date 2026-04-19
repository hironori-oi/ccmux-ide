"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * PM-170: ダーク / ライト テーマ切替ボタン。
 *
 * - `next-themes` の `useTheme()` を利用し、`"dark"` / `"light"` をトグル。
 * - SSR と初期ハイドレーション時は theme 値が未確定 → アイコン差替で
 *   hydration mismatch を起こさないよう `mounted` フラグでガードし、
 *   マウント前は Moon 固定表示にする（shadcn / next-themes 公式パターン）。
 * - TitleBar 右上から呼び出される小さな icon button。
 *
 * 関連: `components/theme-provider.tsx`（既存 ThemeProvider）、`app/layout.tsx`
 *      （Toaster + ThemeProvider 初期化）。
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // resolvedTheme は system 選択時でも "dark" / "light" のいずれかが入る。
  const current = mounted ? (resolvedTheme ?? theme) : undefined;
  const isDark = current === "dark";

  function handleClick() {
    // system 時でも見えているテーマの逆側に切替える（resolvedTheme 基準）。
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label="テーマを切り替える"
      className="h-8 w-8"
    >
      {mounted && !isDark ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
      <span className="sr-only">テーマを切り替える</span>
    </Button>
  );
}
