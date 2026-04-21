"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useChatStore, DEFAULT_PANE_ID } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import { ChatPaneHeader } from "@/components/chat/ChatPaneHeader";
import { MessageList } from "@/components/chat/MessageList";
import { InputArea } from "@/components/chat/InputArea";
import { ActivityIndicator } from "@/components/chat/ActivityIndicator";

/**
 * PM-132 + v5 Chunk C (DEC-030) + v3.3 Chunk B (DEC-033) + v3.5 Chunk B (Split
 * Sessions) + v3.5.11 Chunk E (Cross-Project Events): チャット画面の親コンポーネント。
 *
 * ## v3.5 Chunk B (Split Sessions)
 *
 * 1 project 内で複数の session を左右分割で同時表示するため、本 component を
 * pane 単位（`paneId` prop）で instance 化する。
 *
 *  - `paneId` を chat store の action に第 1 引数として渡す
 *  - `messages` / `streaming` / `activity` / `currentSessionId` も pane state
 *    から読む（singleton getter は使わない）
 *
 * ## v3.5.11 Chunk E (Cross-Project Events) — 重要な設計変更
 *
 * 旧実装は本 component 内で `agent:${activeProjectId}:raw` を listen していた
 * が、project 切替で listener が unlisten → 再登録される構造のため、**前 project
 * の sidecar event を誰も受け取らない**致命バグが発生していた（Claude 思考中に
 * 切替えると thinking が永久 stuck）。
 *
 * v3.5.11 では sidecar event listener を `Shell` の
 * `useAllProjectsSidecarListener()` に集約し、**全 project の event を常時購読**
 * する設計に変更。本 component は sidecar event を直接購読しない。
 *
 * - active project の event → `panes` を update（live UI に即反映）
 * - 非 active project の event → `projectSnapshots[projectId]` を update
 *   （戻ってきた瞬間に restoreProjectSnapshot で最新状態が復元）
 *
 * 結果: project 切替後も前 project の thinking → tool_use → streaming → complete
 * が正しく遷移し、ProjectRail の activity dot も独立に動き続ける。
 *
 * ### session swap（pane ごとに独立）
 *
 * activeProjectId の変化で、自 pane の currentSessionId を project の
 * lastSessionId から load or clear する処理は active pane のみ行う。
 * inactive pane は自分の session を保持したまま（ユーザが明示切替するまで）。
 */
