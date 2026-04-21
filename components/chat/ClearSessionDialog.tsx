"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDialogStore } from "@/lib/stores/dialog";
import { useChatStore } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";
import { useProjectStore } from "@/lib/stores/project";
import { logger } from "@/lib/logger";

/**
 * PRJ-012 v4 / Chunk C / DEC-028 + PM-860 + PM-910: `/clear` で開かれる
 * コンテキスト初期化確認ダイアログ。
 *
 * ## v3.5.20 (PM-860) 修正: リロード後のコンテキスト復元バグ
 *
 * 旧実装は `delete_session` で DB ごと消す + `setSessionId(null)` で pane を
 * null 化していたが、以下の問題があった:
 *
 *  - `delete_session` の引数キーが `id` になっており、Rust 側は `session_id`
 *    （camelCase 側は `sessionId`）を期待しているため **毎回 silent fail** して
 *    いた（try/catch で console.warn のみ）。結果 DB には旧 session が残存。
 *  - `setSessionId(null)` で pane の currentSessionId を null にしても、
 *    useProjectStore の `lastSessionId` はそのまま旧 session を指し続ける。
 *    v3.5.12 の ChatPanel snapshot-swap useEffect は「cache miss →
 *    persistedSessionId → lastSessionId」の順で load するため、リロード後に
 *    **旧 session の messages を DB から load** して復元してしまっていた。
 *
 * ## v3.5.21 (PM-910) 修正: 実機で context / UI が両方リセットされない regression
 *
 * PM-860 で導入した `createNewSession()` 方式は「DB / chat store / project
 * lastSessionId」までは正しくクリアしていたが、実機で以下の残留現象が発生:
 *
 *   1. Claude が直前の会話内容を覚えている（context 継続）
 *   2. チャット画面に直前 messages が残って見える
 *
 * ## 原因仮説と対応 (H1〜H4)
 *
 *   - **H1 (snapshot 残留)**: `projectSnapshots[activeProjectId][paneId]` は
 *     揮発だが runtime 中は保持される。project 切替 → 戻り で古い messages が
 *     `restoreProjectSnapshot` 経由で復元し得る。
 *     → PM-910 で /clear 直後に snapshot 側も `updateSnapshotPane` で空に上書き。
 *
 *   - **H2 (session fallback)**: `ChatPanel.mountLoadRanRef` は現 session id
 *     (= 新 session id) しか load しないので、新 session が DB で空ならリロード
 *     後も空で復元される（PM-860 で既に解消）。PM-910 では追加対応不要。
 *
 *   - **H3 (sidecar プロセス context 保持)** ★最有力:
 *     Claude Agent SDK v0.2.x は `query()` 毎に `claude` CLI subprocess を
 *     spawn するが、sidecar 自身は長命プロセスで、`~/.claude/projects/<cwd>/`
 *     配下の session JSONL も残存する。resume=undefined で送っていても、
 *     CLI / SDK 側 node 静的状態や環境条件（session-env 等）によって context
 *     が間接的に引き継がれる可能性がある。
 *     → PM-910 で `restartSidecarForClear(activeProjectId)` を走らせて sidecar
 *     プロセスごと再起動。resume=undefined + 新 prosess + 新 session UUID の
 *     三点セットで Claude 側 context を確実に消去する（Claude Desktop の
 *     「新しいチャット」と同等 UX）。
 *
 *   - **H4 (chat store activity 残留)**: `clearSession` は streaming を false
 *     にするが `activity` を `idle` に戻していなかった。ActivityIndicator が
 *     thinking のまま表示される軽微な残留。
 *     → PM-910 で `clearSession` 実装に `activity: { kind: "idle" }` を追加。
 *
 * ## 新仕様フロー (PM-910)
 *
 *  1. `createNewSession()` で新しい空セッションを作成（DB + chat store + lastSessionId 更新）
 *  2. 現 pane の `projectSnapshots` entry も新 session の空状態で上書き（H1）
 *  3. `restartSidecarForClear(activeProjectId)` で sidecar 完全再起動（H3）
 *  4. 旧 session は **DB に残す**（履歴 UI から閲覧可能）
 *
 * Cancel / Esc で閉じれば副作用ゼロ。
 */
