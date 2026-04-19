"use client";

import { Sparkles } from "lucide-react";

import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * PM-172 派生: タイトルバー（画面上端・36px 固定）。
 *
 * 左:
 *  - lucide `Sparkles` アイコン + ブランド名 "ccmux-ide"
 * 右:
 *  - `<ThemeToggle />`（PM-170、ダーク / ライト トグル）
 *  - アカウントドロップダウンは M2 以降で本実装予定のため現状 placeholder
 *    （空 div のまま、見た目だけ spacing を確保）。
 *
 * Shell.tsx（Chunk 2）の最上段にそのまま流し込む前提で、自身の幅は親 flex に従う。
 */
export function TitleBar() {
  return (
    <header
      aria-label="タイトルバー"
      className="flex h-9 shrink-0 items-center justify-between border-b bg-background px-3"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">ccmux-ide</span>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        {/* アカウントドロップダウン placeholder: M2 で DropdownMenu + avatar を配置予定 */}
        <div aria-hidden className="h-8 w-8" />
      </div>
    </header>
  );
}
