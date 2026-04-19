import type { ReactNode } from "react";

import { Shell } from "@/components/layout/Shell";

/**
 * ワークスペース全体の 3 ペイン + 上下バー構成。
 *
 * NOTE: React error #185 は Shell 内で発生確認済。Shell.tsx 側で Inspector のみ
 * 除外した状態で再検証中（2 分探索）。
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
