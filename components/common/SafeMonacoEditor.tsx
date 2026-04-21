"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import type { EditorProps, OnMount } from "@monaco-editor/react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * PRJ-012 v3.3.x: Monaco `Editor` の safe wrapper。
 *
 * ## 解決する問題
 * `@monaco-editor/react` v4.6.0 の unmount 処理は `useEffect` の cleanup で
 * 以下を実行する（`index.mjs` の `pe()` 関数参照）:
 *
 * ```
 * I.current?.dispose();                // onDidChangeModelContent subscription
 * V ? saveViewState : model.dispose(); // model を先に dispose
 * o.current.dispose();                 // editor を後で dispose
 * ```
 *
 * React StrictMode の double invoke / Next.js hot-reload / 親 component の
 * `key` 変更による force re-mount 等で unmount と新 mount が高速に走ると、
 * 既に dispose 済の TextModel に対して内部 DiffEditorWidget が model reset を
 * 試みて `"TextModel got disposed before DiffEditorWidget model got reset"`
 * の Uncaught Error を console に吐く。
 *
 * ## 解決方針（A）
 * - `keepCurrentModel` を強制 true にして、library 側に model を dispose させない。
 * - `onMount` で editor / model の ref を保持。
 * - 自前 `useEffect` の cleanup で `editor.setModel(null)` → 自前で model.dispose。
 *   これにより library cleanup が走っても model は detach 済 & dispose 済で、
 *   内部 reset が安全に no-op となる。
 *
 * ## 副作用
 * - `keepCurrentModel` を強制 true にしているので、呼び出し側の同 prop は無視。
 *   view-state 保存は library 側の `_` Map に乗るためそのまま動作。
 *
 * @see projects/PRJ-012/reports/dev-monaco-dispose-race-fix.md
 */

// dynamic import（ssr: false）: Monaco worker が window 依存のため
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <DefaultSkeleton />,
  }
);

/**
 * `SafeMonacoEditor` の props。`keepCurrentModel` は safe wrapper が内部で
 * 強制 true にするため受け付けない。
 */
export type SafeMonacoEditorProps = Omit<EditorProps, "keepCurrentModel">;

export function SafeMonacoEditor(props: SafeMonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<editor.ITextModel | null>(null);
  const userOnMount = props.onMount;

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    modelRef.current = ed.getModel();
    userOnMount?.(ed, monaco);
  };

  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      const model = modelRef.current;

      // 1) editor から model を detach（reset race を先回り）
      if (ed) {
        try {
          ed.setModel(null);
        } catch {
          // unmount race で既に editor が dispose 済のケース: silent
        }
      }

      // 2) model を自前で dispose（keepCurrentModel=true なので library はやらない）
      if (model) {
        try {
          if (!model.isDisposed()) {
            model.dispose();
          }
        } catch {
          // silent
        }
      }

      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  return (
    <MonacoEditor
      {...props}
      keepCurrentModel
      onMount={handleMount}
    />
  );
}

function DefaultSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  );
}
