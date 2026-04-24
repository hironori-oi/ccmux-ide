"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import {
  MessageSquare,
  Bot,
  User,
  Wrench,
  FileText,
  FileEdit,
  FilePlus,
  Terminal,
  FolderSearch,
  Search,
  Globe,
  Sparkles,
} from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";
import {
  extractToolSnippetInfo,
  parseToolMessageContent,
  type ToolSnippetInfo,
} from "@/lib/tool-content-parser";

/**
 * PM-231 / PM-232: 会話検索パレット（Ctrl+Shift+F / Cmd+Shift+F）。
 *
 * Rust `search_messages` command を debounce 200ms で呼び、結果を shadcn
 * `Command` リストで表示する。結果クリックで:
 *   1. `useSessionStore.loadSession(session_id)` で SQLite から messages を復元
 *   2. `useChatStore.scrollToMessageId(message_id)` で MessageList に
 *      scrollIntoView + 4 秒ハイライトを指示
 *
 * ## 親コンポーネントとの接続
 *
 * 親（`app/(workspace)/workspace/page.tsx`）は `open` / `onOpenChange` を渡す。
 * CommandPalette の「会話を検索」項目や、このコンポーネント自身の useHotkeys
 * から開閉される。
 *
 * ## 日本語 UI
 *
 * - placeholder: 「キーワードで会話を検索...」
 * - empty: 「一致する会話がありません」
 * - loading: Skeleton 3 行
 * - アクセシビリティ: DialogTitle / Description を sr-only で提供
 */

export interface SearchResult {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
  role: string;
  /** FTS5 snippet() の出力（`[matched]` 形式、HTML ではなくプレーン文字列） */
  snippetHtml: string;
  /** Unix epoch seconds */
  createdAt: number;
}

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  user: User,
  assistant: Bot,
  tool: Wrench,
};

const ROLE_LABEL_JA: Record<string, string> = {
  user: "あなた",
  assistant: "Claude",
  tool: "ツール",
  system: "システム",
};

/**
 * PM-900: tool_use message の構造化プレビュー用アイコン / ラベル。
 * ToolUseCard の定義と一致させる（将来 tool 追加時の単一変更点にはしないが、
 * 表示揺れは最小化する）。
 */
const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Read: FileText,
  Edit: FileEdit,
  MultiEdit: FileEdit,
  Write: FilePlus,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Search,
  Task: Sparkles,
};

/** 主要 field key を UI 向けの短いラベルに変換（未知 key は key そのまま） */
const PREVIEW_KEY_LABELS_JA: Record<string, string> = {
  file_path: "file",
  path: "path",
  command: "command",
  pattern: "pattern",
  query: "query",
  url: "url",
  description: "description",
};

