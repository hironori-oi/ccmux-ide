"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Week 7 Chunk 2 / PM-240: CLAUDE.md 編集モード。
 *
 * - `@monaco-editor/react` の通常 `Editor`（DiffEditor ではない）を
 *   `dynamic import(ssr: false)` で lazy ロード。Monaco worker の window 依存を回避。
 * - 初期化: `@tauri-apps/plugin-fs::readTextFile` で内容ロード。
 * - 保存: `writeTextFile` → sonner toast.success。MemoryTreeView 側が
 *   `watchImmediate` で自動再読込。
 * - 未保存変更（dirty）検知: 初期 load 時の content と現在値の差分。
 *   dirty 状態で onClose / Escape が呼ばれたら shadcn AlertDialog で確認。
 * - テーマ連動: `resolvedTheme === "dark"` で `vs-dark` / `vs-light`。
 * - 500KB 超は read-only で開く（編集不可、保存ボタン disabled）。
 */

const MAX_EDITABLE_BYTES = 500 * 1024;

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

export interface MemoryEditorProps {
  filePath: string;
  onClose: () => void;
  /**
   * Editor 上部にタイトル / スコープラベルを描画したい呼び出し側向け。
   * 省略時は description のみ表示。
   */
  headerSlot?: React.ReactNode;
}

interface LoadState {
  content: string;
  originalContent: string;
  bytes: number;
  isLoading: boolean;
  error: string | null;
  readOnly: boolean;
}

const INITIAL: LoadState = {
  content: "",
  originalContent: "",
  bytes: 0,
  isLoading: true,
  error: null,
  readOnly: false,
};

export function MemoryEditor({
  filePath,
  onClose,
  headerSlot,
}: MemoryEditorProps) {
  const [state, setState] = useState<LoadState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs-light";

  const isDirty = state.content !== state.originalContent;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // --- ファイルロード ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setState({ ...INITIAL, isLoading: true });
    (async () => {
      try {
        const meta = await stat(filePath);
        const size = meta.size ?? 0;
        const tooLarge = size > MAX_EDITABLE_BYTES;
        const content = await readTextFile(filePath);
        if (cancelled) return;
        setState({
          content,
          originalContent: content,
          bytes: size,
          isLoading: false,
          error: null,
          readOnly: tooLarge,
        });
        if (tooLarge) {
          toast.message("500KB を超えるため read-only で開きました");
        }
      } catch (e) {
        if (cancelled) return;
        setState({
          ...INITIAL,
          isLoading: false,
          error: String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // --- 保存 --------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (state.readOnly || saving) return;
    setSaving(true);
    try {
      await writeTextFile(filePath, state.content);
      toast.success("保存しました");
      setState((s) => ({ ...s, originalContent: s.content }));
    } catch (e) {
      toast.error(`保存に失敗しました: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [filePath, saving, state.content, state.readOnly]);

  // --- 閉じる処理（dirty 時は確認） --------------------------------------
  const handleRequestClose = useCallback(() => {
    if (isDirtyRef.current) {
      setConfirmClose(true);
    } else {
      onClose();
    }
  }, [onClose]);

  // Escape キーハンドラ
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleRequestClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRequestClose, handleSave]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {headerSlot}
          <p
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={filePath}
          >
            {filePath}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {state.bytes != null && `${humanSize(state.bytes)}`}
            {state.readOnly && " · read-only（500KB 超）"}
            {isDirty && !state.readOnly && " · 未保存の変更あり"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="default"
            onClick={() => void handleSave()}
            disabled={saving || state.readOnly || !isDirty || state.isLoading}
            aria-label="保存"
          >
            {saving ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Save className="mr-1 h-3 w-3" aria-hidden />
            )}
            保存
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRequestClose}
            aria-label="閉じる"
          >
            <X className="h-3 w-3" aria-hidden />
          </Button>
        </div>
      </div>

      {/* body */}
      <div
        className={cn(
          "flex min-h-[320px] flex-1 overflow-hidden rounded border bg-background"
        )}
      >
        {state.isLoading && <LoadingView />}

        {!state.isLoading && state.error && (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-destructive">
            読込に失敗しました: {state.error}
          </div>
        )}

        {!state.isLoading && !state.error && (
          <MonacoEditor
            height="100%"
            defaultLanguage="markdown"
            language="markdown"
            value={state.content}
            theme={monacoTheme}
            onChange={(value) =>
              setState((s) => ({ ...s, content: value ?? "" }))
            }
            options={{
              readOnly: state.readOnly,
              language: "markdown",
              fontSize: 14,
              wordWrap: "on",
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        )}
      </div>

      {/* 未保存確認ダイアログ */}
      <AlertDialog
        open={confirmClose}
        onOpenChange={(open) => !open && setConfirmClose(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存せずに閉じますか？</AlertDialogTitle>
            <AlertDialogDescription>
              未保存の変更があります。このまま閉じると変更内容は失われます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              保存せず閉じる
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
