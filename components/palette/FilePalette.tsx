"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { File, Folder, FileCode2, FileJson, FileText } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditorStore } from "@/lib/stores/editor";
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import {
  fetchFiles,
  rankFuzzy,
  type FileEntry,
  type ScoredFileEntry,
} from "@/lib/file-completion";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

/**
 * PM-948 (PRJ-012 v1.2): File Picker Palette（Ctrl+P / Cmd+P で起動）。
 *
 * VSCode / Cursor の Quick Open 相当。Active project 配下のファイルを fuzzy search
 * で検索し、Enter or click で Monaco エディタのタブで open する。
 *
 * ## 他 Palette との差別化
 *
 * | Palette | Hotkey | 対象 | 主用途 |
 * |---|---|---|---|
 * | CommandPalette | Ctrl+K | slash / 操作 | セッション新規・テーマ切替 |
 * | SearchPalette  | Ctrl+Shift+F | 過去の会話 | FTS5 snippet ジャンプ |
 * | **FilePalette** | **Ctrl+P** | **project files** | **エディタで開く** |
 *
 * ## 実装
 *
 * - Rust `list_project_files` (PRJ-012 v3.4 Chunk B / AtMentionPicker と共有) を
 *   呼出し、`.gitignore` / `node_modules` / `.git` / `target` / `dist` / `.next` を
 *   除外した project ファイル一覧を取得する
 * - 一覧は `lib/file-completion.ts::fetchFiles` に LRU+TTL (10s / 64 entries) で
 *   キャッシュされているため、AtMentionPicker で warm up 済なら invoke 不要
 * - 同 `rankFuzzy` で fuzzy scoring (完全一致 > prefix > substring > subsequence)
 * - 選択時: `useEditorStore.openFile(absPath)` で Monaco タブに open
 *   (activeEditorPaneId に追加 — 分割中なら active pane、通常は main pane)
 *
 * ## パフォーマンス見通し
 *
 * Rust `list_project_files` は `ignore::WalkBuilder` + blocking thread で default
 * 500 件打切り。10,000 files 超の project でも初回 ~500ms 程度、以降は cache hit
 * で即応。打切りは v1.2 時点では UI 上の注意喚起なし（default limit 500 で通常
 * 用途は十分）。
 *
 * ## a11y
 *
 * - Dialog title / description は sr-only
 * - Escape で close（Radix 標準）
 * - ↑↓ Enter で list navigation（cmdk 標準）
 */
export interface FilePaletteProps {
  /** 親が state で open を制御する（CommandPalette から起動するケース想定）。未指定時は内部 state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * 1 ファイル候補の icon 選択。AtMentionPicker と同じ軽量判定ロジック。
 */
function pickIcon(entry: FileEntry): React.ReactNode {
  if (entry.isDirectory) {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />;
  }
  const lower = entry.name.toLowerCase();
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx")
  ) {
    return (
      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-hidden />
    );
  }
  if (
    lower.endsWith(".json") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  ) {
    return (
      <FileJson className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
    );
  }
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".mdx") ||
    lower.endsWith(".txt")
  ) {
    return (
      <FileText
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
    );
  }
  return (
    <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
  );
}

/**
 * 指定 index 集合に従って文字列を <mark> でハイライト分解する。
 * AtMentionPicker の highlight() と同じ形式（primary-20 bg + primary 文字色）。
 */
function highlight(text: string, indices: number[]): React.ReactNode {
  if (indices.length === 0) return text;
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let buf = "";
  let bufMark = false;
  const flush = (keyHint: string) => {
    if (buf.length === 0) return;
    out.push(
      bufMark ? (
        <mark
          key={keyHint}
          className="rounded bg-primary/20 px-0.5 text-primary"
        >
          {buf}
        </mark>
      ) : (
        <span key={keyHint}>{buf}</span>
      )
    );
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isMark = set.has(i);
    if (isMark === bufMark) {
      buf += text[i];
    } else {
      flush(`p-${i}-${out.length}`);
      buf = text[i];
      bufMark = isMark;
    }
  }
  flush(`p-end-${out.length}`);
  return <>{out}</>;
}

