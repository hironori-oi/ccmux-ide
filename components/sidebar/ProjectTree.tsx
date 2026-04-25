"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { useFileTreeExpandedStore } from "@/lib/stores/file-tree-expanded";
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
 *
 * ## v1.25.4 修正
 *
 * 「再読込ボタン押下で全フォルダが閉じる」不具合の **根本修正**。
 * v1.24.3 では `ReloadTickContext` + `useEffect` deps で再 fetch を起こす
 * 経路に変えたが、TreeNode の `expanded` 自体は **local `useState(false)`**
 * のままだったため、何らかの要因で TreeNode が unmount → re-mount されると
 * 初期値 `false` に戻り、結果としてオーナー環境で同不具合が再発していた。
 *
 * v1.25.4 では expanded 状態を `lib/stores/file-tree-expanded.ts` の
 * **global Zustand store**（`Set<string>` で path 集合保持）に移行し、
 * re-mount しても state が維持されるようにする。さらに再 fetch 中も
 * 既存 entries / children を維持してちらつきを防止。プロジェクト切替時は
 * `clearExpanded()` で展開状態を初期化する。
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

/**
 * v1.24.3: 再読込ボタン押下で TreeNode 階層が unmount され、開いている
 * フォルダの expanded state がリセットされる問題を修正。reloadKey を
 * `key={...}` で伝えて子孫を全 unmount する旧設計から、Context 経由で
 * tick 値を伝播 → 各層が useEffect deps で再 fetch を行う設計に変更。
 *
 * v1.25.4: 上記設計でも TreeNode の local `useState(false)` が
 * re-mount でリセットされる挙動が残っていたため、expanded state を
 * `useFileTreeExpandedStore` (global) に移行。Context は children 再 fetch
 * トリガとして引き続き使用する。
 */
const ReloadTickContext = createContext(0);

export function ProjectTree() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectPath =
    projects.find((p) => p.id === activeProjectId)?.path ?? null;

  const clearExpanded = useFileTreeExpandedStore((s) => s.clearExpanded);

  const [reloadKey, setReloadKey] = useState(0);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | undefined>(
    undefined
  );

  const openInEditor = useEditorStore((s) => s.openFile);

  // v1.25.4: プロジェクト切替時のみ expanded をリセット。同一プロジェクト内の
  // 再読込（reloadKey 増加）では絶対に clear しないこと（ボタン押下で全フォルダ
  // が閉じる現象の再発を防ぐ）。
  useEffect(() => {
    if (!activeProjectPath) return;
    clearExpanded();
    // activeProjectPath が変わった時のみ発火、clearExpanded は zustand action で
    // 安定参照なので deps から除外しても無害だが eslint 規約に従い同梱する。
  }, [activeProjectPath, clearExpanded]);

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
        {/* v1.24.3 / v1.25.4: reloadKey は Context で子孫に伝播し useEffect deps で
            再 fetch を起こす。key には activeProjectPath のみを使い、
            プロジェクト切替時のみ unmount するようにして、ボタン押下では
            expanded state（global store 側）を保持する。 */}
        <ReloadTickContext.Provider value={reloadKey}>
          <RootChildren
            key={activeProjectPath}
            path={activeProjectPath}
            onFileClick={handleFileClick}
            onFileDblClick={handleFileDblClick}
          />
        </ReloadTickContext.Provider>
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
  // v1.24.3: 再読込 tick。変化で entries を再 fetch するが entries 配列は
  // 既存表示を維持しながら裏で差し替えるため、TreeNode の expanded state は
  // 影響を受けない（global store 側で維持）。
  const reloadTick = useContext(ReloadTickContext);

  useEffect(() => {
    let cancelled = false;
    // v1.25.4: 再 fetch 中もちらつき防止のため既存 entries は保持する。
    // ただし初回 mount（entries === null）時のみ loading skeleton を出す。
    setLoading((prev) => (entries === null ? true : prev));
    setError(null);
    (async () => {
      try {
        const built = await loadDirEntries(path);
        if (!cancelled) {
          setEntries(built);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // entries は意図的に deps から除外（fetch 自身が entries を更新するため、
    // 含めると無限ループになる）。再 fetch トリガは path / reloadTick の変化のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadTick]);

  if (loading && entries === null) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        読込中…
      </div>
    );
  }
  if (error && entries === null) {
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
  // v1.25.4: 旧 `useState(false)` を撤去し、global store の `Set<path>` から
  // 展開状態を読む。re-mount しても store 側で状態が維持されるため、再読込
  // ボタン押下で TreeNode が一瞬でも unmount → re-mount される経路でも
  // expanded が失われない。
  const expanded = useFileTreeExpandedStore((s) => s.expandedPaths.has(entry.path));
  const toggleExpanded = useFileTreeExpandedStore((s) => s.toggleExpanded);

  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v3.4.6 修正: 再入・二重 fetch を ref で制御（useEffect deps から children/loading を
  // 除去し、state update で effect が re-run される loop を断つ）。
  const fetchedRef = useRef(false);
  // v1.24.3: 再読込 tick。変化で expanded 中のディレクトリは children を再 fetch
  // するが、expanded state は store 側で維持されるため UI の展開状態は保持される。
  const reloadTick = useContext(ReloadTickContext);

  useEffect(() => {
    if (!entry.isDirectory) return;
    if (!expanded) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    // v1.25.4: 既存 children があれば保持してちらつき防止、
    // 初回展開（children === null）時のみ loading を立てる。
    setLoading(children === null);
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
    // children は意図的に deps から除外（loading 判定用にしか参照しないため、
    // fetch 自身の setChildren で effect が re-run されるのを防ぐ）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, entry.isDirectory, entry.path, entry.name]);

  // v1.24.3 / v1.25.4: 再読込 tick が変わったら fetchedRef をリセットして次の
  // expanded（or 既に expanded 中）で再 fetch を発動させる。expanded state
  // 自体は store 側で維持されるためここでは触れない。
  useEffect(() => {
    if (!entry.isDirectory) return;
    if (reloadTick === 0) return; // 初回 mount は skip
    fetchedRef.current = false;
    if (expanded) {
      // expanded 中なら即座に再 fetch をトリガするため、children を保持しつつ
      // 裏で差し替える（ちらつき防止のため setChildren(null) はしない）。
      void (async () => {
        try {
          // v1.25.4: 既存 children を消さずに loading を立てるだけ。
          setLoading(true);
          setError(null);
          fetchedRef.current = true;
          const built = await loadDirEntries(entry.path);
          setChildren(built);
        } catch (e) {
          console.error(
            `[TreeNode] reload fetch failed name=${entry.name}`,
            e,
          );
          setError(String(e));
          fetchedRef.current = false;
        } finally {
          setLoading(false);
        }
      })();
    }
    // expanded === false の場合は次回 expand 時に fresh fetch されるので何もしない
  }, [reloadTick, entry.isDirectory, entry.path, entry.name, expanded]);

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
          onClick={() => toggleExpanded(entry.path)}
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
            {/* v1.25.4: 既存 children がある時の再 fetch 中は children を表示
                したまま loading 表記を出さない（ちらつき防止）。children が
                まだ無い初回展開時のみ loading skeleton を出す。 */}
            {loading && children === null && (
              <div
                className="flex items-center gap-1.5 py-0.5 text-muted-foreground"
                style={{ paddingLeft: indent + 16 }}
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                読込中…
              </div>
            )}
            {error && children === null && (
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
