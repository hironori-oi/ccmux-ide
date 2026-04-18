"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * next-themes の wrapper。`html` 要素に `class="dark"` を付け外しする。
 *
 * shadcn/ui の ダーク/ライト切替はこの provider が前提。
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
