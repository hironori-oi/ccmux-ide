"use client";

import { useMemo } from "react";
import { DownloadCloud, Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdaterStore } from "@/lib/stores/updater";
import { requestOpenUpdateDialog } from "@/components/updates/UpdateNotifier";
import { cn } from "@/lib/utils";

/**
 * v1.16.0 / DEC-062: TitleBar 右端に表示する更新 badge。
 *
 * ## 挙動
 *  - status="idle" のときは何も描画しない（null）。
 *  - status="checking": ローダーアイコン（tooltip: 「更新を確認中...」）。
 *    クリックは disabled。
 *  - status="available": DownloadCloud アイコン + 青 dot + latestVersion。
 *    クリックで UpdateDialog を開く。
 *  - status="downloading": 進捗 % を数値表示 + spinner。
 *    クリックで Dialog（進捗確認用）を開くのみ、キャンセル不可。
 *  - status="ready": 「再起動」強調色の CTA。クリックで Dialog を開き、
 *    そこから relaunch。
 *  - status="error": 静かに DownloadCloud + エラー tooltip のみ。
 *    クリックで Dialog を開いて retry。
 *
 * ## アクセシビリティ
 *  - Tooltip で状態の説明を出す。
 *  - aria-live="polite" を親に付けて状態変化を SR に通知。
 */
export function UpdateBadge() {
  const status = useUpdaterStore((s) => s.status);
  const latestVersion = useUpdaterStore((s) => s.latestVersion);
  const downloadProgress = useUpdaterStore((s) => s.downloadProgress);

  const handleClick = () => {
    requestOpenUpdateDialog();
  };

  const content = useMemo(() => {
    switch (status) {
      case "checking":
        return {
          label: "更新を確認中",
          description: "最新バージョンを確認しています...",
          icon: (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              aria-hidden
            />
          ),
          extra: null,
          className: "",
          disabled: true,
        };
      case "available":
        return {
          label: latestVersion
            ? `v${latestVersion} が利用可能`
            : "更新が利用可能",
          description:
            "新しいバージョンが利用可能です。クリックで詳細を確認してください。",
          icon: <DownloadCloud className="h-3.5 w-3.5 text-primary" aria-hidden />,
          extra: (
            <span
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden
            />
          ),
          className: "text-foreground",
          disabled: false,
        };
      case "downloading":
        return {
          label: `${downloadProgress}%`,
          description: "更新をダウンロード中です。完了まで少々お待ちください。",
          icon: (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-primary"
              aria-hidden
            />
          ),
          extra: null,
          className: "text-primary font-mono tabular-nums",
          disabled: false,
        };
      case "ready":
        return {
          label: "再起動",
          description:
            "更新のダウンロードが完了しました。クリックで再起動します。",
          icon: <RefreshCcw className="h-3.5 w-3.5" aria-hidden />,
          extra: null,
          className:
            "bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30",
          disabled: false,
        };
      case "error":
        return {
          label: "更新エラー",
          description:
            "更新確認に失敗しました。クリックで再試行できます。",
          icon: (
            <DownloadCloud
              className="h-3.5 w-3.5 text-destructive"
              aria-hidden
            />
          ),
          extra: null,
          className: "text-destructive",
          disabled: false,
        };
      default:
        return null;
    }
  }, [status, latestVersion, downloadProgress]);

  if (!content) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={content.disabled}
            onClick={handleClick}
            aria-label={content.label}
            className={cn(
              "h-6 shrink-0 gap-1 px-2 text-[11px]",
              content.className
            )}
          >
            {content.icon}
            <span>{content.label}</span>
            {content.extra}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{content.label}</span>
            <span className="text-[10px] text-muted-foreground">
              {content.description}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
