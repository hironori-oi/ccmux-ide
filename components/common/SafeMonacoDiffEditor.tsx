"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import type { DiffEditorProps, DiffOnMount } from "@monaco-editor/react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * PRJ-012 v3.3.x: Monaco `DiffEditor` の safe wrapper。
 *
 * ## 解決する問題
 * `@monaco-editor/react` v4.6.0 の DiffEditor unmount 処理は以下を行う
 * （`index.mjs` の `I()` 関数参照）:
 *
 * ```
 * let i = u.current?.getModel();
 * g || i?.original?.dispose();   // keepCurrentOriginalModel = false なら model 先に dispose
 * N || i?.modified?.dispose();   // keepCurrentModifiedModel = false なら model 先に dispose
 * u.current?.dispose();          // editor dispose → 内部で reset → 既に dispose 済 model
 *                                //  → "TextModel got disposed before DiffEditorWidget
 *                                //     model got reset"
 * ```
 *
 * React StrictMode / hot-reload / 親の key 再 mount 等で unmount / remount が
 * 高速に走ると上記 race が発火する（Monaco の既知 issue）。
 *
 * ## 解決方針（A）
 * - `keepCurrentOriginalModel` / `keepCurrentModifiedModel` を強制 true にして、
 *   library 側の model 先行 dispose を止める。
 * - `onMount` で editor / original / modified model の ref を保持。
 * - 自前 `useEffect` cleanup で:
 *   1. `editor.setModel({ original: null, modified: null })` で detach
 *   2. original / modified model を自前で dispose
 *   これにより library cleanup の `editor.dispose()` 内部の model reset が
 *   model なし状態で走るため、既に dispose 済 model に触ることはない。
 *
 * ## 副作用
 * - `keepCurrentOriginalModel` / `keepCurrentModifiedModel` は wrapper 側で
 *   常に true 固定。呼び出し側から上書きは受け付けない。
 *
 * @see projects/PRJ-012/reports/dev-monaco-dispose-race-fix.md
 */

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => <DefaultSkeleton />,
  }
);

/**
 * `SafeMonacoDiffEditor` の props。
 * `keepCurrentOriginalModel` / `keepCurrentModifiedModel` は safe wrapper が
 * 内部で強制 true にするため受け付けない。
 */
export type SafeMonacoDiffEditorProps = Omit<
  DiffEditorProps,
  "keepCurrentOriginalModel" | "keepCurrentModifiedModel"
>;

export function SafeMonacoDiffEditor(props: SafeMonacoDiffEditorProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<editor.ITextModel | null>(null);
  const userOnMount = props.onMount;

  const handleMount: DiffOnMount = (ed, monaco) => {
    editorRef.current = ed;
    const m = ed.getModel();
    originalModelRef.current = m?.original ?? null;
    modifiedModelRef.current = m?.modified ?? null;
    userOnMount?.(ed, monaco);
  };

  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      const originalModel = originalModelRef.current;
      const modifiedModel = modifiedModelRef.current;

      // 1) DiffEditor から model を detach
      if (ed) {
        try {
          ed.setModel(
            // Monaco の型は null を受け付けないが実装は許容、既知の workaround
            null as unknown as editor.IDiffEditorModel
          );
        } catch {
          // silent
        }
      }

      // 2) model を自前で dispose（keep*Model=true なので library はやらない）
      if (originalModel) {
        try {
          if (!originalModel.isDisposed()) {
            originalModel.dispose();
          }
        } catch {
          // silent
        }
      }
      if (modifiedModel) {
        try {
          if (!modifiedModel.isDisposed()) {
            modifiedModel.dispose();
          }
        } catch {
          // silent
        }
      }

      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, []);

  return (
    <MonacoDiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
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
