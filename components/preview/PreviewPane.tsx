"use client";

import {
  useCallback,
  useEffect,
  useRef,
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
  type PreviewWindowGeometry,
} from "@/lib/stores/preview";
import { usePreviewInstances } from "@/lib/stores/preview-instances";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * PRJ-012 v1.0 / PM-936 (2026-04-20): ブラウザプレビュー pane (iframe 撤退版)。
 * PRJ-012 v1.1 / PM-943 (2026-04-20): Tauri 2 secondary WebviewWindow 追加
 * (Preview Phase 4.1)。
 * PRJ-012 v1.1 / PM-944 (2026-04-20): spawn を Rust 側 `WebviewWindowBuilder` に
 * 切替 (Windows WebView2 user data dir 競合を解消)。
 * PRJ-012 v1.2 / PM-945 (2026-04-20): Preview window の位置 / サイズを project ごとに
 * 記憶。次回「アプリ内で開く」時に同じ geometry で spawn する (Cursor / VSCode 同等)。
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
 * ### PM-945: Window geometry 記憶
 * - spawn 成功後、`WebviewWindow.getByLabel(label)` で preview window handle を取得し
 *   `onMoved` / `onResized` / `onCloseRequested` を listen。
 * - 各 event で最新 geometry を ref に貯め、**ユーザー操作終了後の最終値**を
 *   `setWindowGeometry(projectId, geometry)` で store に persist する。
 * - polling はしない（event-driven）。connect 確立の 1 回 `outerPosition()` +
 *   `innerSize()` で初期値を取得し、以後は event delta で更新する。
 * - unlisten fn は ref に保持。次回 spawn で上書き、component unmount で cleanup。
 * - 次回 spawn 時に `getWindowGeometry(projectId)` から取り出して Rust command に渡す。
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

/**
 * PM-973: `previewId` prop で複数独立インスタンス対応。
 * - `previewId` 未指定: 旧動作 (project 単位 1 URL、usePreviewStore)
 * - `previewId` 指定:   `usePreviewInstances` からインスタンス固有 URL を読み書き
 *
 * in-app secondary WebviewWindow の spawn は引き続き project 単位 (同プロジェクト
 * の preview が複数 slot に配置されていても secondary window は 1 つに収束)。
 */
