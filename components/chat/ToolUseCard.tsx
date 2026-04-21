"use client";

import { useState } from "react";
import {
  FileText,
  FileEdit,
  FilePlus,
  Terminal,
  FolderSearch,
  Search,
  Globe,
  Sparkles,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolUseEvent } from "@/lib/stores/chat";
import { DiffViewer } from "@/components/chat/DiffViewer";
import { detectLang } from "@/lib/detect-lang";
import { tryParseJson } from "@/lib/tool-content-parser";

/**
 * PM-133 / PM-161: Tool use カード。
 *
 * Agent SDK の tool_use イベントをアイコン + 入力 / 出力 のカードで可視化する。
 * Edit tool は Monaco DiffEditor (`DiffViewer`) で old_string / new_string を
 * 左右 2 列のサイドバイサイド diff として表示する（PM-161 Week5）。
 * Edit 以外の tool は従来どおり JSON で入力内容を表示する。
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

const TOOL_LABELS_JA: Record<string, string> = {
  Read: "ファイル読込",
  Edit: "ファイル編集",
  MultiEdit: "一括編集",
  Write: "ファイル書込",
  Bash: "コマンド実行",
  Glob: "ファイル検索",
  Grep: "コード検索",
  WebFetch: "Web 取得",
  WebSearch: "Web 検索",
  Task: "サブエージェント",
};

const STATUS_LABELS: Record<ToolUseEvent["status"], string> = {
  pending: "実行中",
  success: "完了",
  error: "エラー",
};

const STATUS_CLASSES: Record<ToolUseEvent["status"], string> = {
  pending: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  success: "bg-green-500/20 text-green-700 dark:text-green-300",
  error: "bg-red-500/20 text-red-700 dark:text-red-300",
};

export interface ToolUseCardProps {
  tool: ToolUseEvent;
}

export function ToolUseCard({ tool }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const label = TOOL_LABELS_JA[tool.name] ?? tool.name;
  // PM-161: Edit tool は Monaco DiffEditor、MultiEdit は従来の簡易 2 列 diff を継続利用
  const isEdit = tool.name === "Edit";
  const isMultiEdit = tool.name === "MultiEdit";

  return (
    <Card className="mx-auto w-full max-w-2xl border-muted-foreground/20 bg-muted/30 p-0 text-sm shadow-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {summarizeInput(tool)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "ml-auto border-transparent text-xs",
            STATUS_CLASSES[tool.status]
          )}
        >
          {STATUS_LABELS[tool.status]}
        </Badge>
      </button>
      {expanded && (
        <div className="border-t border-border/50 p-3">
          {isEdit ? (
            <EditDiffMonaco input={tool.input} />
          ) : isMultiEdit ? (
            <EditDiff input={tool.input} />
          ) : (
            <ToolInputView toolName={tool.name} input={tool.input} />
          )}
          {tool.output !== undefined && tool.output !== "" && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                出力
              </p>
              <ToolOutputView output={tool.output} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** カードヘッダーの 1 行サマリ（tool ごとに主要フィールドを抜粋） */
function summarizeInput(tool: ToolUseEvent): string {
  const input = tool.input;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  if (typeof input.command === "string") return input.command;
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.query === "string") return input.query;
  if (typeof input.url === "string") return input.url;
  if (typeof input.description === "string") return input.description;
  return "";
}

/**
 * PM-161: Edit tool を Monaco DiffEditor で表示するラッパー。
 * file_path が無い / 不明拡張子の場合は `plaintext` にフォールバック。
 */
function EditDiffMonaco({ input }: { input: Record<string, unknown> }) {
  const oldStr = typeof input.old_string === "string" ? input.old_string : "";
  const newStr = typeof input.new_string === "string" ? input.new_string : "";
  const filePath =
    typeof input.file_path === "string" ? input.file_path : undefined;
  const language = detectLang(filePath);

  return (
    <div className="flex flex-col gap-2">
      {filePath && (
        <p className="font-mono text-xs text-muted-foreground">{filePath}</p>
      )}
      <DiffViewer
        original={oldStr}
        modified={newStr}
        language={language}
        maxHeight={400}
      />
    </div>
  );
}

/**
 * PM-831: Edit / MultiEdit 以外の tool input を可読化する汎用 renderer。
 *
 * - 主要 tool (Bash / Read / Write / Grep / Glob / WebFetch 等) で頻出する
 *   1 階層 string field は key-value テーブルで、複雑値や未知 tool は
 *   pretty-printed JSON で fallback 表示する。
 * - `Bash` の `command` だけは command line として等幅 + monospace で強調。
 * - 何があっても crash しない（unknown 入力に対して防御的に文字列化）。
 */
