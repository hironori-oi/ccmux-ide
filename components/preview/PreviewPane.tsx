"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { ExternalLink, Info } from "lucide-react";

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
 * 本格的なアプリ内 preview (Tauri 2 secondary webview window / 案 D) は
 * Phase 4 / v1.1 以降で再実装する。
 *
 * ## v1.0 UX
 *
 * - URL 入力欄 + 「外部ブラウザで開く」ボタンのみ
 * - iframe / Reload / Back / Forward / 履歴 dropdown は **全て削除**
 * - プロジェクトごとの URL 保存機能は維持 (`lib/stores/preview` 経由)
 * - 「v1.0 では外部ブラウザで表示します / v1.1 で対応予定」の注記 + Info tooltip
 *
 * ## Phase 4 / v1.1 申し送り
 *
 * - PM-933 で導入した `src-tauri/capabilities/default.json` の 3 permission
 *   (`core:webview:allow-create-webview` / `allow-create-webview-window` /
 *   `core:window:allow-create`) は **維持**
 * - `src-tauri/tauri.conf.json` の CSP / devCsp / additionalBrowserArgs /
 *   dangerousDisableAssetCspModification も維持（将来の iframe 復活時の前提）
 * - v1.1 では `@tauri-apps/api/webview` の `WebviewWindow` で secondary window を
 *   spawn する実装に切替予定。本 component は "新しい webview で開く" ボタンに
 *   差し替えるだけで済む構造に保つ
 */

export function PreviewPane() {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const activeProjectId = activeProject?.id ?? null;

  // persist store から project ごとの URL を取得
  // （history は v1.0 では UI 露出しないが、store 側は PM-925 実装を維持）
  const urlEntry = usePreviewStore((s) =>
    activeProjectId ? s.urls[activeProjectId] : undefined
  );
  const setCurrentUrl = usePreviewStore((s) => s.setCurrentUrl);

  const committedUrl = urlEntry?.current ?? DEFAULT_PREVIEW_URL;

  // URL input の局所 state（type 中は store に流し込まない）
  const [inputValue, setInputValue] = useState(committedUrl);

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

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void handleOpenExternal();
    },
    [handleOpenExternal]
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

        <div className="flex gap-2">
          <Input
            id="preview-url-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={() => handleCommitUrl(inputValue)}
            placeholder="http://localhost:3000"
            spellCheck={false}
            aria-label="プレビュー URL"
            className="h-10 flex-1 text-sm"
          />
          <Button
            type="submit"
            variant="default"
            size="lg"
            aria-label="外部ブラウザで開く"
            title="外部ブラウザで開く"
            className="h-10 gap-2"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            外部ブラウザで開く
          </Button>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden
          />
          <span>
            ccmux-ide v1.0 では外部ブラウザで表示します
            （アプリ内 Preview は v1.1 で対応予定）。
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
              <TooltipContent side="bottom" className="max-w-[320px] text-[11px]">
                PM-925〜933 で iframe 方式を検証しましたが、WebView2 の
                security layer で外部 URL の接続拒否が解消しませんでした。
                v1.0 は確実に動作する外部ブラウザ方式に一本化し、
                v1.1 以降で Tauri 2 secondary webview window による
                アプリ内 preview を再実装予定です。
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </p>
      </form>
    </div>
  );
}
