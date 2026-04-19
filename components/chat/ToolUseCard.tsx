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
            <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
              <code>{JSON.stringify(tool.input, null, 2)}</code>
            </pre>
          )}
          {tool.output !== undefined && tool.output !== "" && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                出力
              </p>
              <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-xs">
                <code>{tool.output}</code>
              </pre>
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
