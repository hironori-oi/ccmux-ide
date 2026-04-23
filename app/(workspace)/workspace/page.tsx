"use client";

import { useState } from "react";

import { AuthPromptDialog } from "@/components/auth/AuthPromptDialog";
import { HelloBubble } from "@/components/onboarding/HelloBubble";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { FilePalette } from "@/components/palette/FilePalette";
import { SearchPalette } from "@/components/palette/SearchPalette";

/**
 * Workspace — チャット画面のルート。
 *
 * PM-132 で Zustand `useChatStore` + `<ChatPanel />` に分解し、Shell が main 領域
 * を管理する形に移行。v3.5 Chunk B (Split Sessions) で Shell 側が SplitView を
 * 直接マウントするようになり、本 page.tsx の役割は「Shell の main 領域上に
 * 重ねる overlay（HelloBubble / CommandPalette / SearchPalette / FilePalette）」
 * のみに縮退した。
 *
 * PM-126: 初回 HelloBubble を右上に重ねて配置（localStorage で 1 回限り表示）。
 * PM-171: `<CommandPalette />` を常時マウント（ダイアログ本体は内部で open 制御）。
 * Week7 PM-231: `<SearchPalette />` を並列マウント。
 * PM-948 (v1.2): `<FilePalette />` を並列マウント（Ctrl+P で project file fuzzy
 * 検索 → エディタ open、VSCode / Cursor の Quick Open 相当）。
 *
 * v3.5 Chunk B: ChatPanel は Shell 側（SplitView 経由）で render されるため、
 * 本 page からは除去。
 */
export default function WorkspacePage() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute right-4 top-14 z-10">
        <HelloBubble />
      </div>
      <CommandPalette onOpenSearch={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <FilePalette />
      {/* PM-974: 認証未設定なら永続ダイアログで案内（toast だけでは見落としがち） */}
      <AuthPromptDialog />
    </div>
  );
}