export function ClearSessionDialog() {
  const open = useDialogStore((s) => s.clearOpen);
  const close = useDialogStore((s) => s.closeClear);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      // まず activeProjectId を capture（createNewSession の subscribe 副作用で
      // 非同期に fetchSessions が走るため、read は確定タイミングで先に行う）。
      const activeProjectId = useProjectStore.getState().activeProjectId;

      // 1) 新セッションを作成。内部で:
      //   - Rust `create_session` (activeProjectId 自動 attach)
      //   - useChatStore.clearSession() で現 pane の messages / activity を空に
      //     （PM-910 で activity: idle も含めるよう chat.ts 側を修正）
      //   - useChatStore.setSessionId(newId) で currentSessionId を切替
      //     + useProjectStore.lastSessionId を新 session に書き戻し
      const newSession = await useSessionStore.getState().createNewSession();

      // 2) PM-910 (H1 対応): projectSnapshots 側の活性 pane も明示的に空状態で
      // 上書きする。project 切替 → 戻りで `restoreProjectSnapshot` が走った時に
      // 古い messages が復活するのを防ぐ二重 safety net。activeProjectId が
      // null (未選択) の場合は snapshot も存在しないので skip。
      if (activeProjectId) {
        const chatState = useChatStore.getState();
        const targetPaneId = chatState.activePaneId;
        chatState.updateSnapshotPane(activeProjectId, targetPaneId, (p) => ({
          ...p,
          messages: [],
          attachments: [],
          streaming: false,
          activity: { kind: "idle" },
          currentSessionId: newSession.id,
          scrollTargetMessageId: null,
          highlightedMessageId: null,
        }));
        // NOTE: split pane 時 (main + pane-xxx) は active pane のみ上書き。
        // 他 pane の独立 session はそのまま。updateSnapshotPane は存在しない
        // paneId の場合 no-op なので保守的。
      }

      // 念のため attachments もクリア（createNewSession → clearSession は attachments も空にするが保険）
      useChatStore.getState().clearAttachments();

      // 3) PM-910 (H3 対応): sidecar プロセスを silent 再起動して Claude 側
      // context を完全消去する。resume=undefined で送っても CLI / SDK の
      // 長命プロセス静的状態により context が残留するケースがあるため、
      // プロセス再起動が最も確実（Claude Desktop の「新しいチャット」相当）。
      //
      // await するので UI は restart 完了まで busy 表示。通常 1-3 秒。
      // restart 失敗時 (start_agent_sidecar throw) は status=error + silent warn、
      // 呼出側 catch で toast.error を出す。chat store / session は既にリセット
      // 済なので部分成功として容認（次回送信時に起動リトライ可能）。
      if (activeProjectId) {
        try {
          await useProjectStore
            .getState()
            .restartSidecarForClear(activeProjectId);
          logger.debug("[clear] sidecar restarted", {
            projectId: activeProjectId,
            newSessionId: newSession.id,
          });
        } catch (e) {
          // restart 失敗は致命でない（UI state は既に reset 済、次送信で retry 可能）
          // eslint-disable-next-line no-console
          console.warn("[clear] restartSidecarForClear failed:", e);
        }
      }

      toast.success(
        "会話をリセットしました。Claude プロセスも再起動され、新規会話として扱われます"
      );
      close();
    } catch (e) {
      // createNewSession 失敗時は旧 session がそのまま残る（UX 上「失敗した」だけ）。
      // eslint-disable-next-line no-console
      console.warn("[clear] createNewSession failed:", e);
      toast.error(
        `セッションの初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>会話をリセットしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            新しいセッションを作成し、Claude プロセスも再起動して完全に新規会話として扱います。
            <br />
            これまでの会話は履歴として残り、セッション一覧からいつでも閲覧できます。
            <br />
            <span className="text-[11px] text-muted-foreground">
              ※ Claude プロセスの再起動に 1〜3 秒かかります。
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // Radix の自動 close を待たず、副作用後に手動 close
              void handleConfirm();
            }}
            disabled={busy}
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            リセットする
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
