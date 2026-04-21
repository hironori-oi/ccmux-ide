"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import {
  CCMUX_FILE_PATH_MIME,
  formatFileMention,
} from "@/lib/file-drag";
import { getFileIconSpec } from "@/lib/file-icon";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { FilePreviewDialog } from "@/components/sidebar/FilePreviewDialog";
import { Button } from "@/components/ui/button";

/**
 * アクティブプロジェクトのファイルツリー（v3.4.3 汎用化 2026-04-20）。
 *
 * ## v3.4.3 改修
 * PRJ-XXX 特化の固定ファイル表示（brief/decisions/progress/tasks + reports/）を
 * 廃止し、**Cursor Explorer 風の汎用ディレクトリツリー** に全面書換:
 *  - activeProject.path を root に再帰的なフォルダ/ファイルツリー
 *  - Lazy expansion（フォルダ展開時に children 取得、大規模リポでも軽快）
 *  - `IGNORED_DIRS` に node_modules / .git / target 等の定番除外
 *  - 隠しファイル（`.` 始まり）は `.env` 以外は非表示
 *  - フォルダ先 → ファイル、各グループ内は localeCompare(ja, numeric) で自然順
 *  - **ファイル click → `useEditorStore.openFile`** で Monaco エディタ open
 *  - **ファイル dblclick → FilePreviewDialog** で read-only プレビュー
 *  - 右上に再読込ボタン（ツリー全体を破棄 + 再 fetch）
 */

/** 無視するディレクトリ名（常時非表示）。 */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  ".next",
  "out",
  "build",
  "coverage",
  ".vercel",
  ".turbo",
  ".cache",
  ".DS_Store",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);

/** 画像として click 時に直接プレビュー表示する拡張子（v3.4.6 追加）。 */
const IMAGE_EXTS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
]);

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

/** `.` 始まりのうち例外的に表示するもの。 */
const DOT_WHITELIST: ReadonlySet<string> = new Set([
  ".env",
  ".env.local",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".claude",
  ".cursorrules",
]);

interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function shouldDisplay(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return false;
  if (name.startsWith(".")) return DOT_WHITELIST.has(name);
  return true;
}

/**
 * Rust `list_dir_children` の返却型（camelCase）。
 */
interface DirChild {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * 指定フォルダの直下エントリを取得する。
 *
 * v3.4.5 hot-fix（2026-04-20）: `tauri-plugin-fs` の `readDir` が Windows 絶対パス
 * + 大量フォルダで hang する事象を回避するため、std::fs 版の Rust command
 * `list_dir_children` を直接 invoke する方式に切替。
 */
async function loadDirEntries(parentPath: string): Promise<Entry[]> {
  // v3.4.6 debug: invoke の発火 / 結果 / エラーをコンソールに記録する。
  // PM-746 (2026-04-20): production gate のため console.log → logger.debug へ移行。
  // console.error は本番でも残す方針のため素のまま残置。
  logger.debug("[ProjectTree] invoke list_dir_children", { path: parentPath });
  const t0 = performance.now();
  let raw: DirChild[];
  try {
    raw = await invoke<DirChild[]>("list_dir_children", {
      path: parentPath,
    });
    const dt = Math.round(performance.now() - t0);
    logger.debug(
      `[ProjectTree] list_dir_children ok: ${raw.length} entries in ${dt}ms`,
      { path: parentPath }
    );
  } catch (e) {
    const dt = Math.round(performance.now() - t0);
    console.error(
      `[ProjectTree] list_dir_children FAILED after ${dt}ms`,
      { path: parentPath, error: e }
    );
    throw e;
  }
  const entries: Entry[] = [];
  for (const e of raw) {
    if (!shouldDisplay(e.name)) continue;
    entries.push({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
    });
  }
  // フォルダ先、各グループ内はアルファベット + 数値自然順（日本語対応）
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });
  return entries;
}

export function ProjectTree() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath =
    projects.find((p) => p.id === activeProjectId)?.path ?? null;

  const [reloadKey, setReloadKey] = useState(0);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(
    undefined
  );

  const openInEditor = useEditorStore((s) => s.openFile);

  /**
   * v3.4.6 修正: 画像ファイルは click で直接プレビュー Dialog を開く。
   * 従来は「click でエディタ open → Monaco がバイナリをテキスト扱いして化け表示
   * → dblclick でプレビューも発火」という二重動作で UX 悪化、かつ Monaco 側の
   * 巨大バイナリ処理で UI が一時フリーズする問題があった。
   *
   * - 画像（png/jpg/... 9 種）: click → 直接プレビュー
   * - それ以外のファイル: click → Monaco エディタで open
   * - すべてのファイル: dblclick → 従来通りプレビュー（既存 UX 互換）
   */
  const handleFileClick = useCallback(
    (path: string, name: string) => {
      if (isImagePath(path)) {
        setPreviewPath(path);
        setPreviewLabel(name);
        return;
      }
      void openInEditor(path);
    },
    [openInEditor]
  );

  const handleFileDblClick = useCallback((path: string, name: string) => {
    setPreviewPath(path);
    setPreviewLabel(name);
  }, []);

  if (!activeProjectPath) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        プロジェクトを選択するとファイルが表示されます
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ヘッダ: 再読込ボタン */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b px-2">
        <span
          className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          title={activeProjectPath}
        >
          ファイル
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => setReloadKey((k) => k + 1)}
          aria-label="ファイルツリーを再読込"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {/* ツリー本体 */}
      <div
        className="flex-1 overflow-y-auto py-1 text-xs"
        role="tree"
        aria-label="プロジェクトファイル"
      >
        <RootChildren
          key={`${activeProjectPath}:${reloadKey}`}
          path={activeProjectPath}
          onFileClick={handleFileClick}
          onFileDblClick={handleFileDblClick}
        />
      </div>

      {/*
       * dblclick プレビュー（既存 FilePreviewDialog）。
       * signature: `filePath` が `null` で閉状態、閉じは `onClose` で通知。
       * `open` / `onOpenChange` は受け取らない設計。
       */}
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

