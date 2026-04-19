"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { ChevronLeft, FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { MemoryEditor } from "@/components/inspector/MemoryEditor";
import { callTauri } from "@/lib/tauri-api";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/types";

/**
 * Week 7 Chunk 2 / PM-241: MemoryEditor を 3 スコープタブでラップするパネル。
 *
 * ## 役割
 * - `scan_memory_tree` を再利用して、スコープ（Global / Project / Cwd）ごとの
 *   候補 CLAUDE.md リストを取得。複数あれば dropdown 相当の select を表示。
 * - タブ下にファイル絶対パスを monospace で表示（MemoryEditor 内 header に委譲）。
 * - 該当スコープに CLAUDE.md が無い場合は「新規作成」ボタンで空ファイル作成。
 *
 * ## scope の判定基準（MemoryTreeView と同じ）
 * - `Global`: `~/.claude/CLAUDE.md`
 * - `Project`: Parent + Project を束ねる（backend で scope を付与）
 * - `Cwd`: 現在の cwd 直下（M3 以降で active project path に追従予定）
 */

type GroupKey = "Global" | "Project" | "Cwd";

const GROUP_LABEL: Record<GroupKey, string> = {
  Global: "Global",
  Project: "Project",
  Cwd: "Cwd",
};

const GROUP_DESCRIPTION: Record<GroupKey, string> = {
  Global: "~/.claude/CLAUDE.md（全プロジェクト共通）",
  Project: "プロジェクト直下 + 親階層の CLAUDE.md",
  Cwd: "現在の作業ディレクトリ直下",
};

export interface MemoryEditorPanelProps {
  /**
   * 編集対象の初期ファイルパス。MemoryTreeView から渡される絶対パス。
   * スコープは backend からの TreeNode 情報で自動判定する。
   */
  filePath: string;
  onClose: () => void;
  /** MemoryTreeView と同様の `scan_memory_tree` 引数（未指定でホーム） */
  repoRoot?: string;
}

