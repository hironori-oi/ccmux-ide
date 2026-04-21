"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  BrainCog,
  CheckCircle2,
  FileEdit,
  FileSearch,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  PenLine,
  Search,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";

import { useChatStore, DEFAULT_PANE_ID, type ChatActivity } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

// React 19 + zustand: selector が新 object を返すと getSnapshot cache が効かず
// infinite loop。固定参照の凍結 idle object で回避。
const IDLE_ACTIVITY: ChatActivity = Object.freeze({ kind: "idle" }) as ChatActivity;

/**
 * Claude の現在の活動状態を視覚的に明示する sticky indicator（v3.3.2 追加）。
 *
 * v3.5 Chunk B (Split Sessions): `paneId` prop を受け、当該 pane の activity を
 * 参照する。各 pane は独立した activity を持つため、片方が thinking 中でも
 * もう片方は idle のまま表示される。
 */
export function ActivityIndicator({
  paneId = DEFAULT_PANE_ID,
}: {
  paneId?: string;
}) {
  const activity = useChatStore(
    (s) => s.panes[paneId]?.activity ?? IDLE_ACTIVITY
  );
  const setActivity = useChatStore((s) => s.setActivity);

  // complete / error の自動 idle 遷移
  useEffect(() => {
    if (activity.kind === "complete") {
      const t = setTimeout(() => setActivity(paneId, { kind: "idle" }), 3000);
      return () => clearTimeout(t);
    }
    if (activity.kind === "error") {
      const t = setTimeout(() => setActivity(paneId, { kind: "idle" }), 5000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [activity, setActivity, paneId]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none relative"
    >
      <AnimatePresence initial={false}>
        {activity.kind !== "idle" && (
          <motion.div
            key={activityKey(activity)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-auto flex h-9 items-center gap-2 border-t px-3 text-xs",
              surfaceClassName(activity)
            )}
          >
            <ActivityIcon activity={activity} />
            <span className="truncate font-medium">{activityLabel(activity)}</span>
            {isTransient(activity) && <PulseDots />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * 3 点パルスアニメ（thinking / streaming / tool_use 中に表示）。
 */
function PulseDots() {
  return (
    <span className="ml-1 inline-flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-current opacity-70"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

function ActivityIcon({ activity }: { activity: ChatActivity }) {
  const klass = "h-3.5 w-3.5 shrink-0";
  switch (activity.kind) {
    case "thinking":
      return <BrainCog className={cn(klass, "animate-pulse")} aria-hidden />;
    case "streaming":
      return <Sparkles className={klass} aria-hidden />;
    case "tool_use":
      return <ToolIcon name={activity.toolName} className={klass} />;
    case "complete":
      return <CheckCircle2 className={klass} aria-hidden />;
    case "error":
      return <AlertCircle className={klass} aria-hidden />;
    default:
      return <Loader2 className={cn(klass, "animate-spin")} aria-hidden />;
  }
}

function ToolIcon({ name, className }: { name: string; className: string }) {
  const n = name.toLowerCase();
  if (n === "read") return <FileText className={className} aria-hidden />;
  if (n === "write") return <PenLine className={className} aria-hidden />;
  if (n === "edit" || n === "multiedit")
    return <FileEdit className={className} aria-hidden />;
  if (n === "bash") return <Terminal className={className} aria-hidden />;
  if (n === "grep") return <Search className={className} aria-hidden />;
  if (n === "glob") return <FileSearch className={className} aria-hidden />;
  if (n === "task") return <Users className={className} aria-hidden />;
  if (n === "webfetch" || n === "websearch")
    return <Globe className={className} aria-hidden />;
  if (n === "todowrite")
    return <ListChecks className={className} aria-hidden />;
  return <Loader2 className={cn(className, "animate-spin")} aria-hidden />;
}

/**
 * tool 名を素人向けの日本語ラベルに変換。未知の tool は素の名前 + 「を実行中」。
 */
function toolLabelJa(name: string): string {
  const map: Record<string, string> = {
    Read: "ファイルを読み取っています",
    Write: "ファイルを書き込んでいます",
    Edit: "ファイルを編集しています",
    MultiEdit: "複数箇所を編集しています",
    Bash: "コマンドを実行しています",
    Grep: "コードを検索しています",
    Glob: "ファイルを検索しています",
    Task: "サブエージェントを実行しています",
    WebFetch: "Web ページを取得しています",
    WebSearch: "Web を検索しています",
    TodoWrite: "TODO リストを更新しています",
    NotebookEdit: "ノートブックを編集しています",
  };
  return map[name] ?? `${name} を実行中`;
}

function activityLabel(activity: ChatActivity): string {
  switch (activity.kind) {
    case "thinking":
      return "Claude が考えています";
    case "streaming":
      return "応答を生成中";
    case "tool_use":
      return toolLabelJa(activity.toolName);
    case "complete":
      return "完了しました";
    case "error":
      return activity.message
        ? `エラー: ${activity.message}`
        : "エラーが発生しました";
    default:
      return "";
  }
}

function activityKey(activity: ChatActivity): string {
  if (activity.kind === "tool_use") return `tool_use:${activity.toolName}`;
  if (activity.kind === "error") return `error:${activity.message ?? ""}`;
  return activity.kind;
}

function isTransient(activity: ChatActivity): boolean {
  return (
    activity.kind === "thinking" ||
    activity.kind === "streaming" ||
    activity.kind === "tool_use"
  );
}

function surfaceClassName(activity: ChatActivity): string {
  switch (activity.kind) {
    case "complete":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "error":
      return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
    default:
      return "bg-muted/60 text-muted-foreground";
  }
}
