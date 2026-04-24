"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { callTauri } from "@/lib/tauri-api";
import { useChatStore, DEFAULT_PANE_ID } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";

/**
 * PM-140: Ctrl/Cmd+V でクリップボード画像を取り込む透明レイヤー（hook のみ）。
 *
 * v3.5 Chunk B (Split Sessions): `paneId` prop を受け、当該 pane の attachments
 * に追加する。複数 pane 表示時でも paste 先は「Ctrl+V を捕まえた pane」= props
 * で明示された pane に確定し、active pane ではない側の pane でも直接 paste 可能
 * にする（将来 pane 内に focus-scoped hotkey を配る拡張で役立つ）。
 *
 * 現状は各 pane に ImagePasteZone を 1 個ずつ mount すると ctrl+v が重複 fire
 * してしまう（react-hotkeys-hook は DOM 全体で capture）ため、v3.5 Step 1 では
 * Shell で 1 個だけ mount し、常に activePane に add する設計にする。
 *
 * 注: `react-hotkeys-hook` の `useHotkeys` は DOM 全体で capture するため、
 * チャット入力欄にフォーカスがあっても発火する。input 欄内での通常 paste を
 * 阻害したくないので、event.preventDefault() は明示呼出しない（enableOnFormTags
 * を true にして browser デフォルトと共存、クリップボードに画像がある場合だけ
 * sidecar 経由保存、画像がなければ何もせずテキスト paste が通る）。
 */
export function ImagePasteZone({
  paneId = DEFAULT_PANE_ID,
}: {
  paneId?: string;
}) {
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
        // v1.18.0 (DEC-064): attachments は session 単位。当該 pane が現在
        // 表示している session に対して append する。session 未選択なら
        // 新規セッションを作って attach する（InputArea の drop と同じ挙動）。
        let sid =
          useChatStore.getState().panes[paneId]?.currentSessionId ?? null;
        if (!sid) {
          try {
            const session = await useSessionStore.getState().createNewSession();
            sid = session.id;
            useChatStore.getState().setPaneSession(paneId, sid);
          } catch (err) {
            toast.error(
              `セッション作成に失敗しました: ${err instanceof Error ? err.message : String(err)}`
            );
            return;
          }
        }
        useChatStore.getState().appendAttachment(sid, { id, path: savedPath });
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
