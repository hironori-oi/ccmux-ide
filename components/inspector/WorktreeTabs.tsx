"use client";

import { useEffect, useState } from "react";
import { GitBranch, Loader2, Plus, RefreshCw, X } from "lucide-react";

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
import { WorktreeDialog } from "@/components/inspector/WorktreeDialog";
import { useWorktreeStore } from "@/lib/stores/worktree";
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * Week 7 Chunk 3 / PM-260: git worktree 一覧タブ UI。
 *
 * ## 仕様
 * - ProjectSwitcher で選ばれた active project の path を repo root として
 *   `useWorktreeStore` にセットし、`list_worktrees` を呼ぶ。
 * - 各 worktree を横並びチップとして描画。lucide `GitBranch` + ブランチ名。
 *   hover で末尾に `X` ボタンが現れ、クリックで `AlertDialog` 確認 → 削除。
 * - 右端の `+` ボタンで `WorktreeDialog` を開く。
 * - active worktree は primary underline + bg で強調。
 * - 空時は「worktree がありません」。repo 未選択時は「プロジェクト未選択」。
 *
 * ## 設計判断
 * - shadcn `Tabs` の TabsList/TabsTrigger を使うと value/onValueChange の同期が
 *   強く、`switchWorktree` の async 処理（sidecar 再起動）と相性が悪い。
 *   ここでは button ベースの自前タブにして、成功時だけ active 切替する。
 * - 削除確認は shadcn `AlertDialog` を使い、誤クリック防止（未コミット変更が
 *   失われる警告を表示）。
 */
export function WorktreeTabs() {
  const repoRoot = useWorktreeStore((s) => s.repoRoot);
  const setRepoRoot = useWorktreeStore((s) => s.setRepoRoot);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const isLoading = useWorktreeStore((s) => s.isLoading);
  const error = useWorktreeStore((s) => s.error);
  const fetchWorktrees = useWorktreeStore((s) => s.fetchWorktrees);
  const switchWorktree = useWorktreeStore((s) => s.switchWorktree);
  const removeWorktree = useWorktreeStore((s) => s.removeWorktree);

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProject = findProjectById(projects, activeProjectId);

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // active project 変更 → repo root 同期 → 一覧再取得
  useEffect(() => {
    if (activeProject?.path) {
      if (activeProject.path !== repoRoot) {
        setRepoRoot(activeProject.path);
      }
    }
    // repo root が新しくセットされたら fetch も行う
  }, [activeProject?.path, repoRoot, setRepoRoot]);

  useEffect(() => {
    if (repoRoot) void fetchWorktrees();
  }, [repoRoot, fetchWorktrees]);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {/* ヘッダ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
          Worktree
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => void fetchWorktrees()}
            disabled={!repoRoot || isLoading}
            aria-label="worktree 一覧を再取得"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => setCreateOpen(true)}
            disabled={!repoRoot || isLoading}
            aria-label="新しい worktree を作成"
          >
            <Plus className="h-3 w-3" aria-hidden />
          </Button>
        </div>
      </div>

      {/* エラー banner */}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {/* 本体 */}
      {!repoRoot ? (
        <p className="text-[11px] text-muted-foreground">
          プロジェクトが選択されていません
        </p>
      ) : worktrees.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">worktree がありません</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="worktree 一覧">
          {worktrees.map((wt) => {
            const isActive = wt.id === activeWorktreeId;
            return (
              <li key={wt.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void switchWorktree(wt.id)}
                  disabled={isLoading || isActive}
                  className={cn(
                    "flex items-center gap-1.5 rounded border px-2 py-1 pr-6 text-xs transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 font-medium text-primary underline underline-offset-4"
                      : "border-border/60 hover:border-border hover:bg-muted/50"
                  )}
                  title={wt.path}
                >
                  <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="max-w-[140px] truncate">{wt.branch}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRemoveId(wt.id);
                  }}
                  disabled={isLoading}
                  aria-label={`worktree ${wt.branch} を削除`}
                  className={cn(
                    "absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded",
                    "text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100",
                    "focus-visible:opacity-100"
                  )}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 新規作成ダイアログ */}
      <WorktreeDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* 削除確認 AlertDialog */}
      <AlertDialog
        open={confirmRemoveId !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmRemoveId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>worktree を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemoveId ? (
                <>
                  <span className="mb-1 block">
                    対象: <code className="rounded bg-muted px-1 py-0.5">{confirmRemoveId}</code>
                  </span>
                  <span className="block text-destructive">
                    未コミットの変更があれば失われます。`--force` で削除されます。
                  </span>
                </>
              ) : (
                "削除対象が選択されていません"
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmRemoveId) return;
                await removeWorktree(confirmRemoveId);
                setConfirmRemoveId(null);
              }}
              disabled={isLoading}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
