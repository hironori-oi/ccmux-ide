"use client";

import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertCircle, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileEditor } from "@/components/editor/FileEditor";
import { useEditorStore } from "@/lib/stores/editor";

/**
 * PM-968: 拡張子別ファイルビューワのディスパッチャ。
 *
 * 旧 `EditorPaneItem` は `<FileEditor>` を直接レンダリングし、PDF / 画像 / 動画
 * などのバイナリファイルも Monaco に text として流し込んで文字化けしていた。
 * 本コンポーネントは拡張子で分岐し、適切なビューワへルーティングする:
 *
 * - `.pdf`                         → WebView2 / WebKit 内蔵 PDF ビューワ（iframe）
 * - `.png` / `.jpg` / `.webp` 等   → `<img>` ライトボックス表示
 * - `.svg`                         → `<img>` 表示（ソース編集は Monaco にスイッチ可能）
 * - `.mp4` / `.webm` / `.mov`      → `<video controls>`
 * - `.mp3` / `.wav` / `.ogg`       → `<audio controls>`
 * - その他                          → `<FileEditor>`（Monaco、従来通り）
 *
 * Tauri asset protocol (`asset://`) はデフォルトで `$HOME/**` に許可されて
 * いるため、`convertFileSrc(absPath)` だけで iframe / img / video に渡せる。
 */

const PDF_EXTENSIONS = new Set(["pdf"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "ico",
  "avif",
]);
const SVG_EXTENSIONS = new Set(["svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a"]);

function getExt(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return "";
  return path.slice(idx + 1).toLowerCase();
}

type ViewerKind =
  | "pdf"
  | "image"
  | "svg"
  | "video"
  | "audio"
  | "monaco";

function detectViewer(path: string): ViewerKind {
  const ext = getExt(path);
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (SVG_EXTENSIONS.has(ext)) return "svg";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "monaco";
}

export function FileViewer({ openFileId }: { openFileId: string }) {
  const file = useEditorStore((s) =>
    s.openFiles.find((f) => f.id === openFileId)
  );

  const viewerKind = useMemo<ViewerKind>(
    () => (file ? detectViewer(file.path) : "monaco"),
    [file]
  );

  if (!file) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        ファイルが見つかりません
      </div>
    );
  }

  // Monaco パス（Markdown / ソースコード / 設定ファイル等）は従来実装をそのまま
  if (viewerKind === "monaco") {
    return <FileEditor openFileId={openFileId} />;
  }

  const assetUrl = convertFileSrc(file.path);

  if (viewerKind === "pdf") {
    return (
      <BinaryViewerFrame file={file}>
        <iframe
          src={assetUrl}
          className="h-full w-full border-0 bg-white"
          title={file.title}
        />
      </BinaryViewerFrame>
    );
  }

  if (viewerKind === "image" || viewerKind === "svg") {
    return (
      <BinaryViewerFrame file={file}>
        <div className="flex h-full w-full items-center justify-center overflow-auto bg-black/40 p-4">
          <img
            src={assetUrl}
            alt={file.title}
            className="max-h-full max-w-full object-contain shadow-[0_4px_24px_-8px_rgba(0,0,0,0.6)]"
            loading="lazy"
          />
        </div>
      </BinaryViewerFrame>
    );
  }

  if (viewerKind === "video") {
    return (
      <BinaryViewerFrame file={file}>
        <div className="flex h-full w-full items-center justify-center bg-black/60 p-4">
          <video
            src={assetUrl}
            controls
            className="max-h-full max-w-full"
          />
        </div>
      </BinaryViewerFrame>
    );
  }

  if (viewerKind === "audio") {
    return (
      <BinaryViewerFrame file={file}>
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black/20 p-8">
          <FileText className="h-12 w-12 text-muted-foreground" aria-hidden />
          <p className="truncate text-sm text-muted-foreground" title={file.path}>
            {file.title}
          </p>
          <audio src={assetUrl} controls className="w-full max-w-md" />
        </div>
      </BinaryViewerFrame>
    );
  }

  // 未到達だが型安全のため
  return (
    <BinaryViewerFrame file={file}>
      <UnsupportedFallback file={file} />
    </BinaryViewerFrame>
  );
}

/**
 * バイナリビューワの共通フレーム。ファイルパス表示 + 「別アプリで開く」ボタン。
 * Monaco は独自の UI を持つため使わない。
 */
function BinaryViewerFrame({
  file,
  children,
}: {
  file: { path: string; title: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/40 bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <ImageIcon className="h-3 w-3" aria-hidden />
        <span className="truncate" title={file.path}>
          {file.path}
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function UnsupportedFallback({
  file,
}: {
  file: { path: string; title: string };
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm">このファイル形式は直接表示できません</p>
      <p className="truncate text-[11px] text-muted-foreground" title={file.path}>
        {file.path}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          // Tauri shell の open API を動的 import
          void import("@tauri-apps/plugin-shell").then(({ open }) =>
            open(file.path).catch(() => {})
          );
        }}
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        別アプリで開く
      </Button>
    </div>
  );
}
