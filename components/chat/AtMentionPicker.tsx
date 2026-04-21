"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { File, Folder, FileText, FileCode2, FileJson } from "lucide-react";

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useProjectStore, findProjectById } from "@/lib/stores/project";
import {
  fetchFiles,
  rankFuzzy,
  type FileEntry,
  type ScoredFileEntry,
} from "@/lib/file-completion";
import { cn } from "@/lib/utils";

/**
 * `@file` / `@folder` mention picker (PRJ-012 v3.4 / Chunk B / DEC-034 Must 2)。
 *
 * InputArea で `@` 入力を検出したときに popover 表示し、activeProject.path
 * 配下のファイル / フォルダ候補を fuzzy match して列挙する。選択で
 * `@"<selected-path>"` が textarea の該当箇所に挿入される（挿入ロジックは
 * InputArea 側）。
 *
 * ## UX
 *
 * - 上部 toggle で `all` / `files` / `folders` を切り替え（既定 all）
 * - リストは top 20、fuzzy scoring 降順。ハイライトは matchIndices 使用
 * - ↑↓ Enter / クリックで onSelect、Esc / 外クリックで onOpenChange(false)
 * - SlashPalette と同じく cmdk 基盤。`shouldFilter={false}` で Rust/fuzzy を優先
 */
export interface AtMentionPickerProps {
  /** popover の open / close */
  open: boolean;
  /** close 要求（Esc / 外クリック / 選択後） */
  onOpenChange: (open: boolean) => void;
  /** `@` 以降のクエリ（例: `@pro` なら "pro"） */
  query: string;
  /** 選択時のコールバック。project_root からの相対パスを渡す */
  onSelect: (path: string, entry: FileEntry) => void;
  /** Popover の anchor（InputArea の textarea ラッパー要素）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anchorRef: React.RefObject<any>;
}

type FilterMode = "all" | "files" | "folders";

/**
 * ファイル拡張子から icon を選ぶ軽量判定。lucide の有限セットで色分け代わり。
 */
function pickIcon(entry: FileEntry): React.ReactNode {
  if (entry.isDirectory) {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />;
  }
  const lower = entry.name.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-hidden />;
  }
  if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return <FileJson className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />;
  }
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt")) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * matchIndices 位置を <mark> で強調した JSX 断片を生成する。
 *
 * matchIndices は昇順の 0-indexed、path 上の位置集合。
 */
function highlight(path: string, indices: number[]): React.ReactNode {
  if (indices.length === 0) return path;
  const set = new Set(indices);
  const parts: React.ReactNode[] = [];
  let buf = "";
  let bufMark = false;
  for (let i = 0; i < path.length; i++) {
    const isMark = set.has(i);
    if (isMark === bufMark) {
      buf += path[i];
    } else {
      if (buf.length > 0) {
        parts.push(
          bufMark ? (
            <mark
              key={`m-${i}-${parts.length}`}
              className="rounded bg-primary/20 px-0.5 text-primary"
            >
              {buf}
            </mark>
          ) : (
            <span key={`s-${i}-${parts.length}`}>{buf}</span>
          )
        );
      }
      buf = path[i];
      bufMark = isMark;
    }
  }
  if (buf.length > 0) {
    parts.push(
      bufMark ? (
        <mark
          key={`m-end-${parts.length}`}
          className="rounded bg-primary/20 px-0.5 text-primary"
        >
          {buf}
        </mark>
      ) : (
        <span key={`s-end-${parts.length}`}>{buf}</span>
      )
    );
  }
  return <>{parts}</>;
}

