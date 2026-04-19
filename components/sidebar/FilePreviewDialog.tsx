"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { FileText, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { detectLang } from "@/lib/detect-lang";
import { cn } from "@/lib/utils";

/**
 * PM-204 補助: プロジェクト内ファイルの read-only プレビュー Dialog。
 *
 * - `@monaco-editor/react` の `Editor`（DiffEditor ではなく通常エディタ）を
 *   dynamic import（`ssr: false`）で lazy ロード、Monaco worker の window 依存を回避
 * - 言語は `detectLang(filePath)` で推定、`.md` は markdown 決め打ち
 * - next-themes の `resolvedTheme` で `vs-light` / `vs-dark` を切替
 * - 500KB 超のファイルは「大きすぎて表示できません」フォールバック
 * - ファイル読込時点の mtime を Dialog ヘッダに表示
 * - Dialog サイズ: max-w-[900px] / max-h-[80vh]
 */

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <EditorSkeleton />,
  }
);

export interface FilePreviewDialogProps {
  /** プレビュー対象の絶対パス（`null` で閉状態） */
  filePath: string | null;
  /** ラベル（ヘッダ表示用）。未指定時は filePath のファイル名末尾 */
  label?: string;
  /** 閉じる側のハンドラ。`open=false` で呼ばれる想定 */
  onClose: () => void;
}

/** 500KB を超えるファイルはプレビュー対象外 */
const MAX_PREVIEW_BYTES = 500 * 1024;

interface LoadState {
  content: string | null;
  bytes: number | null;
  mtime: Date | null;
  error: string | null;
  tooLarge: boolean;
  isLoading: boolean;
}

const INITIAL_STATE: LoadState = {
  content: null,
  bytes: null,
  mtime: null,
  error: null,
  tooLarge: false,
  isLoading: false,
};

export function FilePreviewDialog({
  filePath,
  label,
  onClose,
}: FilePreviewDialogProps) {
  const [state, setState] = useState<LoadState>(INITIAL_STATE);
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs-light";

  useEffect(() => {
    if (!filePath) {
      setState(INITIAL_STATE);
      return;
    }

    let cancelled = false;
    setState({ ...INITIAL_STATE, isLoading: true });

    (async () => {
      try {
        const meta = await stat(filePath);
        const size = meta.size ?? 0;
        const mtime = meta.mtime ? new Date(meta.mtime) : null;

        if (size > MAX_PREVIEW_BYTES) {
          if (cancelled) return;
          setState({
            content: null,
            bytes: size,
            mtime,
            error: null,
            tooLarge: true,
            isLoading: false,
          });
          return;
        }

        const content = await readTextFile(filePath);
        if (cancelled) return;
        setState({
          content,
          bytes: size,
          mtime,
          error: null,
          tooLarge: false,
          isLoading: false,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          ...INITIAL_STATE,
          error: String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const open = filePath !== null;
  const fileName =
    label ?? (filePath ? filePath.split(/[\\/]/).pop() ?? filePath : "");
  const language = detectLang(filePath ?? undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[80vh] w-[90vw] max-w-[900px] flex-col gap-3 overflow-hidden p-4"
        )}
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="truncate">{fileName}</span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-[11px]">
            <span className="truncate" title={filePath ?? undefined}>
              {filePath ?? ""}
            </span>
            {state.mtime && (
              <span className="shrink-0 text-muted-foreground">
                更新: {formatDate(state.mtime)}
              </span>
            )}
            {state.bytes != null && (
              <span className="shrink-0 text-muted-foreground">
                {humanSize(state.bytes)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[320px] flex-1 overflow-hidden rounded border bg-background">
          {state.isLoading && <LoadingView />}

          {!state.isLoading && state.error && (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-destructive">
              読込に失敗しました: {state.error}
            </div>
          )}

          {!state.isLoading && !state.error && state.tooLarge && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
              <FileText className="h-6 w-6" aria-hidden />
              <p>このファイルは大きすぎて表示できません</p>
              <p className="text-[10px]">
                ({state.bytes != null ? humanSize(state.bytes) : "サイズ不明"} / 上限 500KB)
              </p>
            </div>
          )}

          {!state.isLoading &&
            !state.error &&
            !state.tooLarge &&
            state.content !== null && (
              <Suspense fallback={<EditorSkeleton />}>
                <MonacoEditor
                  height="60vh"
                  defaultLanguage={language}
                  language={language}
                  value={state.content}
                  theme={monacoTheme}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    renderLineHighlight: "none",
                    lineNumbers: "on",
                  }}
                />
              </Suspense>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>読込中...</span>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-3 w-3/5" />
      <p className="mt-auto text-center text-[11px] text-muted-foreground">
        エディタを読み込み中...
      </p>
    </div>
  );
}

/** Byte 数を人間可読な単位に整形 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** YYYY/MM/DD HH:mm 形式（ローカル時刻） */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}