export function ChatPanel({
  paneId = DEFAULT_PANE_ID,
  canClose = false,
  showHeader = false,
}: {
  paneId?: string;
  /** pane を閉じられるか（分割中のみ true） */
  canClose?: boolean;
  /** pane ヘッダを表示するか（1 pane 時は不要） */
  showHeader?: boolean;
}) {
  // v3.5.11 Chunk E: sidecar event listener は Shell の
  // useAllProjectsSidecarListener に集約済。本 component は chat store の
  // panes / projectSnapshots を購読する subscriber でしかない。
  const activePaneId = useChatStore((s) => s.activePaneId);

  const isActivePane = activePaneId === paneId;

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("プロジェクト未選択");

  // v5 Chunk C: activeProjectId の変化を購読し、chat / session のスワップを行う。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const sidecarStatusForActive = useProjectStore((s) =>
    s.activeProjectId ? s.sidecarStatus[s.activeProjectId] ?? "stopped" : "stopped"
  );
  const reduceMotion = useReducedMotion();

  // ref 版 isActivePane（listener 内でも最新値を参照するため）
  const isActiveRef = useRef(isActivePane);
  useEffect(() => {
    isActiveRef.current = isActivePane;
  }, [isActivePane]);

  // -------------------------------------------------------------------------
  // v3.5.11 Chunk E: sidecar event listener は Shell の
  // useAllProjectsSidecarListener() に集約済。本 component には listener が無い。
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // sidecar status 表示（共有 status なので pane 全部で同じ見た目にする）
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeProjectId) {
      setReady(false);
      setStatus("プロジェクト未選択");
      return;
    }
    switch (sidecarStatusForActive) {
      case "running":
        setReady(true);
        setStatus("Claude と接続中");
        break;
      case "starting":
        setReady(false);
        setStatus("Claude を起動中...");
        break;
      case "stopping":
        setReady(false);
        setStatus("Claude を停止中...");
        break;
      case "error":
        setReady(false);
        setStatus("sidecar 起動失敗（プロジェクトを選び直してください）");
        break;
      case "stopped":
      default:
        setReady(false);
        setStatus("Claude 未起動");
        break;
    }
  }, [activeProjectId, sidecarStatusForActive]);

  // ---------------------------------------------------------------------------
  // v5 Chunk C (DEC-030) + v3.5 Chunk B + v3.5.9 Chunk D (Project Switch History):
  // activeProjectId 変化時の pane state スワップ。
  //
  // ## v3.5.9 Chunk D 前の挙動（= この component の改修前）
  //
  // 自 pane の currentSessionId を「次 project の lastSessionId」から load or
  // clear するだけ。前 project のために `updateProject({ lastSessionId })` を
  // write back していたが、messages / streaming / activity は
  // loadSession 経由で「DB に保存された messages」のみが復元される。
  //
  // 問題: session swap と loadSession の間に数百ms のタイムラグがあり、その
  // 間画面が空に見える。また streaming 途中で project を切替えた場合、戻って
  // きたときに「途中まで流れ込んでいた streaming message」が消え、DB の確定
  // メッセージのみに置き換わる（= 体感「会話が消えた」）。
  //
  // ## v3.5.9 Chunk D の挙動
  //
  // 1. project 切替 **直前** に現在 `panes` を projectSnapshots[prev] に save
  // 2. 切替 **直後** に projectSnapshots[next] を panes に restore（cache hit 時
  //    は瞬時に復元、streaming message もそのまま残る）
  // 3. cache hit の場合でも、裏で lastSessionId から loadSession を走らせ、
  //    DB 由来の最新 messages で上書き（snapshot に入っていなかった他 pane の
  //    更新や、裏で sidecar が生成し続けたメッセージをマージ）
  // 4. cache miss の場合は panes を初期化 → 既存経路 (lastSessionId → load) で
  //    DB から復元
  //
  // ## 競合回避
  //
  // saveProjectSnapshot / restoreProjectSnapshot は **chat store 全体** に
  // 作用する（panes map 全体）。複数 pane が同時に orchestrate すると二重 save/
  // restore が走るため、active pane のみが実行する（旧実装と同じ guard）。
  // inactive pane の session swap (= `updateProject({ lastSessionId })` + load)
  // も active pane 1 回だけ走らせる設計で一貫。
  // ---------------------------------------------------------------------------
  // PM-810 hotfix (2026-04-20): 初回 mount & addPane 直後の snapshot swap 誤爆対策。
  //
  // 根本: `prevActiveProjectIdRef` 初期値 null のまま useEffect 初回に入ると、
  // `prev=null, next=activeProjectId` で `prev !== next` 判定を通過してしまう。
  // **addPane で新 pane が生まれた直後** (panes 既に複数) にその新 pane の ChatPanel
  // が mount すると、初回 effect で `restoreProjectSnapshot(activeProjectId)` が走り、
  // - 当該 project の snapshot が残っていれば現 panes をそれで上書き (新 pane 消失)
  // - snapshot が無ければ panes を { main: 空 } にリセット (main + 新 pane 両方消失)
  // という panes 破壊が起きる。
  //
  // 修正方針: 初回 effect では
  //   (a) 現 activeProjectId を ref に刻むだけで swap ロジックは実行しない (既存 project
  //       への remount / 同一 project 内での addPane 再マウントを許容)
  // 以降の activeProjectId 変化 (= 本来の project 切替) でのみ snapshot save / restore
  // を orchestrate する。
  //
  // project 切替時 Shell の `<motion.main key={activeProjectId}>` が ChatPanel を丸ごと
  // remount させるため、project 切替後の初回 effect では **既に active pane が変わっている
  // 可能性**があり、かつ prev=null から入る。これでも initialMount スキップが問題ない理由:
  //   - 切替先 project の snapshot が残っていれば、その snapshot は restoreProjectSnapshot
  //     を呼んだ瞬間に panes として live になる必要があるが、現行は切替元の unmount 前
  //     (AnimatePresence exit アニメ中) には prev project の save が間に合わない。これは
  //     既存の既知制限 (v3.5.9 Chunk D レポート参照) であり本修正で新たに壊すわけではない。
  //   - 切替先 project で lastSessionId から DB load したい要件は `mountLoadRanRef` 経路
  //     (本 useEffect の直下にある別 useEffect) が拾う。
  const initialMountRef = useRef(true);
  const prevActiveProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      prevActiveProjectIdRef.current = activeProjectId;
      return;
    }
    const prev = prevActiveProjectIdRef.current;
    const next = activeProjectId;
    prevActiveProjectIdRef.current = next;

    if (prev === next) return;
    if (!isActiveRef.current) return; // active pane のみが snapshot swap を orchestrate

    (async () => {
      // 1) 前 project に lastSessionId を write back（既存挙動維持）
      if (prev) {
        const currentSessionId =
          useChatStore.getState().panes[paneId]?.currentSessionId ?? null;
        const storeAny = useProjectStore.getState() as unknown as {
          updateProject?: (
            id: string,
            patch: { lastSessionId?: string | null }
          ) => void;
        };
        if (typeof storeAny.updateProject === "function" && currentSessionId) {
          try {
            storeAny.updateProject(prev, { lastSessionId: currentSessionId });
          } catch {
            // silent
          }
        }
      }

      // 2) v3.5.9 Chunk D: 前 project の panes を snapshot に保存
      if (prev) {
        useChatStore.getState().saveProjectSnapshot(prev);
      }

      // 3) 新 project の snapshot を復元（hit なら true、miss なら false + 初期化）
      if (!next) {
        // project 未選択: panes を初期化
        useChatStore.getState().restoreProjectSnapshot("__none__");
        return;
      }

      const hit = useChatStore.getState().restoreProjectSnapshot(next);

      // 4) DB からの最新メッセージ load
      //
      // - cache miss: snapshot が無かった → 初期 pane 1 個にリセット済。
      //   従来経路どおり lastSessionId から load する。
      // - cache hit: snapshot を既に復元済（= 瞬時に UI 復元）。裏で lastSessionId
      //   から load することで、snapshot に居ない間に DB に追加された messages
      //   を取り込む（loadSession は chat store の activePane に setMessages する
      //   ため、複数 pane 分の独立復元はできないが、v3.6 以降で拡張予定）。
      const storeAny = useProjectStore.getState() as unknown as {
        projects: Array<{ id: string; lastSessionId?: string | null }>;
      };
      const nextProject = storeAny.projects.find((p) => p.id === next);
      const lastSessionId = nextProject?.lastSessionId ?? null;

      if (!hit) {
        // cache miss: persist 復元された currentSessionId を最優先（リロード復元）、
        // 次に project の lastSessionId、どちらも無ければ clear。
        //
        // v3.5.12 (2026-04-20) 追加: ブラウザリロード後は projectSnapshots が揮発で
        // 消えるが、panes[paneId].currentSessionId は persist されている。
        // この persist 値があれば DB から messages を復元する。
        const persistedSessionId =
          useChatStore.getState().panes[paneId]?.currentSessionId ?? null;
        const sessionToLoad = persistedSessionId ?? lastSessionId;

        if (sessionToLoad) {
          try {
            await useSessionStore.getState().loadSession(sessionToLoad);
          } catch {
            useChatStore.getState().clearSession(paneId);
            useChatStore.getState().setSessionId(paneId, null);
          }
        } else {
          useChatStore.getState().clearSession(paneId);
          useChatStore.getState().setSessionId(paneId, null);
        }
        return;
      }

      // v3.5.10 (2026-04-20) 修正: cache hit 時の loadSession を **削除**。
      // 旧実装は snapshot 復元直後に裏で `loadSession` を走らせ DB messages で
      // 上書きしていたが、これが snapshot の streaming / activity 状態を消し去り
      // 「履歴が残らない」体感を作っていた。
      //
      // 新方針: cache hit したら snapshot を 100% 信じる（streaming / tool_use /
      // activity を含めて完全復元）。DB との差分取り込みは v3.6 PM-810 で
      // sidecar event に session_id を同梱して active 外でも reactive merge
      // する設計で正解にする予定。それまでは UI 体感優先。
    })();
  }, [activeProjectId, paneId]);

  // v3.5.11 Chunk E: handleSidecarEvent / SidecarEvent dispatch は
  // hooks/useAllProjectsSidecarListener.ts の applyEventToState に移植済。
  // 本 component は store 状態の subscriber でしかなく、event parse は持たない。

  // v3.5.12 (2026-04-20) 追加: マウント時の履歴復元（ブラウザリロード用）。
  // 初回 mount かつ activeProjectId === prevActiveProjectId のケースでは
  // 上記 snapshot swap useEffect は早期 return して何もしない。このため
  // リロード直後、persist 復元された currentSessionId を使って DB から
  // messages を load する別経路が必要。active pane のみが実行。
  const mountLoadRanRef = useRef(false);
  useEffect(() => {
    if (mountLoadRanRef.current) return;
    if (!isActivePane) return;
    mountLoadRanRef.current = true;

    const sid = useChatStore.getState().panes[paneId]?.currentSessionId;
    const messagesLen =
      useChatStore.getState().panes[paneId]?.messages.length ?? 0;
    if (sid && messagesLen === 0) {
      // messages は揮発で空、session id は persist 済 → DB から復元
      void useSessionStore.getState().loadSession(sid);
    }
  }, [isActivePane, paneId]);

  const transitionConfig = reduceMotion
    ? { duration: 0 }
    : {
        duration: 0.15,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      };

  return (
    <div
      className="flex h-full flex-col"
      onMouseDownCapture={() => useChatStore.getState().setActivePane(paneId)}
    >
      {showHeader && (
        <ChatPaneHeader
          paneId={paneId}
          active={isActivePane}
          canClose={canClose}
        />
      )}
      {/* 1 pane 時のみ表示する従来ヘッダ（ccmux-ide + status 表示）。
          複数 pane 時は status bar が冗長になるため省略。 */}
      {!showHeader && (
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <h1 className="text-sm font-medium">ccmux-ide</h1>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {!ready && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {status}
          </p>
        </header>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeProjectId ?? "__none__"}
          className="flex min-h-0 flex-1 flex-col"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={transitionConfig}
        >
          <MessageList paneId={paneId} />
          <ActivityIndicator paneId={paneId} />
          <InputArea paneId={paneId} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// v3.5.11 Chunk E: SidecarEvent 型定義 / extract helpers は
// hooks/useAllProjectsSidecarListener.ts に移植済。本ファイルからは削除。
