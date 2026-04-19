"use client";

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Copy, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useChatStore, type Attachment } from "@/lib/stores/chat";
import { getImageMeta, type ImageMeta } from "@/lib/image-utils";
import { cn } from "@/lib/utils";

export interface ImagePreviewDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  attachment: Attachment | null;
}

/**
 * PRJ-012 Round E1: 貼付画像の full-size Lightbox。
 *
 * shadcn Dialog ベース。ESC / 背景 click で close（Dialog 標準挙動）。
 * 送信前の画像確認 UX を改善するため:
 *   - 上部: basename + path コピーボタン
 *   - 中央: `object-contain` + `max-h-[80vh]` で縦長画像も全体表示
 *   - 下部: full path / file size / 寸法（`getImageMeta` で best-effort 取得）
 *   - 右下: 削除 / 閉じる
 *
 * `attachment` が null の間はマウント状態でも何も fetch しない（open 直前に
 * null → 実体へ切り替わる遷移でも安全）。
 */
export function ImagePreviewDialog({
  open,
  onOpenChange,
  attachment,
}: ImagePreviewDialogProps) {
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const [src, setSrc] = useState<string>("");
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !attachment) {
      setSrc("");
      setMeta(null);
      setCopied(false);
      return;
    }
    try {
      setSrc(attachment.preview ?? convertFileSrc(attachment.path));
    } catch {
      setSrc("");
    }

    let cancelled = false;
    (async () => {
      try {
        const m = await getImageMeta(attachment.path);
        if (!cancelled) setMeta(m);
      } catch {
        // getImageMeta 自体は reject しない設計だが、保険で握り潰す
        if (!cancelled) setMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attachment]);

  async function onCopyPath() {
    if (!attachment) return;
    try {
      await navigator.clipboard.writeText(attachment.path);
      setCopied(true);
      toast.success("パスをコピーしました");
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error(
        `コピーに失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  function onDelete() {
    if (!attachment) return;
    removeAttachment(attachment.id);
    onOpenChange(false);
    toast.success("画像を削除しました");
  }

  const fileName = meta?.fileName ?? attachment?.path.split(/[\\/]/).pop() ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Lightbox 用途のため max-width を Dialog デフォルトより広げる
        className="max-w-[95vw] gap-3 sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="truncate" title={fileName}>
              画像プレビュー: {fileName || "(名前なし)"}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onCopyPath}
              aria-label="パスをコピー"
              className="h-6 w-6 shrink-0"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </DialogTitle>
          <DialogDescription className="sr-only">
            添付画像のプレビュー。ESC キーまたは背景クリックで閉じます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center rounded-md border bg-muted/30 p-2">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={fileName || "attachment"}
              className={cn(
                "block max-h-[70vh] max-w-full object-contain",
                // Lightbox なので最大サイズは viewport 基準に揃える
                "sm:max-h-[70vh]"
              )}
            />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              画像を読み込めませんでした
            </div>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {meta?.fileSizeHuman ? (
              <span>
                サイズ: <span className="font-mono">{meta.fileSizeHuman}</span>
              </span>
            ) : null}
            {typeof meta?.width === "number" &&
            typeof meta?.height === "number" ? (
              <span>
                寸法:{" "}
                <span className="font-mono">
                  {meta.width} × {meta.height}
                </span>
              </span>
            ) : null}
          </div>
          <div className="break-all font-mono text-[11px]">
            {attachment?.path ?? ""}
          </div>
          {meta?.loadError ? (
            <div className="text-[11px] text-amber-600 dark:text-amber-500">
              メタ情報の一部を取得できませんでした
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={!attachment}
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden />
            削除
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
