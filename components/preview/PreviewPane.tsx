"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { ExternalLink, Info, Monitor } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { logger } from "@/lib/logger";
import { useProjectStore } from "@/lib/stores/project";
import {
  DEFAULT_PREVIEW_URL,
  usePreviewStore,
} from "@/lib/stores/preview";

/**
 * PRJ-012 v1.0 / PM-936 (2026-04-20): ブラウザプレビュー pane (iframe 撤退版)。
 * PRJ-012 v1.1 / PM-943 (2026-04-20): Tauri 2 secondary WebviewWindow 追加
 * (Preview Phase 4.1)。
 *
 * ## 戦略転換の経緯
 *
 * PM-925 (feasibility 調査) → PM-927 (CSP 拡張) → PM-929 (block 自動判定廃止) →
 * PM-931 (CSP 9 directive 全拡張) → PM-933 (devCsp / dangerousDisableAssetCspModification
 * / additionalBrowserArgs / capability 追加) と 5 回の iframe 対応を重ねたが、
 * WebView2 の security layer で **ERR_CONNECTION_REFUSED が解消せず**、
 * オーナー実機でも `https://hiroyo.improver.work/` / `https://yahoo.co.jp/` 等で
 * 継続再現した。
 *
 * v1.0 の現実解として **iframe を撤退し、「外部ブラウザで開く」一本化** に方針転換。
 *
 * ## v1.1 PM-943 (Phase 4.1)
 *
 * PM-942 feasibility 調査で Tauri 2 の **secondary `WebviewWindow`** は iframe と
 * 違い X-Frame-Options / WebView2 site-isolation の影響を受けないことを確認
 * (独立 OS window = 独立 process / origin)。
 *
 * → 「アプリ内で開く」ボタンを追加し、`@tauri-apps/api/webviewWindow` の
 *   `new WebviewWindow()` で別 window を spawn する経路を復活させた。
 *   「外部ブラウザで開く」は残置 (fallback & 明示選択肢として)。
 *
 * ### UX
 * - project 1 つにつき **同時 1 つ** の preview window（label: `preview:${projectId}`）
 * - 既に open 済みの場合は `setFocus()` にフォールバック (重複 spawn 回避)
 * - URL を変えて「アプリ内で開く」を押した場合は **既存 window を close → 新規 spawn**
 *   (WebviewWindow には stable な navigate API がないため close/create 方式)
 * - window が閉じられたら `tauri://destroyed` を listen して store から unregister
 *
 * ### 既存設定の流用
 * - PM-933 で追加した capability 3 件 + PM-943 で追加した window close / destroy /
 *   set-focus permission で secondary WebviewWindow の create / close / focus を
 *   cover。
 * - `tauri.conf.json` の CSP / additionalBrowserArgs は維持 (secondary webview に
 *   伝播するかは実機検証事項、MVP では現状設定を流用)。
 *
 * ## Phase 4.2 申し送り
 * - 同一 window 内 multi-webview (`@tauri-apps/api/webview` + `unstable` feature) で
 *   Cursor 同等の in-IDE preview UX を実現する計画。本 component は window 管理層を
 *   明確に分離してあるため、spawn 先を差し替えるだけで移行可能な設計。
 * - URL 変更時の navigate API (`webview.navigate()` 相当) が stable 化したら
 *   close/create を navigate に置き換えて reload コストを削減する。
 */

// PM-943: WebviewWindow label の prefix は `preview-${projectId}-`。
// PM-943 hotfix3: 固定 label だと `already exists` race (destroy 未完了 / OS 残存 /
// enumerate 漏れ) を完全には回避できなかったため、timestamp nonce を付与して毎回
// unique label で spawn する方式に変更。古い window は label prefix 一致で destroy。
//
// Tauri 2 の label 仕様は alphanumeric / `-` / `_` を推奨。`:` は実装上許容だが
// 安全側に `-` に統一。
function buildPreviewWindowLabelPrefix(projectId: string): string {
  const sanitized = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `preview-${sanitized}-`;
}
function buildPreviewWindowLabel(projectId: string): string {
  return `${buildPreviewWindowLabelPrefix(projectId)}${Date.now()}`;
}

