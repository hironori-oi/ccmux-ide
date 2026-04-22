"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Folder,
  Loader2,
  Power,
  PowerOff,
  Settings,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore } from "@/lib/stores/project";
import {
  isTransitionalStatus,
  normalizeSidecarStatus,
  type SidecarStatus,
} from "@/lib/sidecar-status";
import type { RegisteredProject } from "@/lib/types";

/**
 * PM-172 / v3.3 Chunk C (DEC-033) 改訂: タイトルバー（画面上端・36px 固定）。
 *
 * ## v3.3 での変更点
 *  - cwd 編集ボタンを **read-only 表示** に降格（クリック無効、tooltip で案内）
 *  - `useChatStore.cwd` 参照を削除、`activeProject.path` から導出
 *  - `start_agent_sidecar` / `stop_agent_sidecar` の直接呼出は削除。
 *    Multi-Sidecar 時代では ProjectRail 経由の `setActiveProject(id)` が
 *    Chunk B 実装の `ensureSidecarRunning` を内部で発火する想定。
 *  - switching loader は `activeProject.sidecarStatus ∈ {starting, stopping}`
 *    の時のみ表示（TitleBar で独立に state を持たない）。
 *
 * ## read-only で残す理由（廃止との比較）
 *  Claude CLI が「どのフォルダを基準に動いているか」は、ユーザーへの透明性上
 *  極めて重要。複数プロジェクトを切替える文脈では特に、現在選択中のパスを
 *  TitleBar に常時表示することで「意図した project で Claude が動いているか」
 *  をひと目で確認できる。完全に隠すと誤解（別 project のつもりで送信など）を
 *  誘発しやすい。
 *
 * 左:
 *  - ブランド名 `Sumi`（アイコンは OS ウィンドウタイトルと重複するため削除）
 *  - activeProject の `{title}: {path}` 短縮表示（read-only）
 *  - 未選択時は「プロジェクト未選択」placeholder
 *  - sidecarStatus が `starting`/`stopping` の間は `Loader2` スピナー表示
 * 右:
 *  - `<ThemeToggle />`（PM-170）
 *  - アカウントドロップダウン placeholder（M2 以降本実装）
 */
