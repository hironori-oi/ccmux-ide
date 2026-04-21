"use client";

import { Suspense, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Loader2, AlertCircle, RotateCcw } from "lucide-react";
import type { editor } from "monaco-editor";

import { SafeMonacoEditor } from "@/components/common/SafeMonacoEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/lib/stores/editor";

/**
 * PRJ-012 v3.4 Chunk A (DEC-034 Must 1): 単一ファイル Monaco エディタ。
 *
 * - `SafeMonacoEditor`（既存、Monaco dispose race 対策済）を wrap
 * - props `openFileId` で `useEditorStore` から対応ファイルを引く
 * - content 変更で `updateContent`、Ctrl+S / Cmd+S で `saveFile`
 * - 読込中は Skeleton、エラー時は Alert + reload ボタン
 * - 1MB 超過は store が error 状態にしているので、ここでも同じ Alert で表示
 *
 * ## キーバインド
 * - Windows/Linux: `Ctrl+S` / macOS: `Cmd+S` で save
 *   （Monaco の `addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, ...)` を利用）
 *
 * ## SafeMonacoEditor 流用範囲
 * - `keepCurrentModel: true` による model の自前 dispose 制御
 * - dynamic import (`ssr: false`) による worker 依存回避
 * - 既存 `FilePreviewDialog` の read-only 利用に加え、
 *   本 component が初の read/write 利用ケースとなる
 */

export interface FileEditorProps {
  openFileId: string;
}

export function FileEditor({ openFileId }: FileEditorProps) {
  const file = useEditorStore((s) =>
    s.openFiles.find((f) => f.id === openFileId)
  );
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveFile = useEditorStore((s) => s.saveFile);
  const reloadFile = useEditorStore((s) => s.reloadFile);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs-light";

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Monaco `addCommand` は editor instance が必要なので onMount で登録する。
  // keybinding は Monaco の `KeyMod.CtrlCmd | KeyCode.KeyS` を利用（Ctrl+S / Cmd+S）。
  useEffect(() => {
    // openFileId / file の入替時に再登録されるのは onMount 経由なので、
    // ここでは何もしない。cleanup も editor dispose で吸収される。
  }, [openFileId]);

  if (!file) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        ファイルが見つかりません
      </div>
    );
  }

  if (file.loading) {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>読込中...</span>
        </div>
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
        <p className="text-sm text-destructive">{file.error}</p>
        <p className="truncate text-[11px] text-muted-foreground" title={file.path}>
          {file.path}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void reloadFile(file.id)}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          再読込
        </Button>
      </div>
    );
  }

  return (
    <Suspense fallback={<EditorSkeleton />}>
      <SafeMonacoEditor
        height="100%"
        defaultLanguage={file.language}
        language={file.language}
        // 初期値だけを渡し、以降は value で制御。
        // SafeMonacoEditor は keepCurrentModel=true により model を保持するので
        // 非制御→制御に切り替わる挙動は発生しない（onChange で同期して制御する）。
        value={file.content}
        theme={monacoTheme}
        path={file.path}
        onMount={(ed) => {
          editorRef.current = ed;
          // Ctrl+S / Cmd+S で save（Monaco の KeyMod / KeyCode は Editor.onMount の
          // 第 2 引数 monaco から取得）。ここでは monaco instance を引数で受け取る
          // 代わりに dynamic import した monaco-editor の定数を使う。
          void import("monaco-editor").then((monaco) => {
            ed.addCommand(
              // KeyMod.CtrlCmd = Ctrl on Win/Linux, Cmd on macOS
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
              () => {
                void saveFile(file.id).catch(() => {
                  // toast / error 状態は store 内で処理済。
                });
              }
            );
          });
        }}
        onChange={(value) => {
          // Monaco は編集時に undefined を渡すことがあるので guard
          if (typeof value !== "string") return;
          updateContent(file.id, value);
        }}
        options={{
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: "all",
          lineNumbers: "on",
          tabSize: 2,
          insertSpaces: true,
        }}
      />
    </Suspense>
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