export function PreviewPane() {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const activeProjectId = activeProject?.id ?? null;

  // persist store から project ごとの URL を取得
  // （history は v1.0 では UI 露出しないが、store 側は PM-925 実装を維持）
  const urlEntry = usePreviewStore((s) =>
    activeProjectId ? s.urls[activeProjectId] : undefined
  );
  const setCurrentUrl = usePreviewStore((s) => s.setCurrentUrl);
  const registerWebviewWindow = usePreviewStore(
    (s) => s.registerWebviewWindow
  );
  const unregisterWebviewWindow = usePreviewStore(
    (s) => s.unregisterWebviewWindow
  );

  const committedUrl = urlEntry?.current ?? DEFAULT_PREVIEW_URL;

  // URL input の局所 state（type 中は store に流し込まない）
  const [inputValue, setInputValue] = useState(committedUrl);

  // PM-943: 「アプリ内で開く」中の spawn ガード (連打防止)。
  const [isOpeningInApp, setIsOpeningInApp] = useState(false);

  // project 切替 / store 側からの commit で局所 state を同期
  useEffect(() => {
    setInputValue(committedUrl);
  }, [committedUrl]);

  const handleCommitUrl = useCallback(
    (next: string) => {
      if (!activeProjectId) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      if (trimmed === committedUrl) return;
      setCurrentUrl(activeProjectId, trimmed);
    },
    [activeProjectId, committedUrl, setCurrentUrl]
  );

  const handleOpenExternal = useCallback(async () => {
    const target = inputValue.trim() || committedUrl;
    if (!target) return;
    // URL を store に commit（履歴にも保存される）
    handleCommitUrl(target);
    try {
      // NOTE: dynamic import で SSR 時の plugin-shell 読込を回避（ApiKeyStep と同じ）
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(target);
      toast.info("外部ブラウザで開きました");
    } catch (e) {
      toast.error(`ブラウザを開けませんでした: ${String(e)}`);
      logger.error("[preview] open external failed:", e);
    }
  }, [inputValue, committedUrl, handleCommitUrl]);

  /**
   * PM-943: Tauri 2 `WebviewWindow` で secondary window を spawn する。
   *
   * 1. URL を commit（履歴保存）
   * 2. `WebviewWindow.getByLabel(label)` で同 project の既存 window 有無を確認
   *    - あれば `setFocus()` にフォールバック (同 URL / 別 URL 問わず、単純に focus
   *      を戻す)。URL 変更を反映したい場合は先に close してから再 spawn する分岐も
   *      考えられるが、「連打時のチラつき防止」を優先して focus 優先とする。
   * 3. なければ `new WebviewWindow(label, { url, title, ... })` で spawn
   *    - `tauri://created` で store register + toast
   *    - `tauri://error` で toast.error + store は登録しない
   *    - `tauri://destroyed` で store unregister（外部 close 操作への追従）
   * 4. spawn 失敗時は「外部ブラウザで開く」をユーザーに促すメッセージを表示
   */
  const handleOpenInApp = useCallback(async () => {
    if (!activeProjectId) return;
    const target = inputValue.trim() || committedUrl;
    if (!target) return;

    if (isOpeningInApp) return;
    setIsOpeningInApp(true);

    handleCommitUrl(target);

    const label = buildPreviewWindowLabel(activeProjectId);

    try {
      // dynamic import: SSR / Next.js dev server 配下で @tauri-apps/api を評価しても
      // runtime は Tauri webview 内でのみ動くので、lazy load で初回 bundle を軽くする。
      const { WebviewWindow, getAllWebviewWindows } = await import(
        "@tauri-apps/api/webviewWindow"
      );

      // PM-943 hotfix3: 古い preview window は label prefix 一致で全 destroy。
      // 新 label は Date.now() 付与で unique のため、destroy 失敗しても
      // `already exists` は発生しない (衝突しない新 label で spawn)。
      const labelPrefix = buildPreviewWindowLabelPrefix(activeProjectId);
      try {
        const allWindows = await getAllWebviewWindows();
        for (const w of allWindows) {
          if (w.label.startsWith(labelPrefix)) {
            try {
              await w.destroy();
            } catch (destroyErr) {
              logger.warn("[preview] destroy existing failed:", destroyErr);
            }
          }
        }
        unregisterWebviewWindow(activeProjectId, label);
      } catch (enumErr) {
        logger.warn("[preview] enumerate windows failed:", enumErr);
      }

      // 新規 spawn (必ず)
      const title = `Preview - ${target}`;
      const preview = new WebviewWindow(label, {
        url: target,
        title,
        width: 1280,
        height: 800,
        resizable: true,
        focus: true,
        visible: true,
        center: true,
        alwaysOnTop: true, // PM-943 hotfix4: 前面表示を確実化、created 後に false に戻す
      });

      // Promise を race させず、それぞれ once で listen する (Tauri の想定 API 使用法)。
      // created / error はどちらか 1 つだけ発火する。
      preview.once("tauri://created", async () => {
        registerWebviewWindow(activeProjectId, label);
        // PM-943 hotfix4: create 直後に show / unminimize / setFocus を明示呼出、
        // その後 alwaysOnTop を false に戻す (ユーザーが window を重ねられるよう)。
        try {
          await preview.show();
        } catch (e) {
          logger.warn("[preview] show failed:", e);
        }
        try {
          await preview.unminimize();
        } catch (e) {
          logger.warn("[preview] unminimize failed:", e);
        }
        try {
          await preview.setFocus();
        } catch (e) {
          logger.warn("[preview] setFocus after create failed:", e);
        }
        // 200ms 待って alwaysOnTop を解除 (前面表示確定してから)
        setTimeout(async () => {
          try {
            await preview.setAlwaysOnTop(false);
          } catch (e) {
            logger.warn("[preview] release alwaysOnTop failed:", e);
          }
        }, 200);
        toast.success("アプリ内プレビューを開きました");
        logger.info("[preview] webview window created:", label, target);
      });

      preview.once<string>("tauri://error", (e) => {
        logger.error("[preview] webview window error:", e.payload);
        toast.error(
          `アプリ内プレビューを開けませんでした。「ブラウザで開く」をお試しください: ${
            e.payload ?? "unknown"
          }`
        );
        unregisterWebviewWindow(activeProjectId, label);
      });

      // 外部操作 (OS の close ボタン等) で window が消えたら store を掃除する。
      // `tauri://destroyed` は Tauri 2 の共通イベント (Window 側)。
      preview.once("tauri://destroyed", () => {
        unregisterWebviewWindow(activeProjectId, label);
        logger.info("[preview] webview window destroyed:", label);
      });
    } catch (err) {
      // dynamic import / constructor sync 例外（capability 不足等）
      logger.error("[preview] open in-app failed:", err);
      toast.error(
        `アプリ内プレビューを開けませんでした: ${String(err)} / 「ブラウザで開く」をご利用ください`
      );
    } finally {
      setIsOpeningInApp(false);
    }
  }, [
    activeProjectId,
    inputValue,
    committedUrl,
    isOpeningInApp,
    handleCommitUrl,
    registerWebviewWindow,
    unregisterWebviewWindow,
  ]);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // PM-943: submit (Enter) は「アプリ内で開く」を既定挙動とする。
      // 「外部ブラウザで開く」は明示ボタンクリックのみ。
      void handleOpenInApp();
    },
    [handleOpenInApp]
  );

  if (!activeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        プロジェクトを選択するとプレビューが使えます
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col gap-3"
      >
        <label
          htmlFor="preview-url-input"
          className="text-sm font-medium text-foreground"
        >
          Preview URL
        </label>

        <div className="flex flex-col gap-2">
          <Input
            id="preview-url-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={() => handleCommitUrl(inputValue)}
            placeholder="http://localhost:3000"
            spellCheck={false}
            aria-label="プレビュー URL"
            className="h-10 w-full text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleOpenInApp()}
              variant="default"
              size="lg"
              aria-label="アプリ内で開く"
              title="アプリ内で開く (Tauri WebviewWindow)"
              className="h-10 gap-2"
              disabled={isOpeningInApp}
            >
              <Monitor className="h-4 w-4" aria-hidden />
              アプリ内で開く
            </Button>
            <Button
              type="button"
              onClick={() => void handleOpenExternal()}
              variant="outline"
              size="lg"
              aria-label="外部ブラウザで開く"
              title="外部ブラウザで開く"
              className="h-10 gap-2"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              ブラウザで開く
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden
          />
          <span>
            「アプリ内で開く」は ccmux-ide 内の別 window で表示します
            （PM-943 / v1.1 Phase 4.1）。表示されないサイトは「ブラウザで開く」をご利用ください。
          </span>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="詳細"
                  className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <Info className="h-3 w-3" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[340px] text-[11px]">
                v1.0 (PM-925〜933) は iframe 方式を試みましたが、WebView2 の
                security layer で外部 URL の接続拒否が解消せず撤退。
                v1.1 (PM-943 / Phase 4.1) からは Tauri 2 の secondary
                WebviewWindow で別 window を開く方式に切替え、iframe の
                X-Frame-Options / site-isolation 制約を回避しています。
                同一 window 内 preview (Cursor 同等 UX) は Phase 4.2 で対応予定。
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </form>
    </div>
  );
}