/**
 * root 配下を描画する専用コンポーネント。root 自身の行は出さず children のみ。
 */
function RootChildren({
  path,
  onFileClick,
  onFileDblClick,
}: {
  path: string;
  onFileClick: (path: string, name: string) => void;
  onFileDblClick: (path: string, name: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries(null);
    (async () => {
      try {
        const built = await loadDirEntries(path);
        if (!cancelled) setEntries(built);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        読込中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-2 py-1 text-destructive">
        エラー: {error}
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return (
      <div className="px-2 py-1 text-muted-foreground">
        （表示できるファイルがありません）
      </div>
    );
  }
  return (
    <>
      {entries.map((e) => (
        <TreeNode
          key={e.path}
          entry={e}
          depth={0}
          onFileClick={onFileClick}
          onFileDblClick={onFileDblClick}
        />
      ))}
    </>
  );
}

function TreeNode({
  entry,
  depth,
  onFileClick,
  onFileDblClick,
}: {
  entry: Entry;
  depth: number;
  onFileClick: (path: string, name: string) => void;
  onFileDblClick: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v3.4.6 修正: 再入・二重 fetch を ref で制御（useEffect deps から children/loading を
  // 除去し、state update で effect が re-run される loop を断つ）。
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!entry.isDirectory) return;
    if (!expanded) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const built = await loadDirEntries(entry.path);
        if (cancelled) return;
        // PM-746: dogfood debug は logger.debug へ移行 (本番 silent)。
        logger.debug(
          `[TreeNode] setChildren name=${entry.name} count=${built.length}`
        );
        setChildren(built);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error(`[TreeNode] fetch failed name=${entry.name}`, e);
        setError(String(e));
        setLoading(false);
        // エラー時は再試行できるよう ref をリセット
        fetchedRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, entry.isDirectory, entry.path, entry.name]);

  // v3.4.6 debug: render 時の state を可視化（dogfood 後に削除）。
  // PM-746: production では logger.debug が silent。
  if (entry.isDirectory && expanded) {
    logger.debug(
      `[TreeNode render] name=${entry.name} loading=${loading} childrenLen=${children?.length ?? "null"} error=${error ?? "none"}`
    );
  }

  const indent = depth * 12 + 4;

  if (entry.isDirectory) {
    return (
      <div role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(CCMUX_FILE_PATH_MIME, entry.path);
            e.dataTransfer.setData(
              "text/plain",
              formatFileMention(entry.path)
            );
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-accent/60"
          style={{ paddingLeft: indent }}
          aria-label={`${entry.name} フォルダ`}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && (
          <div role="group">
            {loading && (
              <div
                className="flex items-center gap-1.5 py-0.5 text-muted-foreground"
                style={{ paddingLeft: indent + 16 }}
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                読込中…
              </div>
            )}
            {error && (
              <div
                className="py-0.5 text-destructive"
                style={{ paddingLeft: indent + 16 }}
              >
                エラー: {error}
              </div>
            )}
            {children?.map((c) => (
              <TreeNode
                key={c.path}
                entry={c}
                depth={depth + 1}
                onFileClick={onFileClick}
                onFileDblClick={onFileDblClick}
              />
            ))}
            {children && children.length === 0 && !loading && !error && (
              <div
                className="py-0.5 text-muted-foreground"
                style={{ paddingLeft: indent + 16 }}
              >
                （空フォルダ）
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ファイル: click でエディタ open or（画像なら）プレビュー、dblclick で preview
  // v3.4.8: button → div 化（WebView2 で button + draggable が効かない環境対策）
  return (
    <div
      role="treeitem"
      tabIndex={0}
      draggable="true"
      onDragStart={(e) => {
        // PM-746: drag 可視化は dev のみで十分。
        logger.debug("[drag] start file", entry.path);
        e.dataTransfer.setData(CCMUX_FILE_PATH_MIME, entry.path);
        e.dataTransfer.setData("text/plain", formatFileMention(entry.path));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onFileClick(entry.path, entry.name)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFileClick(entry.path, entry.name);
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        onFileDblClick(entry.path, entry.name);
      }}
      className={cn(
        "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-muted-foreground hover:bg-accent/60 hover:text-foreground focus:bg-accent/80 focus:outline-none"
      )}
      style={{ paddingLeft: indent + 16, cursor: "grab" }}
      title={entry.path}
    >
      {(() => {
        // v3.5.4: 拡張子別の言語アイコン + 色
        const spec = getFileIconSpec(entry.name);
        const IconC = spec.Icon;
        return (
          <IconC
            className={cn("h-3.5 w-3.5 shrink-0", spec.colorClass)}
            aria-hidden
          />
        );
      })()}
      <span className="truncate text-foreground/90">{entry.name}</span>
    </div>
  );
}
