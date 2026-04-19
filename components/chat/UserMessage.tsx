"use client";

import { Card } from "@/components/ui/card";
import type { ChatMessage } from "@/lib/stores/chat";
import { ImageThumb } from "@/components/chat/ImageThumb";

/**
 * PM-132: ユーザー送信メッセージ。右寄せ / max-w-[75%] の吹き出し。
 * 添付画像は下部にサムネ列で表示する（削除不可、既送信のため）。
 */
export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <Card className="max-w-[75%] bg-primary p-3 text-primary-foreground shadow-sm">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {message.content}
        </p>
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <ImageThumb key={a.id} attachment={a} readOnly />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
