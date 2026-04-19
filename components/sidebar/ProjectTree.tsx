"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readDir, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Loader2,
} from "lucide-react";

import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";
import { FilePreviewDialog } from "@/components/sidebar/FilePreviewDialog";
import type { ProjectFileEntry, ProjectSummary } from "@/lib/types";

/**
 * アクティブプロジェクトのファイルツリー（PM-204）。
 *
 * ツリー構造:
 *   {projectId}/
 *     ├─ brief.md
 *     ├─ decisions.md
 *     ├─ progress.md
 *     ├─ tasks.md
 *     └─ reports/
 *          ├─ ...md
 *          └─ ...md
 *
 * - 固定 4 ファイル（brief/decisions/progress/tasks）は存在しなくても常にスロットを表示
 *   （存在有無で disabled / 押せない状態を出し分け）
 * - `reports/` 配下は `readDir` で拾える `.md` のみを対象（2 階層目まで、深い再帰は不要）
 * - ファイル選択で `FilePreviewDialog` を開き Monaco (read-only) でプレビュー
 */

const ROOT_DOCS: readonly string[] = [
  "brief.md",
  "decisions.md",
  "progress.md",
  "tasks.md",
];

interface TreeState {
  rootFiles: { label: string; path: string; available: boolean }[];
  reports: ProjectFileEntry[];
  isLoading: boolean;
  error: string | null;
}

const INITIAL_TREE_STATE: TreeState = {
  rootFiles: [],
  reports: [],
  isLoading: false,
  error: null,
};

export function ProjectTree() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);

  const activeProject = useMemo<ProjectSummary | null>(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const [tree, setTree] = useState<TreeState>(INITIAL_TREE_STATE);
  const [reportsOpen, setReportsOpen] = useState(true);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(
    undefined
  );

  const loadTree = useCallback(async (project: ProjectSummary) => {
    setTree({ ...INITIAL_TREE_STATE, isLoading: true });
    try {
      // 固定 4 ファイル
      const rootFiles = await Promise.all(
        ROOT_DOCS.map(async (label) => {
          const p = await join(project.path, label);
          const ok = await exists(p);
          return { label, path: p, available: ok };
        })
      );

      // reports/ 配下の .md ファイル（2 階層目まで）
      const reportsDir = await join(project.path, "reports");
      const reportsExists = await exists(reportsDir);

      let reports: ProjectFileEntry[] = [];
      if (reportsExists) {
        const entries = await readDir(reportsDir);
        for (const entry of entries) {
          if (!entry.isFile) continue;
          if (!entry.name.toLowerCase().endsWith(".md")) continue;
          const p = await join(reportsDir, entry.name);
          reports.push({
            label: entry.name,
            path: p,
            category: "report",
          });
        }
        reports = reports.sort((a, b) =>
          a.label.localeCompare(b.label, "ja")
        );
      }

      setTree({
        rootFiles,
        reports,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      setTree({
        ...INITIAL_TREE_STATE,
        error: String(e),
      });
    }
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setTree(INITIAL_TREE_STATE);
      return;
    }
    void loadTree(activeProject);
  }, [activeProject, loadTree]);

  if (!activeProject) {
    // Sidebar 側で「active 時のみ表示」制御するため通常は描画されないが念のため
    return null;
  }

  function openPreview(path: string, label: string) {
    setPreviewPath(path);
    setPreviewLabel(label);
  }

  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      <div className="flex items-center gap-1.5 pt-1">
        <FolderTree
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {activeProject.id} のファイル
        </span>
      </div>

      {tree.isLoading && (
        <div className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          読込中...
        </div>
      )}

      {tree.error && (
        <p
          className="truncate rounded bg-destructive/10 px-1.5 py-1 text-[10px] text-destructive"
          title={tree.error}
        >
          {tree.error}
        </p>
      )}

      {!tree.isLoading && !tree.error && (
        <ul className="flex flex-col gap-0.5 text-xs" role="tree">
          {tree.rootFiles.map((f) => (
            <li key={f.label} role="treeitem">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left",
                  f.available
                    ? "hover:bg-accent cursor-pointer"
                    : "cursor-not-allowed opacity-50"
                )}
                disabled={!f.available}
                onClick={() =>
                  f.available && openPreview(f.path, f.label)
                }
                aria-label={`${f.label} をプレビュー`}
              >
                <FileText
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">{f.label}</span>
                {!f.available && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    未作成
                  </span>
                )}
              </button>
            </li>
          ))}

          {/* reports/ フォルダ */}
          <li role="treeitem" aria-expanded={reportsOpen}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
              onClick={() => setReportsOpen((v) => !v)}
              aria-label="reports フォルダの展開切替"
            >
              {reportsOpen ? (
                <ChevronDown
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <FolderTree
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate">reports/</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {tree.reports.length}
              </span>
            </button>

            {reportsOpen && (
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-4" role="group">
                {tree.reports.length === 0 ? (
                  <li className="px-1.5 py-1 text-[10px] text-muted-foreground">
                    レポートなし
                  </li>
                ) : (
                  tree.reports.map((r) => (
                    <li key={r.path} role="treeitem">
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                        onClick={() => openPreview(r.path, r.label)}
                        aria-label={`${r.label} をプレビュー`}
                      >
                        <FileText
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="truncate">{r.label}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </li>
        </ul>
      )}

      <FilePreviewDialog
        filePath={previewPath}
        label={previewLabel}
        onClose={() => {
          setPreviewPath(null);
          setPreviewLabel(undefined);
        }}
      />
    </div>
  );
}