export function MemoryEditorPanel({
  filePath,
  onClose,
  repoRoot,
}: MemoryEditorPanelProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GroupKey>("Project");
  const [currentPath, setCurrentPath] = useState<string>(filePath);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);

  // repo_root 解決（MemoryTreeView と同じロジック）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (repoRoot) {
        setResolvedRoot(repoRoot);
        return;
      }
      try {
        const { homeDir } = await import("@tauri-apps/api/path");
        const home = await homeDir();
        if (!cancelled) setResolvedRoot(home);
      } catch {
        if (!cancelled) setResolvedRoot(".");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  // scope ツリー取得
  const fetchTree = useCallback(async () => {
    if (!resolvedRoot) return;
    setLoading(true);
    try {
      const list = await callTauri<TreeNode[]>("scan_memory_tree", {
        repoRoot: resolvedRoot,
      });
      setNodes(list);
    } catch (e) {
      toast.error(`CLAUDE.md ツリー取得に失敗: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [resolvedRoot]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  // グループ化（Parent は Project に寄せる）
  const grouped = useMemo(() => {
    const g: Record<GroupKey, TreeNode[]> = {
      Global: [],
      Project: [],
      Cwd: [],
    };
    for (const n of nodes) {
      if (!n.isFile) continue;
      if (n.scope === "Global") g.Global.push(n);
      else if (n.scope === "Cwd") g.Cwd.push(n);
      else g.Project.push(n);
    }
    return g;
  }, [nodes]);

  // 初期タブ: filePath が属するスコープを推定
  useEffect(() => {
    const hit = nodes.find((n) => n.path === filePath);
    if (hit) {
      const scope =
        hit.scope === "Global"
          ? "Global"
          : hit.scope === "Cwd"
          ? "Cwd"
          : "Project";
      setActiveTab(scope);
    }
    setCurrentPath(filePath);
  }, [filePath, nodes]);

  // タブ切替時: 該当スコープに 1 件以上あれば先頭を表示
  const handleTabChange = useCallback(
    (key: string) => {
      const k = key as GroupKey;
      setActiveTab(k);
      const first = grouped[k][0];
      if (first) setCurrentPath(first.path);
    },
    [grouped]
  );

  // 新規作成: 該当スコープに CLAUDE.md が無い場合のみ活性化
  const handleCreate = useCallback(async () => {
    if (!resolvedRoot) return;
    setCreating(true);
    try {
      // 作成先の決定
      // - Global: ~/.claude/CLAUDE.md
      // - Project / Cwd: repoRoot 直下の CLAUDE.md
      const { join, homeDir } = await import("@tauri-apps/api/path");
      let targetPath: string;
      if (activeTab === "Global") {
        const home = await homeDir();
        const dir = await join(home, ".claude");
        await mkdir(dir, { recursive: true });
        targetPath = await join(dir, "CLAUDE.md");
      } else {
        // Project / Cwd は repoRoot 直下に作成
        targetPath = await join(resolvedRoot, "CLAUDE.md");
      }

      await writeTextFile(targetPath, "# CLAUDE.md\n\n");
      toast.success("CLAUDE.md を作成しました");
      setCurrentPath(targetPath);
      await fetchTree();
    } catch (e) {
      toast.error(`作成に失敗しました: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  }, [activeTab, fetchTree, resolvedRoot]);

  const currentScopeItems = grouped[activeTab];
  const canCreate = currentScopeItems.length === 0;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onClose}
        >
          <ChevronLeft className="h-3 w-3" aria-hidden />
          ツリーに戻る
        </Button>
        {canCreate && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void handleCreate()}
            disabled={creating}
            aria-label="新規 CLAUDE.md を作成"
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <FilePlus2 className="h-3 w-3" aria-hidden />
            )}
            新規作成
          </Button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="h-8 justify-start">
          {(Object.keys(GROUP_LABEL) as GroupKey[]).map((key) => (
            <TabsTrigger key={key} value={key} className="h-6 px-2 text-xs">
              {GROUP_LABEL[key]}
              <span className="ml-1 text-[10px] text-muted-foreground">
                {grouped[key].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(GROUP_LABEL) as GroupKey[]).map((key) => (
          <TabsContent
            key={key}
            value={key}
            className="mt-2 flex min-h-0 flex-1 flex-col gap-2"
          >
            <p className="text-[11px] text-muted-foreground">
              {GROUP_DESCRIPTION[key]}
            </p>

            {/* 複数候補がある場合の selector（MemoryTreeView の Parent + Project 統合で発生） */}
            {grouped[key].length > 1 && key === activeTab && (
              <select
                value={currentPath}
                onChange={(e) => setCurrentPath(e.target.value)}
                className={cn(
                  "w-full rounded border border-input bg-background px-2 py-1 text-xs",
                  "focus:outline-none focus:ring-2 focus:ring-ring"
                )}
                aria-label="編集対象の CLAUDE.md を選択"
              >
                {grouped[key].map((n) => (
                  <option key={n.path} value={n.path}>
                    {n.label}
                  </option>
                ))}
              </select>
            )}

            {/* 該当スコープに何も無い場合 */}
            {grouped[key].length === 0 && key === activeTab && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <>
                    <p>このスコープには CLAUDE.md がありません</p>
                    <p className="text-[10px]">
                      右上の「新規作成」から作成できます
                    </p>
                  </>
                )}
              </div>
            )}

            {/* エディタ本体（activeTab かつ currentPath が存在する場合のみ描画） */}
            {key === activeTab &&
              currentPath &&
              grouped[key].some((n) => n.path === currentPath) && (
                <div className="min-h-0 flex-1">
                  <MemoryEditor
                    filePath={currentPath}
                    onClose={onClose}
                    headerSlot={
                      <p className="text-xs font-semibold">
                        {GROUP_LABEL[key]} スコープ
                      </p>
                    }
                  />
                </div>
              )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
