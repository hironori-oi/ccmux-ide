"use client";

/**
 * PM-283: 起動時 + 手動トリガで GitHub Release の latest.json をチェックし、
 * 利用可能な更新があれば sonner トーストで通知 → ユーザー承認後に
 * `downloadAndInstall` でダウンロード & インストールまで行う。
 *
 * 設計メモ:
 *   - `@tauri-apps/plugin-updater` の `check()` は endpoint（tauri.conf.json）
 *     の latest.json を取得し、現在のバージョンと比較。更新ありなら `Update`
 *     を返す。pubkey 空文字（MVP）のため署名検証は skip。
 *   - インストールは `update.downloadAndInstall(progressCb)` で progress を
 *     受けつつ実施。ダウンロード後は plugin-process の relaunch() でアプリを
 *     再起動する（macOS/Linux は必須、Windows は passive インストーラが
 *     自動再起動する場合あり）。
 *   - 起動時チェックは 3 秒遅延（起動直後の I/O 輻輳を避ける）。
 *   - 手動チェックは Settings > Appearance の「更新を確認」ボタンから発火。
 *     window CustomEvent `ccmux:check-update` を購読する。
 *   - 署名鍵は M3 PM-304 で Ed25519 ペアを発行 → ここの endpoint で署名検証
 *     に切り替える想定。現状は trust-on-first-use（TOFU）相当。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";

import { Progress } from "@/components/ui/progress";

const STARTUP_CHECK_DELAY_MS = 3_000;
const STARTUP_CHECK_EVENT = "ccmux:check-update";

type Phase = "idle" | "checking" | "available" | "downloading" | "done" | "error";

export function UpdateNotifier() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const hasRunStartupCheckRef = useRef(false);

  // ------------------------------------------------------------------
  // 更新確認 → 通知 → ダウンロード & インストール
  // ------------------------------------------------------------------
  const runCheck = useCallback(
    async (opts: { manual: boolean }) => {
      setPhase("checking");
      let update: Update | null = null;
      try {
        update = await check();
      } catch (err) {
        console.error("[updater] check failed", err);
        setPhase("error");
        if (opts.manual) {
          toast.error("更新確認に失敗しました", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (!update) {
        setPhase("idle");
        if (opts.manual) {
          toast.info("現在のバージョンは最新です");
        }
        return;
      }

      const version = update.version ?? "(不明)";
      setNewVersion(version);
      setPhase("available");

      toast(`v${version} が利用可能です`, {
        description: update.body
          ? String(update.body).slice(0, 120)
          : "更新内容を確認して適用してください。",
        duration: 20_000,
        action: {
          label: "更新する",
          onClick: () => {
            void installUpdate(update!);
          },
        },
      });
    },
    // installUpdate は下で定義しているが useCallback で純粋に参照するため deps 不要
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const installUpdate = useCallback(async (update: Update) => {
    let downloaded = 0;
    let contentLength = 0;

    setPhase("downloading");
    setProgress(0);

    const progressToastId = toast.loading("更新をダウンロード中...", {
      duration: Infinity,
    });

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
            setProgress(0);
            break;
          case "Progress":
            downloaded += event.data.chunkLength ?? 0;
            if (contentLength > 0) {
              const pct = Math.min(
                100,
                Math.round((downloaded / contentLength) * 100)
              );
              setProgress(pct);
              toast.loading(`更新をダウンロード中... ${pct}%`, {
                id: progressToastId,
              });
            }
            break;
          case "Finished":
            setProgress(100);
            toast.loading("インストールしています...", {
              id: progressToastId,
            });
            break;
        }
      });

      toast.success("更新が完了しました。再起動します。", {
        id: progressToastId,
        duration: 3_000,
      });
      setPhase("done");

      // Tauri 2 の passive インストーラは Windows で auto-relaunch しない
      // ケースがあるため明示的に relaunch。
      try {
        await relaunch();
      } catch (err) {
        console.warn("[updater] relaunch failed", err);
      }
    } catch (err) {
      console.error("[updater] install failed", err);
      setPhase("error");
      toast.error("更新のインストールに失敗しました", {
        id: progressToastId,
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // ------------------------------------------------------------------
  // 起動時チェック（3 秒遅延）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (hasRunStartupCheckRef.current) return;
    hasRunStartupCheckRef.current = true;

    const timer = window.setTimeout(() => {
      void runCheck({ manual: false });
    }, STARTUP_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [runCheck]);

  // ------------------------------------------------------------------
  // 手動チェック（Settings > Appearance のボタンから発火）
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      void runCheck({ manual: true });
    };
    window.addEventListener(STARTUP_CHECK_EVENT, handler);
    return () => window.removeEventListener(STARTUP_CHECK_EVENT, handler);
  }, [runCheck]);

  // ------------------------------------------------------------------
  // ダウンロード中のみ StatusBar 相当の右上 badge を出す（任意表示）
  // ------------------------------------------------------------------
  if (phase !== "downloading" && phase !== "available") {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-12 right-4 z-40 w-[280px] rounded-md border bg-background/95 p-3 shadow-md backdrop-blur"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        {phase === "downloading" ? (
          <Download className="h-3.5 w-3.5 animate-pulse text-primary" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 text-primary" aria-hidden />
        )}
        <span>
          {phase === "downloading"
            ? `v${newVersion ?? ""} をダウンロード中`
            : `v${newVersion ?? ""} が利用可能`}
        </span>
      </div>
      {phase === "downloading" && (
        <>
          <Progress value={progress} className="h-1.5" />
          <div className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
            {progress}%
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 外部モジュール（Settings など）から手動チェックをトリガするための公開 API。
 * window CustomEvent を使うことで、UpdateNotifier の状態を汚さずに呼び出せる。
 */
export function triggerManualUpdateCheck() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STARTUP_CHECK_EVENT));
}
