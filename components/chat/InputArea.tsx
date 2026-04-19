"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Send, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageThumb } from "@/components/chat/ImageThumb";
import { SlashPalette } from "@/components/palette/SlashPalette";
import { useChatStore, type Attachment } from "@/lib/stores/chat";
import { callTauri } from "@/lib/tauri-api";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { cn } from "@/lib/utils";
import type { SlashCmd } from "@/lib/types";

/**
 * PM-132 / PM-142 / PM-143 / PM-201: 送信入力欄。
 *
 * - Textarea + 送信ボタン、Ctrl/Cmd+Enter で送信
 * - onDrop で D&D 画像（先頭 1 枚）を `$APPLOCALDATA/ccmux-images/` に保存し attachment 追加
 * - 送信時、attachment があれば prompt 末尾に `@"<path>"` 形式で注入（DEC-011 継承）
 * - 送信完了後は画像のみクリア（メッセージ履歴は残す）
 * - `/` で始まる最後のトークン（空白/改行区切り）検出時に SlashPalette を開き、
 *   選択された slash を該当トークンに置換（末尾に空白を足してカーソル続行）
 * - SlashPalette 表示中は Ctrl+Enter 送信を抑止（slash 選択を優先）
 */
export function InputArea() {
  const attachments = useChatStore((s) => s.attachments);
  const appendAttachment = useChatStore((s) => s.appendAttachment);
  const clearAttachments = useChatStore((s) => s.clearAttachments);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const streaming = useChatStore((s) => s.streaming);

  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  // slash クエリは textarea の onChange / onKeyUp / onClick 時に再計算する
  const [slashQuery, setSlashQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /** 現在の caret で slash 断片を再評価して state に反映する。 */
  function recomputeSlashAt(value: string, caret: number) {
    const m = detectSlashFragment(value, caret);
    if (m) {
      setSlashQuery(m.query);
      setSlashOpen(true);
    } else {
      setSlashOpen(false);
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}`;

    // PM-143: 送信 prompt 組立。attachment があれば `@"<path>"` で改行区切り追記。
    const prompt =
      attachments.length > 0
        ? `${trimmed}\n\n${attachments.map((a) => `@"${a.path}"`).join("\n")}`
        : trimmed;

    // 画面には user message を添付画像付きで即追加（prompt は裏で sidecar へ）
    appendMessage({
      id: `${id}:u`,
      role: "user",
      content: trimmed,
      attachments: [...attachments],
    });
    setText("");
    setStreaming(true);

    try {
      await callTauri<void>("send_agent_prompt", { id, prompt });
      clearAttachments();
    } catch (e) {
      toast.error(`送信に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setStreaming(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // SlashPalette が開いている間は Ctrl+Enter 送信を抑制。
    // cmdk が Arrow / Enter を受けて選択するため、ここでは Escape だけ
    // 独自にハンドルする（Radix Popover が外側 Escape を取りこぼすことがあるため）。
    if (slashOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // palette を閉じてから送信する（ユーザーが意図的に Ctrl+Enter するため）
        setSlashOpen(false);
        e.preventDefault();
        void handleSend();
        return;
      }
      // Enter 単体 / Arrow は cmdk に任せる（cmdk が listbox として handle）
      return;
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setText(next);
    const caret = e.target.selectionStart ?? next.length;
    recomputeSlashAt(next, caret);
  }

  /**
   * caret 移動（矢印キー / クリック）時にも slash 状態を追従させる。
   * Arrow キーで `/ceo` トークンから離れたら palette を閉じたい。
   */
  function onCaretMove(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    recomputeSlashAt(ta.value, ta.selectionStart ?? ta.value.length);
  }

  /**
   * slash 選択時のコールバック。現在の `/token` 断片を選択された slash に置換し、
   * 末尾に空白を付けてカーソルを続行可能な位置に移動する。
   */
  function onSlashSelect(cmd: SlashCmd) {
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const replaced = replaceSlashFragment(text, caret, cmd.name);
    setText(replaced.text);
    setSlashOpen(false);

    // カーソル位置を更新（次の micro tick で textarea の selection を書き換え）
    queueMicrotask(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(replaced.caret, replaced.caret);
    });
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    // v3 制約: 先頭 1 枚のみ
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルのみドロップできます");
      return;
    }
    try {
      const saved = await saveDroppedImage(file);
      appendAttachment(saved);
      toast.success("画像を添付しました");
    } catch (err) {
      toast.error(
        `画像の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "border-t bg-background transition-colors",
        dragOver && "bg-primary/5 ring-2 ring-inset ring-primary/40"
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-border/60 p-2">
            <Paperclip
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            {attachments.map((a) => (
              <ImageThumb key={a.id} attachment={a} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div ref={wrapperRef} className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={onTextChange}
              onKeyDown={onKeyDown}
              onKeyUp={onCaretMove}
              onClick={onCaretMove}
              placeholder={
                streaming
                  ? "Claude が考え中です..."
                  : "メッセージを入力（Ctrl+Enter で送信、/ でコマンド、画像は D&D または Ctrl+V）"
              }
              disabled={streaming}
              rows={3}
              className="min-h-[72px] resize-none"
            />
            <SlashPalette
              open={slashOpen}
              query={slashQuery}
              onClose={() => setSlashOpen(false)}
              onSelect={onSlashSelect}
              anchorRef={wrapperRef}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={streaming || !text.trim()}
            className="h-10 shrink-0"
            aria-label="送信"
          >
            <Send className="h-4 w-4" aria-hidden />
            <span className="ml-1 hidden sm:inline">送信</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * D&D 画像を OS 一時領域にコピー保存する。
 *
 * 保存先は `$APPLOCALDATA/ccmux-images/dnd-<timestamp>-<uuid>.<ext>`。
 * plugin-fs の `writeFile` で Uint8Array をそのまま書き出す。
 */
async function saveDroppedImage(file: File): Promise<Attachment> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const base = await appLocalDataDir();
  const dir = await join(base, "ccmux-images");
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = `dnd-${Date.now()}-${id}.${ext}`;
  const path = await join(dir, filename);
  await writeFile(path, buf);
  return { id, path };
}

// ---------------------------------------------------------------------------
// slash detection / replacement helpers（純関数、テスト容易化のため export 無しで留置）
// ---------------------------------------------------------------------------

export interface SlashMatch {
  /** `/` を含まないクエリ（`/ce` なら `ce`、`/` 単独なら ""） */
  query: string;
  /** 置換対象の開始 index（textarea 全体内の `/` の位置） */
  start: number;
  /** 置換対象の終了 index（caret 位置、exclusive） */
  end: number;
}

/**
 * caret 左方向に slash トークンを探す。
 *
 * 条件:
 *  - caret 直前の連続非空白文字列が `/` で始まる
 *  - その `/` の直前が「行頭」「空白」「改行」のいずれか（URL 中の `/` を誤検出しない）
 */
export function detectSlashFragment(
  text: string,
  caret: number
): SlashMatch | null {
  if (caret <= 0) return null;
  const left = text.slice(0, caret);
  // 左方向に空白 / 改行まで後退
  let i = left.length - 1;
  while (i >= 0) {
    const c = left[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\u3000") {
      break;
    }
    i--;
  }
  const tokenStart = i + 1;
  const token = left.slice(tokenStart);
  if (!token.startsWith("/")) return null;
  // トークン内部に更に `/` が含まれる場合（例: `a/b`）は URL/path 系なのでスキップ。
  // ただし `/` 単独 or `/ceo` 等、`/` が先頭のみなら許容。
  const innerSlashIdx = token.indexOf("/", 1);
  if (innerSlashIdx !== -1) return null;
  const query = token.slice(1);
  return { query, start: tokenStart, end: caret };
}

/**
 * `detectSlashFragment` で検出された範囲を新しい slash 名 + 空白で置換する。
 *
 * 選択後のカーソルは置換後の空白の**直後**に配置する。
 */
export function replaceSlashFragment(
  text: string,
  caret: number,
  newSlash: string
): { text: string; caret: number } {
  const match = detectSlashFragment(text, caret);
  if (!match) {
    // fallback: caret 位置にそのまま挿入
    const inserted = `${text.slice(0, caret)}${newSlash} ${text.slice(caret)}`;
    return { text: inserted, caret: caret + newSlash.length + 1 };
  }
  const before = text.slice(0, match.start);
  const after = text.slice(match.end);
  // 末尾に空白を足して caret 続行
  const replacement = `${newSlash} `;
  const nextText = `${before}${replacement}${after}`;
  const nextCaret = match.start + replacement.length;
  return { text: nextText, caret: nextCaret };
}
