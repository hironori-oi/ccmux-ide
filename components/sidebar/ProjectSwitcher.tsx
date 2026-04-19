"use client";

import { useEffect } from "react";
import { ChevronDown, FolderOpen, FolderSearch, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * サイドバー最上部のプロジェクト切替ドロップダウン（PM-203）。
 *
 * - マウント時に `fetchProjects()` を呼び、`claude-code-company/projects/` 配下から
 *   `brief.md` 入りディレクトリ一覧を取得する
 * - 現在の `activeProjectId` をトリガラベルに表示、クリックで shadcn DropdownMenu
 *   として候補を展開
 * - 候補が 0 件の時は「案件なし」表示（`brief.md` 無しや workspace 未解決）
 * - 再読込ボタン（lucide FolderSearch）で手動 refetch
 * - UI 文言は全文日本語
 */
export function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const active = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="flex flex-col gap-1 px-2 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          プロジェクト
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => void fetchProjects()}
          aria-label="プロジェクト一覧を再読込"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FolderSearch className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between gap-2 px-2"
            aria-label="プロジェクトを選択"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderOpen
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate text-left text-xs font-medium">
                {active
                  ? active.title
                    ? `${active.id} — ${active.title}`
                    : active.id
                  : projects.length === 0
                    ? "案件なし"
                    : "プロジェクトを選択"}
              </span>
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            案件を選択
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {projects.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              {isLoading ? "読込中..." : "案件なし"}
            </div>
          ) : (
            projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setActiveProject(p.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5",
                    isActive && "bg-accent/60"
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <FolderOpen
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-xs font-medium">
                      {p.id}
                    </span>
                    {p.phase && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Phase {p.phase}
                      </span>
                    )}
                  </span>
                  {p.title && (
                    <span className="line-clamp-1 pl-5 text-[10px] text-muted-foreground">
                      {p.title}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <p className="mt-1 truncate rounded bg-destructive/10 px-1.5 py-1 text-[10px] text-destructive" title={error}>
          読込失敗: {error}
        </p>
      )}
    </div>
  );
}