export function AtMentionPicker({
  open,
  onOpenChange,
  query,
  onSelect,
  anchorRef,
}: AtMentionPickerProps) {
  const [rawEntries, setRawEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FilterMode>("all");

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const projectPath = useMemo(
    () => findProjectById(projects, activeProjectId)?.path ?? null,
    [projects, activeProjectId]
  );

  // 直近 fetch の dedup（同じ projectPath+query を 2 回連続で呼ばない）。
  // fetchFiles 内に LRU+TTL cache があるのでここは単なる effect guard。
  const lastFetchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !projectPath) return;
    const key = `${projectPath}\u0000${query}`;
    if (lastFetchKeyRef.current === key) return;
    lastFetchKeyRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFiles(projectPath, query, 500)
      .then((list) => {
        if (cancelled) return;
        setRawEntries(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, query]);

  // query 変化時の fuzzy scoring + filter mode
  const ranked: ScoredFileEntry[] = useMemo(() => {
    const base = rankFuzzy(rawEntries, query, 50);
    const filtered =
      mode === "files"
        ? base.filter((e) => !e.isDirectory)
        : mode === "folders"
          ? base.filter((e) => e.isDirectory)
          : base;
    return filtered.slice(0, 20);
  }, [rawEntries, query, mode]);

  // open が false になったら次回 open 時に再 fetch するよう key reset
  useEffect(() => {
    if (!open) lastFetchKeyRef.current = null;
  }, [open]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => {
          // textarea にフォーカスを残す
          e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        className="w-[460px] max-w-[90vw] overflow-hidden p-0"
        aria-label="ファイル / フォルダ候補"
      >
        <div className="flex items-center gap-1 border-b px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">絞り込み:</span>
          <FilterToggle mode={mode} setMode={setMode} />
          <span className="ml-auto truncate text-muted-foreground">
            {projectPath ? "@" + (query || "") : "プロジェクト未選択"}
          </span>
        </div>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2"
        >
          <CommandList className="max-h-[340px]">
            {!projectPath && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                プロジェクトが選択されていません。
              </div>
            )}
            {projectPath && loading && rawEntries.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                読込中...
              </div>
            )}
            {projectPath && error && (
              <div className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </div>
            )}
            {projectPath && !loading && !error && ranked.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                一致するファイルはありません
              </div>
            )}
            {projectPath && ranked.length > 0 && (
              <CommandGroup
                heading={
                  query
                    ? `候補（${ranked.length} 件、fuzzy match）`
                    : `候補（${ranked.length} 件）`
                }
              >
                {ranked.map((e) => (
                  <MentionRow
                    key={`${e.isDirectory ? "d" : "f"}:${e.path}`}
                    entry={e}
                    onSelect={() => {
                      onSelect(e.path, e);
                      onOpenChange(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FilterToggle({
  mode,
  setMode,
}: {
  mode: FilterMode;
  setMode: (m: FilterMode) => void;
}) {
  const opts: { id: FilterMode; label: string }[] = [
    { id: "all", label: "全て" },
    { id: "files", label: "ファイル" },
    { id: "folders", label: "フォルダ" },
  ];
  return (
    <div
      role="tablist"
      aria-label="候補の種類"
      className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/30 p-0.5"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={mode === o.id}
          onClick={(ev) => {
            ev.preventDefault();
            setMode(o.id);
          }}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] transition-colors",
            mode === o.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/60"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MentionRow({
  entry,
  onSelect,
}: {
  entry: ScoredFileEntry;
  onSelect: () => void;
}) {
  // cmdk internal filter は無効化しているので value は一意性のみ確保
  const cmdkValue = `${entry.isDirectory ? "dir" : "file"}:${entry.path}`;

  // path の basename 部分（末尾要素）を強調の軸にしつつ full path も表示する
  const lastSlash = entry.path.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? entry.path.slice(0, lastSlash + 1) : "";

  return (
    <CommandItem
      value={cmdkValue}
      onSelect={onSelect}
      className="items-center gap-2 py-1.5"
    >
      {pickIcon(entry)}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-xs">
          {highlight(entry.path, entry.matchIndices)}
        </span>
        {dirPart && (
          <span className="truncate text-[10px] text-muted-foreground">
            {entry.isDirectory ? "フォルダ" : "ファイル"}
            {!entry.isDirectory && entry.sizeBytes > 0
              ? ` · ${formatSize(entry.sizeBytes)}`
              : ""}
          </span>
        )}
      </div>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
        ↵
      </span>
    </CommandItem>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
