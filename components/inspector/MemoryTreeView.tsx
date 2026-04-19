"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { watchImmediate, type UnwatchFn } from "@tauri-apps/plugin-fs";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FilePreviewDialog } from "@/components/sidebar/FilePreviewDialog";
import { callTauri } from "@/lib/tauri-api";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/types";

/**
 * Week 6 Chunk 3 / PM-205: CLAUDE.md ツリービュー。
 *
 * ## 仕様
 * - Rust `scan_memory_tree(repo_root)` を呼び、Global / Parent / Project / Cwd
 *   の 4 スコープ（実体は 3 グループ、Parent は Project に折込表示）で折畳。
 * - 各スコープは手製の accordion（shadcn Accordion は未導入）で開閉制御。
 *   デフォルトで Project を開く。
 * - ノードは `FileText` + 相対パス（既に backend で `label` 化済）をクリックで
 *   `FilePreviewDialog`（Chunk 2 の実装）を開く。
 * - 自動リロード: 3 スコープの CLAUDE.md パスに `watchImmediate` を張る。
 *   watch セットアップに失敗した場合は 5 秒 polling に fallback。
 *
 * ## repo_root の決定
 * `scan_memory_tree` は引数 `repo_root: String` を要求する。Week 6 時点では
 * `cwd` が確定していないため、暫定で `invoke("plugin:path|resolve_directory",
 * { directory: "Home" })` → ホームディレクトリを `repo_root` として渡す。
 * M3 PM-203 の ProjectSwitcher が active project path を state で公開したら、
 * そこに切替える（TODO コメント参照）。
 */

interface MemoryTreeViewProps {
  /** 外部から渡す repo_root（未指定なら process.cwd 的な fallback を使う） */
  repoRoot?: string;
  className?: string;
}

type GroupKey = "Global" | "Project" | "Cwd";

const GROUP_LABEL: Record<GroupKey, string> = {
  Global: "グローバル (~/.claude)",
  Project: "プロジェクト (含 Parent)",
  Cwd: "カレント (cwd)",
};

export function MemoryTreeView({ repoRoot, className }: MemoryTreeViewProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    Global: false,
    Project: true,
    Cwd: false,
  });

  // repo_root を resolve（優先度: props > ホーム）。
  // `@tauri-apps/api/path` は現状 util 層に明示 import が無いため、ここで
  // dynamic import し、失敗時は "." を渡す（cwd 相当になる）。
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (repoRoot) {
        setResolvedRoot(repoRoot);
        return;
      }
      try {
        // Tauri 2: `@tauri-apps/api/path` の `homeDir()` を使う
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

  const fetchTree = useCallback(async () => {
    if (!resolvedRoot) return;
    setLoading(true);
    setError(null);
    try {
      const list = await callTauri<TreeNode[]>("scan_memory_tree", {
        repoRoot: resolvedRoot,
      });
      setNodes(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [resolvedRoot]);

  // 初回 / resolvedRoot 変更で 1 回 fetch
  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  // --- 自動リロード: watchImmediate（失敗時 5 秒 polling にフォールバック）---
  //
  // NOTE: 候補パスの集合を stringify してキーにすることで、watch 再セットアップを
  //       「ファイル集合が変わった時のみ」に限定する（fetch→setNodes の度に
  //       unwatch/rewatch が走るのを防ぐ）。
  const unwatchRef = useRef<UnwatchFn | null>(null);
  const candidatesKey = useMemo(
    () =>
      nodes
        .filter((n) => n.isFile)
        .map((n) => n.path)
        .sort()
        .join("|"),
    [nodes]
  );
  useEffect(() => {
    if (!resolvedRoot) return;
    let cancelled = false;

    const candidates = candidatesKey.length > 0 ? candidatesKey.split("|") : [];

    async function startWatch() {
      if (candidates.length === 0) return;
      try {
        const unwatch = await watchImmediate(
          candidates,
          () => {
            // どんな WatchEvent が来ても再 fetch で確実に同期する。
            // 種別（modify / create / remove / any）による分岐は不要。
            if (!cancelled) void fetchTree();
          },
          { recursive: false }
        );
        if (cancelled) {
          unwatch();
        } else {
          unwatchRef.current = unwatch;
        }
      } catch {
        // watch が張れない環境（パスが存在しない等）は polling fallback に委ねる
      }
    }

    void startWatch();
    // polling fallback（watch が無くても最低 5 秒間隔で整合を取る）
    const pollId = window.setInterval(() => {
      if (!cancelled) void fetchTree();
    }, 5000);

    return () => {
      cancelled = true;
      const unwatch = unwatchRef.current;
      unwatchRef.current = null;
      if (unwatch) {
        try {
          unwatch();
        } catch {
          /* noop */
        }
      }
      window.clearInterval(pollId);
    };
    // candidatesKey で watch 対象の集合変化を検知（fetch 毎の再セットアップ防止）
  }, [resolvedRoot, candidatesKey, fetchTree]);

  // --- グループ化（Parent は Project に寄せる）---
  const grouped = useMemo(() => {
    const g: Record<GroupKey, TreeNode[]> = {
      Global: [],
      Project: [],
      Cwd: [],
    };
    for (const n of nodes) {
      if (n.scope === "Global") g.Global.push(n);
      else if (n.scope === "Cwd") g.Cwd.push(n);
      else g.Project.push(n); // Project + Parent
    }
    return g;
  }, [nodes]);

  const toggleGroup = useCallback((k: GroupKey) => {
    setOpenGroups((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  return (
    <div className={cn("flex flex-col gap-2 text-sm", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FolderTree className="h-3.5 w-3.5" aria-hidden />
          CLAUDE.md ツリー
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          onClick={() => void fetchTree()}
          disabled={loading}
          aria-label="ツリーを再取得"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          取得に失敗しました: {error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {(Object.keys(GROUP_LABEL) as GroupKey[]).map((key) => {
          const items = grouped[key];
          const isOpen = openGroups[key];
          return (
            <div key={key} className="rounded border border-border/50">
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium hover:bg-muted/40"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-1.5">
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  )}
                  {GROUP_LABEL[key]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {items.length}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border/30 p-1">
                  {items.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                      CLAUDE.md なし
                    </div>
                  ) : (
                    <ul className="flex flex-col">
                      {items.map((n) => (
                        <li key={n.path}>
                          <button
                            type="button"
                            onClick={() => setPreviewPath(n.path)}
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/50"
                            style={{ paddingLeft: `${8 + n.depth * 10}px` }}
                            title={n.path}
                          >
                            <FileText
                              className="h-3 w-3 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="truncate">{n.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <FilePreviewDialog
        filePath={previewPath}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
}
