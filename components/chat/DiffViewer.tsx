"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * PM-160: Monaco DiffEditor ラッパー。
 *
 * - `@monaco-editor/react` の `DiffEditor` を dynamic import（`ssr: false`）で
 *   読み込み、Next.js の `output: 'export'` と Tauri WebView の両方で SSR を回避する。
 * - Monaco 本体は ~1.5MB と重いので Suspense + Skeleton でプレースホルダを表示する。
 * - 折畳制御: 初期は 200px プレビュー、ユーザーが「展開」を押すと `maxHeight`（既定 400px）まで拡張。
 * - テーマは next-themes の `resolvedTheme` を参照し、`vs-dark` / `vs-light` を切替。
 */

// DiffEditor は CSR でのみ読み込む（Monaco worker が window に依存するため）
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => <DiffEditorSkeleton />,
  }
);

export interface DiffViewerProps {
  /** 変更前の内容（Edit tool の `old_string` 等） */
  original: string;
  /** 変更後の内容（Edit tool の `new_string` 等） */
  modified: string;
  /** Monaco 言語 ID（`detectLang()` 結果）。未指定時は `"plaintext"` */
  language?: string;
  /** 展開時の最大高さ（px）。既定 400 */
  maxHeight?: number;
}

const PREVIEW_HEIGHT = 200;

export function DiffViewer({
  original,
  modified,
  language = "plaintext",
  maxHeight = 400,
}: DiffViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs-light";

  const height = expanded ? maxHeight : PREVIEW_HEIGHT;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "overflow-hidden rounded border border-border/50 bg-background"
        )}
        style={{ height }}
      >
        <Suspense fallback={<DiffEditorSkeleton />}>
          <DiffEditor
            height={height}
            language={language}
            original={original}
            modified={modified}
            theme={monacoTheme}
            options={{
              renderSideBySide: true,
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              // 読み取り専用でもカーソルが出るのを抑制
              renderOverviewRuler: false,
            }}
          />
        </Suspense>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex gap-3">
          <span className="text-red-600 dark:text-red-400">前</span>
          <span className="text-green-600 dark:text-green-400">後</span>
          <span>{language}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              折りたたむ
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              展開
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** Monaco ロード中のプレースホルダ（Suspense / dynamic loading 共通） */
function DiffEditorSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-1/4" />
      <p className="mt-auto text-center text-xs text-muted-foreground">
        エディタを読み込み中...
      </p>
    </div>
  );
}
