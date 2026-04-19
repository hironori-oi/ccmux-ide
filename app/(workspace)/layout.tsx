import type { ReactNode } from "react";

import { Shell } from "@/components/layout/Shell";

/**
 * ワークスペース全体の 3 ペイン + 上下バー構成。
 *
 * レイアウト本体は `components/layout/Shell.tsx`（PM-167）に集約。
 * ここは Next.js App Router のレイアウトスロットとして children を流し込むだけ。
 *
 * 旧実装（flex で Sidebar + section + aside を直書き）は Shell に移設済。
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
