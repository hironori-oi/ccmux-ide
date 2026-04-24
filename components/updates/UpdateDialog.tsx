"use client";

import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { DownloadCloud, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useUpdaterStore } from "@/lib/stores/updater";
import {
  UPDATE_DIALOG_EVENT_NAMES,
  requestInstallUpdate,
} from "@/components/updates/UpdateNotifier";

/**
 * v1.16.0 / DEC-062: 自動更新の詳細ダイアログ。
 *
 * ## 表示内容
 *  - 現在バージョン（`@tauri-apps/api/app::getVersion()`）と latestVersion の対比
 *  - status ごとに 3 つのモード:
 *    1. available: 「今すぐ更新 / 後で / このバージョンをスキップ」
 *    2. downloading: progress bar + ボタン disabled（passive インストール）
 *    3. ready: 「再起動して更新を適用」
 *    4. error: エラーメッセージ + 「再試行」
 *
 * ## 開閉
 *  - UpdateBadge / UpdateNotifier から CustomEvent `ccmux:open-update-dialog`
 *    を listen して open=true
 *  - `onOpenChange` で自動 close（close 時も status はそのまま、再度開くと続きを表示）
 */
export function UpdateDialog() {
  const [open, setOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  const status = useUpdaterStore((s) => s.status);
  const latestVersion = useUpdaterStore((s) => s.latestVersion);
  const downloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const lastError = useUpdaterStore((s) => s.lastError);
  const skipVersion = useUpdaterStore((s) => s.skipVersion);

  // マウント時に現バージョンを取得（Tauri API、静的な getter のため 1 回で OK）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setCurrentVersion(v);
      } catch (err) {
        console.warn("[UpdateDialog] getVersion failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // open event を購読
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(UPDATE_DIALOG_EVENT_NAMES.open, handler);
    return () =>
      window.removeEventListener(UPDATE_DIALOG_EVENT_NAMES.open, handler);
  }, []);

  const handleInstall = useCallback(() => {
    // UpdateNotifier が window event を受けて downloadAndInstall を開始する。
    // Dialog は開いたまま、status の変化を subscribe して表示を切替える。
    requestInstallUpdate();
  }, []);

  const handleSkip = useCallback(() => {
    if (latestVersion) {
      skipVersion(latestVersion);
    }
    setOpen(false);
  }, [latestVersion, skipVersion]);

  const handleLater = useCallback(() => {
    setOpen(false);
  }, []);

  const handleRelaunch = useCallback(async () => {
    try {
      await relaunch();
    } catch (err) {
      console.warn("[UpdateDialog] relaunch failed", err);
    }
  }, []);

  // Dialog は通常ユーザーが明示的に開く。close は ESC / overlay クリックで可能。
  // downloading 中は close 不可にしたいため onOpenChange を guard。
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && status === "downloading") {
        // ダウンロード中は閉じない（passive install 継続のため）
        return;
      }
      setOpen(nextOpen);
    },
    [status]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="h-4 w-4" aria-hidden />
            {status === "ready"
              ? "更新の準備ができました"
              : status === "downloading"
                ? "更新をダウンロード中..."
                : status === "error"
                  ? "更新エラー"
                  : "新しいバージョンが利用可能です"}
          </DialogTitle>
          <DialogDescription>
            {status === "ready"
              ? "ダウンロードが完了しました。再起動して更新を適用します。"
              : status === "downloading"
                ? "ダウンロード中はキャンセルできません。完了まで少々お待ちください。"
                : status === "error"
                  ? "更新処理中にエラーが発生しました。時間をおいてから再試行してください。"
                  : "新しいバージョンを適用して最新の機能を使えるようにします。"}
          </DialogDescription>
        </DialogHeader>

        {/* バージョン対比 */}
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">現在のバージョン</span>
            <span className="font-mono tabular-nums">
              v{currentVersion ?? "?"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">最新バージョン</span>
            <span className="font-mono tabular-nums text-primary">
              v{latestVersion ?? "?"}
            </span>
          </div>
        </div>

        {/* downloading 中は progress bar */}
        {status === "downloading" && (
          <div className="space-y-1.5">
            <Progress value={downloadProgress} className="h-2" />
            <div className="text-right text-[10px] font-mono tabular-nums text-muted-foreground">
              {downloadProgress}%
            </div>
          </div>
        )}

        {/* error メッセージ */}
        {status === "error" && lastError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
          >
            {lastError}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {status === "available" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="sm:mr-auto"
              >
                このバージョンをスキップ
              </Button>
              <Button variant="outline" size="sm" onClick={handleLater}>
                後で
              </Button>
              <Button
                size="sm"
                onClick={handleInstall}
                className="gap-2"
              >
                <DownloadCloud className="h-3.5 w-3.5" aria-hidden />
                今すぐ更新
              </Button>
            </>
          )}
          {status === "downloading" && (
            <Button size="sm" disabled className="gap-2">
              <DownloadCloud className="h-3.5 w-3.5 animate-pulse" aria-hidden />
              ダウンロード中...
            </Button>
          )}
          {status === "ready" && (
            <Button size="sm" onClick={handleRelaunch} className="gap-2">
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
              再起動して更新を適用
            </Button>
          )}
          {status === "error" && (
            <>
              <Button variant="outline" size="sm" onClick={handleLater}>
                閉じる
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  // 再試行: 手動 check と同等
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent(UPDATE_DIALOG_EVENT_NAMES.check)
                    );
                  }
                }}
                className="gap-2"
              >
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                再試行
              </Button>
            </>
          )}
          {(status === "idle" || status === "checking") && (
            <Button variant="outline" size="sm" onClick={handleLater}>
              閉じる
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
