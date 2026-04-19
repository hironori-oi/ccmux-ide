"use client";

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore, type Attachment } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

export interface ImageThumbProps {
  attachment: Attachment;
  /** true の場合、削除ボタンを表示しない（送信済みメッセージ用） */
  readOnly?: boolean;
  className?: string;
}

/**
 * PM-141: 入力欄下の画像サムネ。
 *
 * Tauri の `convertFileSrc` でローカル絶対パスを webview で参照可能な URL
 * （`asset://...` / `tauri://localhost/...`）に変換する。
 */
export function ImageThumb({ attachment, readOnly, className }: ImageThumbProps) {
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const [src, setSrc] = useState<string>(attachment.preview ?? "");

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

  return (
    <div
      className={cn(
        "relative h-12 w-12 shrink-0 overflow-hidden rounded border border-border bg-muted",
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={attachment.path.split(/[\\/]/).pop() ?? "attachment"}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          img
        </div>
      )}
      {!readOnly && (
        <Button
          type="button"
          size="icon"
          variant="destructive"
          onClick={() => removeAttachment(attachment.id)}
          aria-label="画像を削除"
          className="absolute -right-1 -top-1 h-4 w-4 rounded-full p-0 [&_svg]:size-3"
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