export function PreviewPane({ previewId }: { previewId?: string } = {}) {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const activeProjectId = activeProject?.id ?? null;

  // PM-973: instance URL (previewId 指定時)
  const instance = usePreviewInstances((s) =>
    previewId ? s.instances[previewId] : undefined
  );
  const setInstanceUrl = usePreviewInstances((s) => s.setUrl);

  // persist store から project ごとの URL を取得 (fallback for legacy previewId 未指定)
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
  // PM-945: geometry store action を関数参照で取得（selector の再生成で rerender
  // しないよう reference を安定させる。zustand の action は unstable ref OK）。
  const getWindowGeometry = usePreviewStore((s) => s.getWindowGeometry);
  const setWindowGeometry = usePreviewStore((s) => s.setWindowGeometry);

  // PM-973: URL の解決優先度は instance > project store > DEFAULT
  const committedUrl =
    instance?.url ?? urlEntry?.current ?? DEFAULT_PREVIEW_URL;

  // URL input の局所 state（type 中は store に流し込まない）
  const [inputValue, setInputValue] = useState(committedUrl);

  // PM-943: 「アプリ内で開く」中の spawn ガード (連打防止)。
  const [isOpeningInApp, setIsOpeningInApp] = useState(false);

  // PM-945: 現在 tracking 中の preview window に張った unlisten 関数群。
  // - spawn 成功 → 各 event listen で unlisten を push
  // - 次回 spawn or component unmount → まとめて解除
  // - ref で保持し rerender に影響させない
  const geometryUnlistensRef = useRef<UnlistenFn[]>([]);
  // PM-945: 現在 tracking 対象の projectId / label。close event で正しい key に
  // 対して setWindowGeometry するため保持する（event 時点で activeProjectId が
  // 別 project に切り替わっていても correct key に書き込めるように）。
  const trackingRef = useRef<{ projectId: string; label: string } | null>(null);
  // PM-945: 最新 geometry。onMoved / onResized が部分的に更新するので merge 用。
  const latestGeometryRef = useRef<PreviewWindowGeometry | null>(null);

  // project 切替 / store 側からの commit で局所 state を同期
  useEffect(() => {
    setInputValue(committedUrl);
  }, [committedUrl]);

  const handleCommitUrl = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!trimmed) return;
      if (trimmed === committedUrl) return;
      // PM-973: previewId 指定時は instance 側に書き込む
      if (previewId) {
        setInstanceUrl(previewId, trimmed);
        return;
      }
      if (!activeProjectId) return;
      setCurrentUrl(activeProjectId, trimmed);
    },
    [
      previewId,
      activeProjectId,
      committedUrl,
      setCurrentUrl,
      setInstanceUrl,
    ]
  );

  /**
   * PM-945: 現在の preview window に張った `onMoved` / `onResized` /
   * `onCloseRequested` listener を全解除する。
   *
   * - 次回 spawn 直前 / component unmount 時に呼ぶ。
   * - flush=true の場合、unlisten 前に `latestGeometryRef` を store に書き込む
   *   （unmount 時 / 新 spawn 時に未保存の差分を捨てないため）。
   * - 解除失敗は log のみ（既に window が destroy 済み等で失敗し得るが無害）。
   */
  const clearGeometryListeners = useCallback(
    (flush: boolean) => {
      const tracking = trackingRef.current;
      const latest = latestGeometryRef.current;
      if (flush && tracking && latest) {
        setWindowGeometry(tracking.projectId, latest);
      }
      const unlistens = geometryUnlistensRef.current;
      geometryUnlistensRef.current = [];
      trackingRef.current = null;
      latestGeometryRef.current = null;
      for (const fn of unlistens) {
        try {
          fn();
        } catch (e) {
          logger.warn("[preview] geometry listener unlisten failed:", e);
        }
      }
    },
    [setWindowGeometry]
  );

  /**
   * PM-945: spawn 済み preview window に geometry tracking listener を attach する。
   *
   * 手順:
   * 1. `WebviewWindow.getByLabel(label)` で handle 取得（null なら抜ける）
   * 2. 初期 geometry を `outerPosition()` + `innerSize()` で取得し
   *    `latestGeometryRef` に格納 + store に 1 回 commit
   * 3. `onMoved` / `onResized` で ref を update（毎フレーム store 書込みは重いので
   *    ref のみ更新 → close 時に flush）
   * 4. `onCloseRequested` で最終値を store に書き込み、listener を全解除
   *
   * エラーは警告 log のみ（geometry 記憶が失敗しても preview 機能自体は継続可）。
   */
  const attachGeometryListeners = useCallback(
    async (projectId: string, label: string): Promise<void> => {
      try {
        // dynamic import: SSR 時の webviewWindow 読込回避（ApiKeyStep / spawn 呼出と同じ）
        const { WebviewWindow } = await import(
          "@tauri-apps/api/webviewWindow"
        );
        const win = await WebviewWindow.getByLabel(label);
        if (!win) {
          logger.warn(
            "[preview] attachGeometryListeners: window not found:",
            label
          );
          return;
        }

        // 1. 初期 geometry snapshot（次回 spawn の復元値として有用 / event が来ない
        //    前に window が閉じられても min 復元できる）
        try {
          const [pos, size] = await Promise.all([
            win.outerPosition(),
            win.innerSize(),
          ]);
          const init: PreviewWindowGeometry = {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
          };
          latestGeometryRef.current = init;
          setWindowGeometry(projectId, init);
        } catch (e) {
          // 初期取得に失敗しても tracking 自体は継続。event で値が埋まる。
          logger.warn("[preview] initial geometry snapshot failed:", e);
        }

        trackingRef.current = { projectId, label };

        // 2. onMoved: outer position 更新のみ（size は未知なので前回値を保持）
        const unMoved = await win.onMoved(({ payload }) => {
          // payload は PhysicalPosition: { type: "Physical", x, y }
          const prev = latestGeometryRef.current;
          latestGeometryRef.current = {
            x: payload.x,
            y: payload.y,
            width: prev?.width ?? 0,
            height: prev?.height ?? 0,
          };
        });
        geometryUnlistensRef.current.push(unMoved);

        // 3. onResized: inner size 更新のみ
        const unResized = await win.onResized(({ payload }) => {
          // payload は PhysicalSize: { type: "Physical", width, height }
          const prev = latestGeometryRef.current;
          latestGeometryRef.current = {
            x: prev?.x ?? 0,
            y: prev?.y ?? 0,
            width: payload.width,
            height: payload.height,
          };
        });
        geometryUnlistensRef.current.push(unResized);

        // 4. onCloseRequested: 最終値を flush → listener 解除
        //    preventDefault しないので close は通常通り実行される。
        const unClose = await win.onCloseRequested(() => {
          const tracking = trackingRef.current;
          const latest = latestGeometryRef.current;
          if (tracking && latest) {
            setWindowGeometry(tracking.projectId, latest);
            logger.info(
              "[preview] saved geometry on close:",
              tracking.projectId,
              latest
            );
          }
          // listener 自体の解除は setTimeout 0 で次 tick に遅延（close event の
          // 内部処理と unlisten IPC が同時発火すると Tauri 内部で race する回避策）
          setTimeout(() => clearGeometryListeners(false), 0);
        });
        geometryUnlistensRef.current.push(unClose);

        logger.info(
          "[preview] geometry listeners attached:",
          label,
          "projectId=",
          projectId
        );
      } catch (e) {
        logger.warn("[preview] attachGeometryListeners failed:", e);
      }
    },
    [setWindowGeometry, clearGeometryListeners]
  );

  // PM-945: component unmount 時に listener を cleanup（flush あり）。
  // effect の dep は空で、mount/unmount 時のみ実行される。
  // clearGeometryListeners は useCallback なので ref 同等、stale を気にしない。
  useEffect(() => {
    return () => {
      clearGeometryListeners(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // PM-945: 新規 spawn 前に既存 preview の listener を cleanup し、未 flush の
    // 最新 geometry を store に書き出す（旧 window は Rust 側 destroy で消える）。
    clearGeometryListeners(true);

    // PM-945: 前回 close 時の geometry があれば Rust に渡す。未登録なら undefined。
    // undefined は JSON serialize で削除され、Rust 側 `Option<f64>` が None になる。
    const savedGeometry = getWindowGeometry(activeProjectId);

    try {
      await callTauri<void>("spawn_preview_window", {
        label,
        url: target,
        title,
        // PM-945: optional geometry。全部 undefined なら Rust 側 default
        // (center + 1280x800) で spawn される（初回起動 / 未登録 project）。
        x: savedGeometry?.x,
        y: savedGeometry?.y,
        width: savedGeometry?.width,
        height: savedGeometry?.height,
      });
      registerWebviewWindow(activeProjectId, label);
      toast.success("アプリ内プレビューを開きました");
      logger.info(
        "[preview] rust-spawned window created:",
        label,
        target,
        savedGeometry ? "(restored geometry)" : "(default geometry)"
      );
      // PM-945: spawn 成功後に geometry listener を attach。fire-and-forget だが
      // エラー時は内部で log のみで、UI への影響はない。
      void attachGeometryListeners(activeProjectId, label);
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
    getWindowGeometry,
    attachGeometryListeners,
    clearGeometryListeners,
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
            「アプリ内で開く」は Sumi 内の別 window で表示します
            （PM-944 / v1.1 Phase 4.1 Rust spawn）。表示されないサイトは「ブラウザで開く」をご利用ください。
            （PM-945 / v1.2: ウィンドウ位置とサイズはプロジェクトごとに記憶されます）
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