function ToolInputView({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  // Bash は command を 1 ブロック、それ以外の field は key-value で続ける
  if (toolName === "Bash" && typeof input.command === "string") {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            command
          </p>
          <Collapsible
            text={input.command}
            className="rounded border border-border/60 bg-background p-2 font-mono text-xs"
          />
        </div>
        <KeyValueGrid
          input={input}
          excludeKeys={new Set(["command"])}
        />
      </div>
    );
  }

  // 全 field が primitive (string / number / boolean) なら key-value 表示
  const allPrimitive = Object.values(input).every(
    (v) =>
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
  );
  if (allPrimitive && Object.keys(input).length > 0) {
    return <KeyValueGrid input={input} />;
  }

  // 複雑 / 未知 tool は pretty JSON にフォールバック
  let serialized: string;
  try {
    serialized = JSON.stringify(input, null, 2);
  } catch {
    serialized = String(input);
  }
  return (
    <Collapsible
      text={serialized}
      className="overflow-x-auto rounded bg-background p-2 font-mono text-xs"
    />
  );
}

/**
 * key-value 形式の input 表示。長い value は折り畳み対象になる。
 */
function KeyValueGrid({
  input,
  excludeKeys,
}: {
  input: Record<string, unknown>;
  excludeKeys?: Set<string>;
}) {
  const entries = Object.entries(input).filter(
    ([k]) => !excludeKeys?.has(k)
  );
  if (entries.length === 0) return null;

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
      {entries.map(([key, value]) => (
        <ValueRow key={key} label={key} value={value} />
      ))}
    </dl>
  );
}

function ValueRow({ label, value }: { label: string; value: unknown }) {
  let display: string;
  let multiline = false;
  if (value === null || value === undefined) {
    display = String(value);
  } else if (typeof value === "string") {
    display = value;
    multiline = value.includes("\n");
  } else if (typeof value === "number" || typeof value === "boolean") {
    display = String(value);
  } else {
    try {
      display = JSON.stringify(value, null, 2);
    } catch {
      display = String(value);
    }
    multiline = true;
  }

  return (
    <>
      <dt className="pt-1 font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0", multiline ? "" : "")}>
        <Collapsible
          text={display}
          className={cn(
            "rounded bg-background px-2 py-1 font-mono text-xs",
            multiline && "whitespace-pre-wrap break-words"
          )}
          inline={!multiline}
        />
      </dd>
    </>
  );
}

/**
 * tool 出力の表示。JSON 風文字列なら parse して整形、それ以外は raw を
 * 折り畳み可能な pre block で表示する。
 */
function ToolOutputView({ output }: { output: string }) {
  const parsed = tryParseJson(output);
  if (parsed !== null) {
    let serialized: string;
    try {
      serialized = JSON.stringify(parsed, null, 2);
    } catch {
      serialized = output;
    }
    return (
      <Collapsible
        text={serialized}
        className="overflow-auto rounded bg-background p-2 font-mono text-xs"
      />
    );
  }
  return (
    <Collapsible
      text={output}
      className="overflow-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap break-words"
    />
  );
}

/**
 * 10 行を超える text を「もっと見る / 折りたたむ」で切り替え表示するラッパ。
 * `inline` 時は 1 行 + 100 字超で `...` truncate に切り替える（key-value 表示用）。
 */
const MAX_LINES = 10;
const INLINE_MAX_CHARS = 120;

function Collapsible({
  text,
  className,
  inline = false,
}: {
  text: string;
  className?: string;
  inline?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (inline) {
    const needsTruncate = text.length > INLINE_MAX_CHARS;
    if (!needsTruncate) {
      return (
        <code className={cn("inline-block break-all", className)}>{text}</code>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <code className={cn("inline-block break-all", className)}>
          {expanded ? text : text.slice(0, INLINE_MAX_CHARS) + "…"}
        </code>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded ? "折りたたむ" : "もっと見る"}
        </button>
      </div>
    );
  }

  const lines = text.split("\n");
  const overflows = lines.length > MAX_LINES;
  const shown = expanded || !overflows ? text : lines.slice(0, MAX_LINES).join("\n");

  return (
    <div className="flex flex-col gap-1">
      <pre className={cn("max-h-[480px]", className)}>
        <code>{shown}</code>
      </pre>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded
            ? "折りたたむ"
            : `もっと見る (残り ${lines.length - MAX_LINES} 行)`}
        </button>
      )}
    </div>
  );
}

/** MultiEdit など Monaco 未対応 tool 用の簡易 2 列 diff 表示。 */
function EditDiff({ input }: { input: Record<string, unknown> }) {
  const oldStr = typeof input.old_string === "string" ? input.old_string : "";
  const newStr = typeof input.new_string === "string" ? input.new_string : "";
  const filePath =
    typeof input.file_path === "string" ? input.file_path : undefined;

  return (
    <div className="flex flex-col gap-2">
      {filePath && (
        <p className="font-mono text-xs text-muted-foreground">{filePath}</p>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">
            変更前
          </p>
          <pre className="max-h-64 overflow-auto rounded border border-red-500/20 bg-red-500/5 p-2 text-xs">
            <code>{oldStr}</code>
          </pre>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">
            変更後
          </p>
          <pre className="max-h-64 overflow-auto rounded border border-green-500/20 bg-green-500/5 p-2 text-xs">
            <code>{newStr}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
