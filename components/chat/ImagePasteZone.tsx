"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";

/**
 * PM-140: Ctrl/Cmd+V でクリップボード画像を取り込む透明レイヤー（hook のみ）。
 *
 * Tauri backend の `save_clipboard_image` command を invoke し、保存された
 * ローカル PNG の絶対パスを Zustand store に attachment として追加する。
 *
 * 注: `react-hotkeys-hook` の `useHotkeys` は DOM 全体で capture するため、
 * チャット入力欄にフォーカスがあっても発火する。input 欄内での通常 paste を
 * 阻害したくないので、event.preventDefault() は明示呼出しない（enableOnFormTags
 * を true にして browser デフォルトと共存、クリップボードに画像がある場合だけ
 * sidecar 経由保存、画像がなければ何もせずテキスト paste が通る）。
 */
export function ImagePasteZone() {
  const appendAttachment = useChatStore((s) => s.appendAttachment);

  useHotkeys(
    "ctrl+v, meta+v",
    async () => {
      try {
        const savedPath = await callTauri<string | null>(
          "save_clipboard_image"
        );
        if (!savedPath) return; // クリップボードに画像なし → 何もしない
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        appendAttachment({ id, path: savedPath });
        toast.success("画像を添付しました");
      } catch (e) {
        toast.error(
          `画像の取り込みに失敗しました: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    },
    { enableOnFormTags: true, enableOnContentEditable: true }
  );

  return null;
}