export function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // debounce 用の setTimeout handle。use-debounce 追加を避けて自前で管理。
  const timerRef = useRef<number | null>(null);
  // 結果の race condition 対策（古い応答が新しい応答を上書きしないように）
  const latestQueryRef = useRef("");

  // Ctrl+Shift+F / Cmd+Shift+F でトグル
  useHotkeys(
    "mod+shift+f",
    (e) => {
      e.preventDefault();
      onOpenChange(!open);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [open, onOpenChange]
  );

  // Dialog が閉じたら state をリセット（再度開いた時に前回結果が残らないよう）
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [open]);

  // 入力が変わるたびに debounce 200ms で invoke("search_messages")
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(async () => {
      latestQueryRef.current = trimmed;
      try {
        const hits = await callTauri<SearchResult[]>("search_messages", {
          query: trimmed,
          limit: 30,
        });
        // 投げた時点の query と最新 query が一致する時だけ反映（レース対策）
        if (latestQueryRef.current === trimmed) {
          setResults(hits);
          setLoading(false);
        }
      } catch (e) {
        if (latestQueryRef.current === trimmed) {
          setLoading(false);
          setResults([]);
          toast.error(
            `検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }, 200);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [query, open]);

  const handleSelect = async (r: SearchResult) => {
    onOpenChange(false);
    try {
      await useSessionStore.getState().loadSession(r.sessionId);
      // MessageList が messages を反映してから scrollIntoView するため
      // useEffect 側で追加の 120ms 待機を入れている。
      // v1.18.0 (DEC-064): scrollToMessageId は paneId を要求する。active pane に
      // 対して jump させる (SearchPalette は active pane 経由で session を開く)。
      const chat = useChatStore.getState();
      chat.scrollToMessageId(chat.activePaneId, r.messageId);
    } catch (e) {
      toast.error(
        `セッションの読込に失敗: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-[640px]"
        aria-label="会話検索"
      >
        <DialogTitle className="sr-only">会話検索</DialogTitle>
        <DialogDescription className="sr-only">
          キーワードを入力して過去の会話を横断検索します。Ctrl+Shift+F で開閉できます。
        </DialogDescription>
        <Command
          loop
          // cmdk 組込 filter は使わない（サーバ側で rank 済みなので）
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            placeholder="キーワードで会話を検索..."
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {query.trim().length === 0
                    ? "キーワードを入力してください"
                    : "一致する会話がありません"}
                </CommandEmpty>
                {results.length > 0 && (
                  <CommandGroup heading={`${results.length} 件の結果`}>
                    {results.map((r) => (
                      <SearchResultItem
                        key={`${r.sessionId}:${r.messageId}`}
                        result={r}
                        onSelect={() => handleSelect(r)}
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

// ---------------------------------------------------------------------------
// 1 件表示
// ---------------------------------------------------------------------------

function SearchResultItem({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: () => void;
}) {
  const title =
    result.sessionTitle?.trim() || "（無題のセッション）";
  const relative = useMemo(
    () => formatRelativeTime(result.createdAt),
    [result.createdAt]
  );

  // PM-900: tool role は構造化プレビューを優先的に試みる。
  // 完全 JSON (persisted content がそのまま snippet に収まる短い tool message)
  // なら `parseToolMessageContent` で精確に復元できる。snippet が truncate されて
  // いる場合は `extractToolSnippetInfo` で正規表現ベースの best-effort 抽出へ。
  // どちらも失敗したら既存の汎用 snippet 表示に frame を寄せる。
  const toolInfo = useMemo<ToolSnippetInfo | null>(() => {
    if (result.role !== "tool") return null;
    try {
      const parsed = parseToolMessageContent(result.snippetHtml);
      if (parsed) {
        const preview = summarizeToolInput(parsed.input);
        return {
          name: parsed.name,
          preview: preview.text,
          previewKey: preview.key,
        };
      }
    } catch {
      // parse 失敗は fallback に進む
    }
    return extractToolSnippetInfo(result.snippetHtml);
  }, [result.role, result.snippetHtml]);

  // cmdk 内部 filter は shouldFilter=false で止めているため value は任意。
  // 空文字だと Item が非表示になる仕様があるので、一意な文字列を入れておく。
  return (
    <CommandItem
      value={`${result.sessionId}:${result.messageId}`}
      onSelect={onSelect}
      className="flex-col items-stretch gap-1 py-2"
    >
      <SearchResultHeader
        role={result.role}
        toolName={toolInfo?.name}
        title={title}
        relative={relative}
      />
      {toolInfo && toolInfo.name ? (
        <ToolStructuredPreview
          info={toolInfo}
          snippet={result.snippetHtml}
        />
      ) : (
        <p className="line-clamp-2 whitespace-normal break-words text-sm text-foreground">
          <HighlightedSnippet snippet={result.snippetHtml} />
        </p>
      )}
    </CommandItem>
  );
}

/**
 * PM-900: 1 行目（role / tool badge + title + 相対時刻）。
 * tool_use が構造化抽出できた場合は role ラベルの隣に tool badge を追加表示する。
 */
function SearchResultHeader({
  role,
  toolName,
  title,
  relative,
}: {
  role: string;
  toolName?: string;
  title: string;
  relative: string;
}) {
  const Icon = ROLE_ICON[role] ?? MessageSquare;
  const roleLabel = ROLE_LABEL_JA[role] ?? role;
  const ToolIcon = toolName ? TOOL_ICONS[toolName] ?? Wrench : null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-medium text-foreground">{roleLabel}</span>
      {toolName && ToolIcon && (
        <Badge
          variant="outline"
          className="gap-1 border-muted-foreground/30 px-1.5 py-0 text-[10px] font-medium"
        >
          <ToolIcon className="h-3 w-3" aria-hidden />
          {toolName}
        </Badge>
      )}
      <span aria-hidden>·</span>
      <span className="line-clamp-1">{title}</span>
      <span aria-hidden className="ml-auto shrink-0">
        {relative}
      </span>
    </div>
  );
}

/**
 * PM-900: tool_use の構造化プレビュー本体。
 *
 * 主要 field (file_path / command / pattern 等) が抽出できた場合は 1 行 preview
 * として先頭に出す。そのあと raw snippet を 1 行で補助表示して検索ヒット位置の
 * コンテキストを残す（highlight は維持）。
 *
 * preview が無い場合は snippet だけを 2 行まで表示（既存挙動へのフォールバック）。
 */
function ToolStructuredPreview({
  info,
  snippet,
}: {
  info: ToolSnippetInfo;
  snippet: string;
}) {
  const keyLabel = info.previewKey
    ? PREVIEW_KEY_LABELS_JA[info.previewKey] ?? info.previewKey
    : undefined;

  return (
    <div className="flex flex-col gap-0.5">
      {info.preview && (
        <p className="line-clamp-1 whitespace-normal break-all text-sm text-foreground">
          {keyLabel && (
            <span className="mr-1.5 font-mono text-[10px] uppercase text-muted-foreground">
              {keyLabel}
            </span>
          )}
          <HighlightedSnippet snippet={info.preview} />
        </p>
      )}
      <p
        className={
          info.preview
            ? "line-clamp-1 whitespace-normal break-words text-xs text-muted-foreground"
            : "line-clamp-2 whitespace-normal break-words text-sm text-foreground"
        }
      >
        <HighlightedSnippet snippet={snippet} />
      </p>
    </div>
  );
}

/**
 * PM-900: `ToolUseEvent.input` から代表 field を 1 つ選んで 1 行 preview 化する。
 * 優先度は ToolUseCard.summarizeInput と揃える。
 */
function summarizeToolInput(input: Record<string, unknown>): {
  text: string;
  key?: string;
} {
  const ordered: Array<[string, string]> = [];
  for (const key of [
    "file_path",
    "path",
    "command",
    "pattern",
    "query",
    "url",
    "description",
  ]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
      ordered.push([key, v]);
    }
  }
  if (ordered.length === 0) return { text: "" };
  const [key, text] = ordered[0];
  return { text, key };
}

// ---------------------------------------------------------------------------
// snippet の [ ] を <mark> span 化
// ---------------------------------------------------------------------------

/**
 * Rust 側の snippet() は `[matched]` 形式で delimiter が `[` と `]`。
 * dangerouslySetInnerHTML を避け、正規表現 split で安全に span 化する。
 * 入れ子や不対応の `[` は素通しされる（FTS5 snippet は原則 `[...]` のペア）。
 */
function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = useMemo(() => {
    const out: Array<{ text: string; match: boolean }> = [];
    // 非貪欲 `\[(.*?)\]` でペアを拾う。未対応 `[` は plain として残す。
    const regex = /\[([^\]]*)\]/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(snippet)) !== null) {
      if (m.index > lastIndex) {
        out.push({ text: snippet.slice(lastIndex, m.index), match: false });
      }
      out.push({ text: m[1], match: true });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < snippet.length) {
      out.push({ text: snippet.slice(lastIndex), match: false });
    }
    return out;
  }, [snippet]);

  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p.match ? (
            <mark className="rounded bg-yellow-300/70 px-0.5 text-foreground dark:bg-yellow-400/40">
              {p.text}
            </mark>
          ) : (
            p.text
          )}
        </Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 相対時刻
// ---------------------------------------------------------------------------

/**
 * Unix epoch seconds → 「3 分前」等。Intl.RelativeTimeFormat('ja') を使う。
 * 未来時刻（時計ずれ等）は 0 秒前として丸める。
 */
function formatRelativeTime(epochSec: number): string {
  const now = Date.now() / 1000;
  const diff = epochSec - now; // 過去なら負
  const abs = Math.abs(diff);

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; sec: number }> = [
    { unit: "year", sec: 365 * 24 * 3600 },
    { unit: "month", sec: 30 * 24 * 3600 },
    { unit: "day", sec: 24 * 3600 },
    { unit: "hour", sec: 3600 },
    { unit: "minute", sec: 60 },
    { unit: "second", sec: 1 },
  ];

  const rtf = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
  for (const { unit, sec } of units) {
    if (abs >= sec) {
      const value = Math.round(diff / sec);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, "second");
}
