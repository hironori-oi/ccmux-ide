"use client";

import { Loader2 } from "lucide-react";
import { useProjectStore } from "@/lib/stores/project";

/**
 * PM-978: チャットの sidecar 状態を小さなバッジで表示するコンポーネント。
 *
 * ChatPanel の 1 pane fallback header に直書きしていた `status` 文字列と
 * `Loader2` スピナーを切り出し、`SlotHeader` から inline で使えるようにした。
 *
 * 表示内容:
 * - project 未選択: 「プロジェクト未選択」
 * - starting:      🌀 Claude を起動中...
 * - running:       ● Claude と接続中
 * - stopping:      🌀 Claude を停止中...
 * - error:         sidecar 起動失敗（プロジェクトを選び直してください）
 */
export function ChatStatusIndicator({ compact = false }: { compact?: boolean }) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const sidecarStatusForActive = useProjectStore((s) =>
    s.activeProjectId
      ? s.sidecarStatus[s.activeProjectId] ?? "stopped"
      : "stopped"
  );

  let text: string;
  let showSpinner = false;
  if (!activeProjectId) {
    text = "プロジェクト未選択";
  } else {
    switch (sidecarStatusForActive) {
      case "running":
        text = "Claude と接続中";
        break;
      case "starting":
        text = "Claude を起動中...";
        showSpinner = true;
        break;
      case "stopping":
        text = "Claude を停止中...";
        showSpinner = true;
        break;
      case "error":
        text = compact
          ? "起動失敗"
          : "sidecar 起動失敗（プロジェクトを選び直してください）";
        break;
      default:
        text = "停止中";
        break;
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
      {showSpinner && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      <span className="truncate">{text}</span>
    </span>
  );
}
