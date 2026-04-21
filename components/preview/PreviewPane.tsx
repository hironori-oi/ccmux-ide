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
import { callTauri } from "@/lib/tauri-api";
import { useProjectStore } from "@/lib/stores/project";
import {
  DEFAULT_PREVIEW_URL,
  usePreviewStore,
} from "@/lib/stores/preview";

/**
 * PRJ-012 v1.0 / PM-936 (2026-04-20): ブラウザプレビュー pane (iframe 撤退版)。
 * PRJ-012 v1.1 / PM-943 (2026-04-20): Tauri 2 secondary WebviewWindow 追加
 * (Preview Phase 4.1)。
 * PRJ-012 v1.1 / PM-944 (2026-04-20): spawn を Rust 側 `WebviewWindowBuilder` に
 * 切替 (Windows WebView2 user data dir 競合を解消)。
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
 * ## v1.1 PM-943 (Phase 4.1) - JS API spawn
 *
 * PM-942 feasibility 調査で Tauri 2 の **secondary `WebviewWindow`** は iframe と
 * 違い X-Frame-Options / WebView2 site-isolation の影響を受けないことを確認。
 * `@tauri-apps/api/webviewWindow` の `new WebviewWindow()` で spawn したが、
 * Windows で以下症状が 7 hotfix (a927d7f → b675b7c) 経ても解消せず:
 *
 * - `tauri://created` は受信する
 * - 直後の `isVisible()` が `runtime error: failed to receive message from webview`
 *   で reject される
 * - OS 上に window が現れない（Alt+Tab にも出ない）
 *
 * Root cause: PM-942 §8 R3「Windows は multi-webview で user data dir 個別指定が
 * 必須」。JS API では `dataDirectory` option が公開されておらず、親 main window と
 * user data dir を共有しようとして WebView2 排他 lock で spawn 直後に死亡。
 *
 * ## v1.1 PM-944 (Phase 4.1 再実装) - Rust builder spawn
 *
 * Rust 側に `spawn_preview_window` command を新設し、`WebviewWindowBuilder` の
 * `data_directory(app_local_data_dir/preview-webview/{label})` を指定して build。
 *
 * - 同 label の既存 window destroy も Rust 側で sync 処理（`already exists` race 解消）
 * - build() が Ok を返した時点で OS window は表示済み（`visible(true)` で spawn）
 * - frontend は `invoke("spawn_preview_window", { label, url, title })` 1 呼出のみ
 * - `tauri://created` / `tauri://error` / `tauri://destroyed` の listener は不要
 *   （Promise の resolve / reject で成否判定）
 *
 * ### UX
 * - project 1 つにつき **同時 1 つ** の preview window（label: `preview-${projectId}`）
 * - 固定 label に回帰 (PM-943 hotfix3 の timestamp nonce は Rust 側 sync destroy で
 *   不要になった)
 * - URL 変更・同 URL 問わず「アプリ内で開く」ボタンで既存 destroy → 新規 create
 *
 * ### spawn 後の store 管理
 * - 成功時 `registerWebviewWindow(projectId, label)` で store に登録
 * - OS close 等による消滅は **polling なし**。次回「アプリ内で開く」時に Rust 側で
 *   destroy を試みる (既に消えていても OK) ので、store の stale な entry は無害。
 *   将来的に Rust event (`tauri://destroyed` を Rust 経由 emit) で unregister する
 *   拡張は Phase 4.2 で検討。
 *
 * ## Phase 4.2 申し送り
 * - 同一 window 内 multi-webview (`@tauri-apps/api/webview` + `unstable` feature) で
 *   Cursor 同等の in-IDE preview UX を実現する計画。
 * - URL 変更時の navigate API が stable 化したら close/create を navigate に置換。
 */

// PM-944: 固定 label に回帰。Rust 側で `get_webview_window().destroy()` → `build()`
// が同期的に完結するため、PM-943 hotfix3 の timestamp nonce は不要。
// Tauri 2 の label 仕様は alphanumeric / `-` / `_` を推奨。
function buildPreviewWindowLabel(projectId: string): string {
  const sanitized = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `preview-${sanitized}`;
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
   * PM-944: Rust 側 `spawn_preview_window` command で secondary window を spawn する。
   *
   * 1. URL を commit（履歴保存）
   * 2. `invoke("spawn_preview_window", { label, url, title })`
   *    - Rust 側で同 label の既存 window を destroy（sync）
   *    - user data dir を `app_local_data_dir()/preview-webview/{label}` に分離
   *    - `WebviewWindowBuilder::build()` で visible=true で OS window を生成
   *    - build 成功 = OS window 表示済み
   * 3. 成功時 store register + toast.success
   * 4. 失敗時 store unregister + toast.error（外部ブラウザ fallback を案内）
   *
   * 以前 (PM-943) は `tauri://created` / `tauri://error` / `tauri://destroyed` の
   * event listener を張っていたが、Rust 側 sync spawn では Promise 1 本で完結。
   */
  const handleOpenInApp = useCallback(async () => {
    if (!activeProjectId) return;
    const target = inputValue.trim() || committedUrl;
    if (!target) return;

    if (isOpeningInApp) return;
    setIsOpeningInApp(true);

    handleCommitUrl(target);

    const label = buildPreviewWindowLabel(activeProjectId);
    const title = `Preview - ${target}`;

    try {
      await callTauri<void>("spawn_preview_window", {
        label,
        url: target,
        title,
      });
      registerWebviewWindow(activeProjectId, label);
      toast.success("アプリ内プレビューを開きました");
      logger.info("[preview] rust-spawned window created:", label, target);
    } catch (err) {
      logger.error("[preview] rust spawn failed:", err);
      unregisterWebviewWindow(activeProjectId, label);
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
            （PM-944 / v1.1 Phase 4.1 Rust spawn）。表示されないサイトは「ブラウザで開く」をご利用ください。
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
                v1.1 (PM-943) で Tauri 2 secondary WebviewWindow に切替、
                PM-944 で JS API → Rust `WebviewWindowBuilder` に再切替
                (Windows WebView2 user data dir 競合を `data_directory` 明示で解消)。
                同一 window 内 preview (Cursor 同等 UX) は Phase 4.2 で対応予定。
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </form>
    </div>
  );
}
