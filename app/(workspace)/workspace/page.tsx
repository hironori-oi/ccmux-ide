import { ChatPanel } from "@/components/chat/ChatPanel";
import { HelloBubble } from "@/components/onboarding/HelloBubble";
import { CommandPalette } from "@/components/palette/CommandPalette";

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
 * Chunk B の Sidebar は親 layout で 3 ペインに組み込まれているため、ここでは
 * 中央ペイン（ChatPanel）と overlay（HelloBubble）、および Palette だけを担当する。
 */
export default function WorkspacePage() {
  return (
    <div className="relative h-full w-full">
      <ChatPanel />
      <div className="pointer-events-none absolute right-4 top-14 z-10">
        <div className="pointer-events-auto">
          <HelloBubble />
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