export function TitleBar() {
  const router = useRouter();
  const activeProjectRaw = useProjectStore((s) => s.getActiveProject());
  const removeProject = useProjectStore((s) => s.removeProject);
  const stopSidecar = useProjectStore((s) => s.stopSidecar);
  const ensureSidecarRunning = useProjectStore((s) => s.ensureSidecarRunning);
  // v3.3 DEC-033 (review-v6): store の sidecarStatus map を subscribe
  const sidecarStatusRaw = useProjectStore((s) =>
    activeProjectRaw ? s.sidecarStatus[activeProjectRaw.id] : undefined
  );
  const sidecarStatus = normalizeSidecarStatus(sidecarStatusRaw);
  const switching = isTransitionalStatus(sidecarStatus);
  // v3.5.5: 停止 / 削除を分離。2 AlertDialog を管理。
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // v3.4.8 Hydration mismatch 修正（2026-04-20）:
  // zustand persist は client 側でのみ localStorage から activeProject を復元するため、
  // SSR の初期 render（activeProject=null）と client hydration 後（復元済）で DOM が
  // 一致しないと React が mismatch エラーを投げる。
  // mount 前は activeProject=null として扱って SSR と同じ出力を保証し、mount 後に
  // 実データへ切替える。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeProject = mounted ? activeProjectRaw : null;

  // v3.5.5: Claude 停止のみ（registry 残置、再起動可能）
  function handleConfirmStop() {
    if (!activeProject) return;
    const name = activeProject.title;
    void stopSidecar(activeProject.id);
    setStopConfirmOpen(false);
    toast.success(
      `Claude を停止しました: ${name}（プロジェクトは残したまま、再起動できます）`
    );
  }

  // v3.5.5: プロジェクト完全削除（registry から除外 + sidecar kill）
  function handleConfirmRemove() {
    if (!activeProject) return;
    const name = activeProject.title;
    void removeProject(activeProject.id);
    setRemoveConfirmOpen(false);
    toast.success(`プロジェクトを削除しました: ${name}`);
  }

  // v3.5.5: 停止中なら「再起動」ボタンに切替
  const isStopped = sidecarStatus === "stopped" || sidecarStatus === "error";
  function handleRestart() {
    if (!activeProject) return;
    void ensureSidecarRunning(activeProject.id);
    toast.info(`Claude を起動中...`);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <header
        aria-label="タイトルバー"
        className="flex h-9 shrink-0 items-center justify-between border-b bg-background px-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold tracking-tight">
            Sumi
          </span>
          <CwdReadonlyIndicator
            project={activeProject}
            sidecarStatus={sidecarStatus}
          />
          {/*
           * v3.5.5 (2026-04-20): 「停止」と「削除」を分離。
           *  - 停止（PowerOff）: Claude プロセスのみ終了、registry に project を残す（再起動可）
           *    running 中のみ表示、停止中は「起動」(Power) に切替わり再起動 trigger
           *  - 削除（Trash2）: registry から除外 + sidecar kill、アイコン消失
           */}
          {activeProject && (
            <>
              {/* 停止 / 起動 トグル */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                    onClick={
                      isStopped
                        ? handleRestart
                        : () => setStopConfirmOpen(true)
                    }
                    aria-label={
                      isStopped ? "Claude を起動" : "Claude を停止"
                    }
                    disabled={switching}
                  >
                    {isStopped ? (
                      <>
                        <Power className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        起動
                      </>
                    ) : (
                      <>
                        <PowerOff className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                        停止
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {isStopped ? "Claude を起動" : "Claude を停止"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {isStopped
                        ? "このプロジェクトの Claude プロセスを再起動します"
                        : "Claude プロセスを終了します（プロジェクトは残ります）"}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>

              {/* 削除 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setRemoveConfirmOpen(true)}
                    aria-label="プロジェクトを削除"
                    disabled={switching}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    削除
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">プロジェクトを削除</span>
                    <span className="text-[10px] text-muted-foreground">
                      登録一覧から外します（フォルダ自体は削除されません）
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {switching && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label={
                sidecarStatus === "starting"
                  ? "Claude を起動中"
                  : "Claude を停止中"
              }
            />
          )}
          {/* v3.5.6 (2026-04-20): 設定画面（背景画像 / テーマ / アクセント / MCP / API Key 等）への
              ナビボタンを常設。旧は /config slash or URL 直打ちしか導線が無く発見性が低かった。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => router.push("/settings")}
                aria-label="設定"
              >
                <Settings className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">設定</span>
                <span className="text-[10px] text-muted-foreground">
                  テーマ / 背景画像 / MCP / API Key など
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
          <ThemeToggle />
          {/* アカウントドロップダウン placeholder */}
          <div aria-hidden className="h-8 w-8" />
        </div>
      </header>

      {/* v3.5.5: Claude 停止の確認（registry は残す） */}
      <AlertDialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Claude を停止しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {activeProject ? (
                  <>
                    <span className="block font-medium text-foreground">
                      {activeProject.title}
                    </span>
                    <span className="mt-1 block break-all text-xs text-muted-foreground">
                      {activeProject.path}
                    </span>
                    <span className="mt-3 block">
                      Claude プロセスのみ終了します。プロジェクトはアイコンとして残り、いつでも再起動できます。
                    </span>
                    <span className="mt-2 block text-xs text-amber-700 dark:text-amber-400">
                      会話途中の場合、未送信の応答は中断されます。
                    </span>
                  </>
                ) : (
                  <span>対象プロジェクトが見つかりません</span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStop}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Claude を停止
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v3.5.5: プロジェクト完全削除の確認（registry から除外） */}
      <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>プロジェクトを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {activeProject ? (
                  <>
                    <span className="block font-medium text-foreground">
                      {activeProject.title}
                    </span>
                    <span className="mt-1 block break-all text-xs text-muted-foreground">
                      {activeProject.path}
                    </span>
                    <span className="mt-3 block">
                      登録一覧からこのプロジェクトを削除します。左のアイコンも消えます。フォルダやファイル自体は削除されません。
                    </span>
                    <span className="mt-2 block text-xs text-destructive">
                      起動中の Claude プロセスもあわせて終了します。再度使うには「+」から再登録が必要です。
                    </span>
                  </>
                ) : (
                  <span>対象プロジェクトが見つかりません</span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

/**
 * Read-only な activeProject cwd 表示。
 *
 * - activeProject があれば `{title}: {短縮 path}` を 1 行で表示
 * - 未選択時は placeholder
 * - クリック不可（disabled）、Tooltip でその旨と ProjectRail 経由の案内を出す
 * - full path は `title` attr（ネイティブ tooltip）でも確認できる
 *
 * role="status" ではなく `div` のままにする（状態通知ではなく静的表示のため）。
 */
function CwdReadonlyIndicator({
  project,
  sidecarStatus,
}: {
  project: RegisteredProject | null;
  sidecarStatus: SidecarStatus;
}) {
  const hasProject = project !== null;
  const display = hasProject
    ? truncateCwd(project.path, 40)
    : "プロジェクト未選択";
  const ariaLabel = hasProject
    ? `選択中プロジェクト: ${project.title}（${project.path}）— フォルダを切替えるには左の ProjectRail から操作してください`
    : "プロジェクト未選択 — 左の + からプロジェクトを追加してください";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="note"
          aria-label={ariaLabel}
          className={
            "ml-2 flex min-w-0 max-w-full cursor-default items-center gap-1.5 rounded border border-transparent px-2 py-0.5 text-xs " +
            (hasProject
              ? "text-muted-foreground"
              : "text-muted-foreground/60")
          }
          title={
            hasProject
              ? `選択中プロジェクト: ${project.title}\n${project.path}\n(フォルダ切替は左の ProjectRail から)`
              : "プロジェクト未選択 (左の + から追加)"
          }
        >
          <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {hasProject ? (
            <>
              <span className="shrink-0 max-w-[140px] truncate font-semibold text-foreground/80">
                {project.title}
              </span>
              <span className="text-muted-foreground/50" aria-hidden>
                :
              </span>
              <span className="truncate font-mono">{display}</span>
            </>
          ) : (
            <span className="truncate">{display}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {hasProject ? (
          <div className="flex flex-col gap-1">
            <span className="font-semibold">{project.title}</span>
            <span className="break-all font-mono text-[10px] text-muted-foreground">
              {project.path}
            </span>
            <span className="text-muted-foreground">
              フォルダを切替えるには左の ProjectRail から別プロジェクトを選択してください。
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              sidecar: {sidecarStatus}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="font-semibold">プロジェクト未選択</span>
            <span className="text-muted-foreground">
              左の「+」ボタンから任意のフォルダをプロジェクトとして追加できます。
            </span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// v3.3 DEC-033 (review-v6): `readSidecarStatus(project)` は削除。
// Chunk B の正しい store API (`useProjectStore().sidecarStatus[id]`) に
// 直接 subscribe する方式に切り替えたため、アクセサ関数は不要になった。

/**
 * 表示用にパスを短縮する（既存実装を維持）。
 *
 * ルール:
 *  1. HOME (`/Users/xxx` / `C:\Users\xxx`) を `~` に置換
 *  2. それでも `maxLen` を超える場合、先頭セグメントを `~/...` に畳み、
 *     末尾セグメント（最後の 2 要素程度）をフル表示する
 *  3. 区切り文字は OS に依らずそのまま残す
 */
function truncateCwd(cwd: string, maxLen: number): string {
  const homeReplaced = replaceHomePrefix(cwd);
  if (homeReplaced.length <= maxLen) return homeReplaced;

  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const parts = homeReplaced.split(/[\\/]/).filter((p) => p.length > 0);

  if (parts.length <= 2) {
    return homeReplaced;
  }

  const leadsWithHome = homeReplaced.startsWith("~");
  const prefix = leadsWithHome ? "~" + sep : sep;

  let tail = "";
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = parts[i] + (tail ? sep + tail : "");
    if (prefix.length + 3 + sep.length + candidate.length > maxLen) {
      break;
    }
    tail = candidate;
  }

  if (!tail) {
    tail = parts[parts.length - 1] ?? "";
  }

  const result = leadsWithHome
    ? `~${sep}...${sep}${tail}`
    : `${sep}...${sep}${tail}`;

  if (result.length <= maxLen) return result;
  const head = result.slice(0, Math.max(0, maxLen - 1));
  return head + "…";
}

/**
 * HOME プレフィックスを `~` に置換。判定できなければ原文をそのまま返す。
 */
function replaceHomePrefix(cwd: string): string {
  const winMatch = cwd.match(/^([A-Za-z]):[\\/]Users[\\/]([^\\/]+)([\\/].*)?$/);
  if (winMatch) {
    const tail = winMatch[3] ?? "";
    return "~" + tail;
  }
  const macMatch = cwd.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (macMatch) {
    return "~" + (macMatch[1] ?? "");
  }
  const linuxMatch = cwd.match(/^\/home\/[^/]+(\/.*)?$/);
  if (linuxMatch) {
    return "~" + (linuxMatch[1] ?? "");
  }
  return cwd;
}
