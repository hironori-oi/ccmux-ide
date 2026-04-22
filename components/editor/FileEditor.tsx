"use client";

import { Suspense, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Loader2, AlertCircle, RotateCcw } from "lucide-react";
import type { editor } from "monaco-editor";

import { SafeMonacoEditor } from "@/components/common/SafeMonacoEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/lib/stores/editor";
import { useSettingsStore } from "@/lib/stores/settings";
import {
  registerMonacoThemes,
  resolveMonacoTheme,
} from "@/lib/monaco-theme";

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
  // PM-949: app preset + mode を Monaco theme 名に解決する。
  // 旧実装は `"vs-light"` を渡していたが Monaco ビルトインは `"vs"`。
  const themePreset = useSettingsStore(
    (s) => s.settings.appearance.themePreset
  );
  // PM-951: 設定画面の UI フォントサイズを Monaco にも反映。
  const fontSize = useSettingsStore((s) => s.settings.appearance.fontSize);
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const monacoTheme = resolveMonacoTheme(themePreset, mode);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // PM-951: fontSize 変更時に Monaco の options.fontSize を即時更新。
  // 初回 mount 直後は `onMount` で editorRef が埋まるので、effect の初回も
  // guard 越しに適用される（editorRef.current が null の間は skip）。
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      ed.updateOptions({ fontSize });
    } catch {
      // Monaco dispose race 回避: 既に dispose されていた場合は silent
    }
  }, [fontSize]);

  // Monaco `addCommand` は editor instance が必要なので onMount で登録する。
  // keybinding は Monaco の `KeyMod.CtrlCmd | KeyCode.KeyS` を利用（Ctrl+S / Cmd+S）。

  // PM-949: app theme preset / light-dark の切替に Monaco editor instance の
  // theme を追従させる。`monaco.editor.setTheme()` は global に効くので、
  // ここで単発呼び出ししておけば同一 page の全 Monaco instance に反映される。
  useEffect(() => {
    let cancelled = false;
    void import("monaco-editor").then((monaco) => {
      if (cancelled) return;
      // custom theme を未登録なら登録（idempotent）
      registerMonacoThemes(monaco);
      monaco.editor.setTheme(monacoTheme);
    });
    return () => {
      cancelled = true;
    };
  }, [monacoTheme]);

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
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          // PM-949: mount 時点で custom theme を登録しておくことで、
          // `theme` prop に custom theme id (`ccmux-*`) を渡しても
          // "Theme is not defined" warning が出ないようにする。
          registerMonacoThemes(monaco);
          // Ctrl+S / Cmd+S で save（onMount の monaco instance から KeyMod / KeyCode を取得）。
          ed.addCommand(
            // KeyMod.CtrlCmd = Ctrl on Win/Linux, Cmd on macOS
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            () => {
              void saveFile(file.id).catch(() => {
                // toast / error 状態は store 内で処理済。
              });
            }
          );
        }}
        onChange={(value) => {
          // Monaco は編集時に undefined を渡すことがあるので guard
          if (typeof value !== "string") return;
          updateContent(file.id, value);
        }}
        options={{
          readOnly: false,
          minimap: { enabled: false },
          // PM-951: 設定画面「フォントサイズ」を初期 options に反映。
          // mount 後の変更は上記 useEffect → ed.updateOptions で追従。
          fontSize,
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
