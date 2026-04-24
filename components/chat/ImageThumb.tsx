"use client";

import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Maximize2, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { ImagePreviewDialog } from "@/components/chat/ImagePreviewDialog";
import { useChatStore, type Attachment } from "@/lib/stores/chat";
import {
  extractFileName,
  getImageMeta,
  type ImageMeta,
} from "@/lib/image-utils";
import { cn } from "@/lib/utils";

export interface ImageThumbProps {
  attachment: Attachment;
  /** true の場合、削除ボタンを表示しない（送信済みメッセージ用） */
  readOnly?: boolean;
  className?: string;
  /**
   * v1.18.0 (DEC-064): attachments が所属する session id。削除ボタン押下時に
   * `removeAttachment(sessionId, attachmentId)` を呼ぶために必要。省略時は
   * active pane の currentSessionId から解決する。
   */
  sessionId?: string | null;
}

/** hover Popover の誤発火防止 delay (ms)。 */
const HOVER_DELAY_MS = 200;

/**
 * PM-141 / Round E1: 入力欄下の画像サムネ。
 *
 * Tauri の `convertFileSrc` でローカル絶対パスを webview で参照可能な URL
 * （`asset://...` / `tauri://localhost/...`）に変換する。
 *
 * Round E1 追加:
 *   - hover で 240px preview + ファイル名 + サイズを Popover 表示
 *     （200ms delay で誤発火防止、basename のみ表示で path 漏洩回避）
 *   - click で full-size Lightbox (`ImagePreviewDialog`) を open
 *   - hover 中は右上に `Maximize2` icon を overlay（「拡大」ヒント）
 *   - 既存の × 削除ボタンと `convertFileSrc` は維持
 */
export function ImageThumb({
  attachment,
  readOnly,
  className,
  sessionId,
}: ImageThumbProps) {
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  // v1.18.0: sessionId 未指定時は active pane の currentSessionId を fallback。
  const fallbackSessionId = useChatStore((s) => {
    const pid = s.activePaneId;
    return s.panes[pid]?.currentSessionId ?? null;
  });
  const [src, setSrc] = useState<string>(attachment.preview ?? "");

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaLoadedRef = useRef<string | null>(null);

  const fileName = extractFileName(attachment.path);

  useEffect(() => {
    if (attachment.preview) {
      setSrc(attachment.preview);
      return;
    }
    try {
      setSrc(convertFileSrc(attachment.path));
    } catch {
      setSrc("");
    }
  }, [attachment.path, attachment.preview]);

  // hover または dialog で meta が要求されたら 1 回だけ fetch（path 変化時は再取得）。
  useEffect(() => {
    if (!popoverOpen && !dialogOpen) return;
    if (metaLoadedRef.current === attachment.path) return;
    let cancelled = false;
    (async () => {
      const m = await getImageMeta(attachment.path);
      if (!cancelled) {
        setMeta(m);
        metaLoadedRef.current = attachment.path;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [popoverOpen, dialogOpen, attachment.path]);

  function clearHoverTimer() {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function onMouseEnter() {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setPopoverOpen(true);
    }, HOVER_DELAY_MS);
  }

  function onMouseLeave() {
    clearHoverTimer();
    setPopoverOpen(false);
  }

  useEffect(() => {
    return () => clearHoverTimer();
  }, []);

  function onClickThumb() {
    // click で Lightbox を開く（Popover は閉じる）
    setPopoverOpen(false);
    setDialogOpen(true);
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverAnchor asChild>
          {/* button-in-button を避けるため外側は div にし、click / keyboard を手動ハンドル */}
          <div
            role="button"
            tabIndex={0}
            onClick={onClickThumb}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClickThumb();
              }
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={onMouseEnter}
            onBlur={onMouseLeave}
            aria-label={`画像プレビュー: ${fileName}`}
            className={cn(
              "group relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded border border-border bg-muted",
              "transition-[transform,box-shadow] hover:scale-[1.03] hover:shadow-md",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className
            )}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={fileName || "attachment"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                img
              </span>
            )}
            {/* hover 時に「拡大」オーバーレイ */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 flex items-start justify-end bg-black/0 p-0.5 text-white opacity-0 transition",
                "group-hover:bg-black/25 group-hover:opacity-100",
                "group-focus-visible:bg-black/25 group-focus-visible:opacity-100"
              )}
            >
              <Maximize2 className="h-3 w-3 drop-shadow" />
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const sid = sessionId ?? fallbackSessionId;
                  if (sid) {
                    removeAttachment(sid, attachment.id);
                  }
                }}
                aria-label="画像を削除"
                className={cn(
                  "absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full",
                  "bg-destructive text-destructive-foreground shadow",
                  "hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring"
                )}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          // hover 中のみ表示する想定なので pointer event は無効化し、
          // focus は trigger 側に留める（Radix default の auto-focus を止める）
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-[260px] p-2"
        >
          <div
            className="flex flex-col gap-2"
            // popover 自体への hover でも開き続けられるよう enter/leave を統一
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
          >
            <div className="h-60 w-60 overflow-hidden rounded border bg-muted">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={fileName || "attachment"}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  画像を読み込めません
                </div>
              )}
            </div>
            <div className="space-y-0.5 text-xs">
              <div className="truncate font-medium" title={fileName}>
                {fileName || "(名前なし)"}
              </div>
              <div className="text-muted-foreground">
                {meta?.fileSizeHuman ? (
                  <span className="font-mono">{meta.fileSizeHuman}</span>
                ) : (
                  <span className="italic">サイズ計測中...</span>
                )}
                {typeof meta?.width === "number" &&
                typeof meta?.height === "number" ? (
                  <span className="ml-2 font-mono">
                    {meta.width} × {meta.height}
                  </span>
                ) : null}
              </div>
              <div className="pt-1 text-[10px] text-muted-foreground">
                クリックで拡大
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <ImagePreviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        attachment={attachment}
        sessionId={sessionId ?? fallbackSessionId}
      />
    </>
  );
}