export function FilePalette({ open: controlledOpen, onOpenChange }: FilePaletteProps = {}) {
  // controlled / uncontrolled 両対応。親が open を渡すなら controlled、なければ
  // 内部 state（Ctrl+P で toggle）。
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  const [query, setQuery] = useState("");
  const [rawEntries, setRawEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const projectPath = useMemo(
    () => findProjectById(projects, activeProjectId)?.path ?? null,
    [projects, activeProjectId]
  );

  const openFile = useEditorStore((s) => s.openFile);

  // mod+p で toggle。AtMentionPicker や IME composition 中も発火する必要があるため
  // enableOnFormTags / enableOnContentEditable を true に。
  //
  // 注意: ブラウザ（Chrome / Edge / Firefox）では Ctrl+P は印刷ダイアログを出す
  // ブラウザ標準ショートカット。Tauri webview でも同じ。`e.preventDefault()` で
  // 抑止する必要がある。react-hotkeys-hook は preventDefault を自動実行しないので
  // 明示呼び出し。
  useHotkeys(
    "mod+p",
    (e) => {
      e.preventDefault();
      setOpen(!open);
    },
    { enableOnFormTags: true, enableOnContentEditable: true, preventDefault: true },
    [open]
  );

  // open が閉じられたら state reset（次回 open 時に前回 query が残らないよう）
  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
    }
  }, [open]);

  // open 中 + projectPath 確定時に file list を fetch（cache hit なら即応）。
  // AtMentionPicker と同じ LRU+TTL cache を共有するため、同一 project で既に
  // warm されていれば 1ms 以下で完了する。
  const lastFetchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !projectPath) return;
    // query に依らず全件（or 先頭 500）を取って frontend で fuzzy。
    // Rust 側の粗い substring filter は使わず empty query で invoke し、
    // fuzzyScore で最終順位を出す（subsequence match も欲しいため）。
    const key = `${projectPath}\u0000`;
    if (lastFetchKeyRef.current === key && rawEntries.length > 0) return;
    lastFetchKeyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFiles(projectPath, "", 500)
      .then((list) => {
        if (cancelled) return;
        // FilePalette はファイルのみ（フォルダはエディタで開けない）
        setRawEntries(list.filter((e) => !e.isDirectory));
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        logger.warn("[FilePalette] list_project_files failed:", msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, rawEntries.length]);

  // project 切替時に rawEntries を破棄（次回 open 時に再 fetch）
  useEffect(() => {
    setRawEntries([]);
    lastFetchKeyRef.current = null;
  }, [projectPath]);

  // fuzzy ranking。空 query 時は全件を弱スコアで alphabetical 表示。
  const ranked: ScoredFileEntry[] = useMemo(() => {
    if (rawEntries.length === 0) return [];
    return rankFuzzy(rawEntries, query, 50);
  }, [rawEntries, query]);

  const handleSelect = async (entry: ScoredFileEntry) => {
    setOpen(false);
    try {
      // absPath は Rust 側で OS-native separator のまま返ってくる。
      // editor.openFile は Tauri plugin-fs::readTextFile を呼ぶため absolute 必須。
      await openFile(entry.absPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`ファイルを開けませんでした: ${msg}`);
      logger.warn("[FilePalette] openFile failed:", entry.absPath, msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-[600px]"
        aria-label="ファイルを開く"
      >
        <DialogTitle className="sr-only">ファイルを開く</DialogTitle>
        <DialogDescription className="sr-only">
          ⌘P / Ctrl+P でプロジェクト内のファイルを fuzzy 検索して開きます。
        </DialogDescription>
        <Command
          loop
          // cmdk 内蔵 filter は使わない（fuzzyScore で最終順位付け済）
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            placeholder={
              projectPath
                ? "ファイル名 (例: Shell.tsx)"
                : "プロジェクトを選択してください"
            }
            value={query}
            onValueChange={setQuery}
            autoFocus
            disabled={!projectPath}
          />
          <CommandList className="max-h-[420px]">
            {!projectPath && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                プロジェクトが選択されていません。左のレールから選択してください。
              </div>
            )}
            {projectPath && loading && rawEntries.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                ファイルを読み込み中...
              </div>
            )}
            {projectPath && error && (
              <div className="px-3 py-8 text-center text-xs text-destructive">
                {error}
              </div>
            )}
            {projectPath && !loading && !error && rawEntries.length > 0 && (
              <>
                <CommandEmpty>一致するファイルがありません</CommandEmpty>
                {ranked.length > 0 && (
                  <CommandGroup
                    heading={
                      query
                        ? `${ranked.length} 件 (fuzzy match)`
                        : `${ranked.length} 件`
                    }
                  >
                    {ranked.map((entry) => (
                      <FileRow
                        key={entry.path}
                        entry={entry}
                        onSelect={() => handleSelect(entry)}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function FileRow({
  entry,
  onSelect,
}: {
  entry: ScoredFileEntry;
  onSelect: () => void;
}) {
  // path = "a/b/c.tsx" → dirname "a/b" + basename "c.tsx"
  const lastSlash = entry.path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? entry.path.slice(0, lastSlash) : "";
  const base = lastSlash >= 0 ? entry.path.slice(lastSlash + 1) : entry.path;

  // matchIndices は path 全体に対する index。basename / dirname それぞれに
  // 分配して highlight する。
  const baseIndices: number[] = [];
  const dirIndices: number[] = [];
  const baseStart = lastSlash + 1;
  for (const idx of entry.matchIndices) {
    if (idx >= baseStart) baseIndices.push(idx - baseStart);
    else dirIndices.push(idx);
  }

  return (
    <CommandItem
      value={entry.path}
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
      )}
    >
      {pickIcon(entry)}
      <span className="truncate text-sm text-foreground">
        {highlight(base, baseIndices)}
      </span>
      {dir && (
        <span className="ml-auto truncate text-[11px] text-muted-foreground">
          {highlight(dir, dirIndices)}
        </span>
      )}
    </CommandItem>
  );
}
