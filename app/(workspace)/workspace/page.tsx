"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { HelloBubble } from "@/components/onboarding/HelloBubble";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { SearchPalette } from "@/components/palette/SearchPalette";

/**
 * Workspace — チャット画面のルート。
 *
 * PM-132 で Zustand `useChatStore` + `<ChatPanel />` に分解した後、このファイルは
 * 薄いシェルに退避。sidecar 起動 / event subscribe / message render / input 処理は
 * 全て `ChatPanel` 配下に集約されている（framer-motion / react-markdown /
 * react-hotkeys-hook の client コードも全部 child で "use client" 指定済）。
 *
 * PM-126: 初回 HelloBubble を右上に重ねて配置（localStorage で 1 回限り表示）。
 * PM-171: `<CommandPalette />` を常時マウント（ダイアログ本体は内部で open 制御、
 *         Ctrl+K / Cmd+K で開閉）。
 * Week7 PM-231: `<SearchPalette />` を並列マウント。Ctrl+Shift+F で自前で開閉し、
 *         CommandPalette の「会話を検索」項目からは `onOpenSearch` callback で開く。
 *         open state は page レベルの React state で一元管理（zustand 不要）。
 *
 * このファイルは CommandPalette / SearchPalette の open state を共有するため
 * client component（"use client"）化した。server 側で完結する処理はない。
 */
export default function WorkspacePage() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="relative h-full w-full">
      <ChatPanel />
      <div className="pointer-events-none absolute right-4 top-14 z-10">
        <div className="pointer-events-auto">
          <HelloBubble />
        </div>
      </div>
      <CommandPalette onOpenSearch={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
