import type { ReactNode } from "react";

// NOTE(M3 緊急切り分け): React error #185 (Maximum update depth exceeded) が
// workspace 画面で発生。Shell (TitleBar + Sidebar + Inspector + StatusBar +
// UpdateNotifier + useClaudeMonitor) の全子 component を一気に bypass して、
// workspace/page.tsx (ChatPanel + HelloBubble + CommandPalette + SearchPalette)
// だけ描画する最小構成に切替える。
// error 消える → Shell 子のいずれかが真犯人、次 PR で狭める
// error 出続ける → ChatPanel / palette 系が真犯人、次 PR で狭める
//
// import { Shell } from "@/components/layout/Shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
