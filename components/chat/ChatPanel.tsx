"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

  // v5 Chunk C: activeProjectId の変化を購読し、chat / session のスワップを行う。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const reduceMotion = useReducedMotion();

  // ref 版 isActivePane（listener 内でも最新値を参照するため）
  const isActiveRef = useRef(isActivePane);
  useEffect(() => {
    isActiveRef.current = isActivePane;
  }, [isActivePane]);

  // -------------------------------------------------------------------------
  // v3.5.11 Chunk E: sidecar event listener は Shell の
  // useAllProjectsSidecarListener() に集約済。本 component には listener が無い。
  //
  // PM-978: sidecar status 表示は SlotHeader 側の ChatStatusIndicator に移管。
  // 本 component は fallback header を持たなくなり、message list + input area
  // だけに特化する。
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // v5 Chunk C (DEC-030) + v3.5 Chunk B + v3.5.9 Chunk D (Project Switch History)
  // + PM-810 hotfix (2026-04-20) + PM-890 (2026-04-20):
  // activeProjectId 変化時の snapshot save/restore は **Shell.tsx の useEffect
  // に移管済**。ChatPanel は snapshot swap を持たない subscriber に戻る。
  //
  // ## 経緯
  //
  // - v3.5.9 Chunk D: ChatPanel 側で project 切替直前 save / 直後 restore を
  //   orchestrate していたが、複数 pane が同時に動くと二重 swap が起きるため
  //   「active pane だけが実行する」 guard を置いていた。
  // - PM-810 regression: addPane で新 pane が mount された瞬間 ChatPanel の
  //   useEffect が走り、`prev=null, next=activeProjectId` で
  //   `restoreProjectSnapshot(activeProjectId)` を誤発火させ、新 pane を含む
  //   panes 全体を壊してしまう regression が顕在化（PM-810 hotfix レポート参照）。
  // - PM-810 hotfix: `initialMountRef` guard を入れて初回 effect を skip したが、
  //   この副作用で project 切替時の snapshot orchestrate も縮退（= streaming
  //   中メッセージが切替で失われる）。
  // - PM-890 (本タスク): Shell 側に `activeProjectId` の useEffect を立て、
  //   ChatPanel の mount 依存なく orchestrate する形に移管。ChatPanel の
  //   snapshot swap 本体は削除。`initialMountRef` は保険として維持する。
  //
  // ## 本 component に残る責務
  //
  // - `mountLoadRanRef` 経路 (下の別 useEffect): ブラウザリロード後に
  //   persist 復元された currentSessionId から DB messages を load する
  //   pane 単位の復元経路。Shell 側 orchestrate は初回 mount を skip するため
  //   リロード直後はここが動く必要がある。
  // - `initialMountRef` (以下): 万一 Shell orchestrate が race する場合の保険。
  //   現在は swap ロジックが無いため実質 no-op だが、将来 ChatPanel 内部で
  //   snapshot に触る action を追加する際の guard として残す。
  // ---------------------------------------------------------------------------
  const initialMountRef = useRef(true);
  const prevActiveProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      prevActiveProjectIdRef.current = activeProjectId;
      return;
    }
    // PM-890: snapshot save/restore は Shell 側に移管済。pane 側は prev ref の
    // 維持のみ行う（isActiveRef は touch しない、他 pane も subscriber として
    // activeProjectId 変化を観測するだけで副作用は起こさない）。
    prevActiveProjectIdRef.current = activeProjectId;
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

    // v1.18.0 (DEC-064): messages は session 単位 store。当該 session の
    // sessionMessages entry が空または未 load なら DB から loadSession する。
    const chat = useChatStore.getState();
    const sid = chat.panes[paneId]?.currentSessionId ?? null;
    const alreadyHydrated =
      sid !== null && chat.sessionMessages[sid] !== undefined;
    if (sid && !alreadyHydrated) {
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
      {/* PM-978: 従来の 1 pane fallback header を撤去。
          プロジェクト名は上部 TitleBar + ProjectSwitcher で既に表示されており
          重複。tool toggle / status 表示は SlotHeader 側に移管して垂直スペース
          を最大化し、チャット画面をより広く使えるようにした。 */}
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

// PM-978: ToolDetailsToggle は components/chat/ToolDetailsToggle.tsx へ分離。
// SlotHeader でも同じ toggle を使うため共通化した。

// v3.5.11 Chunk E: SidecarEvent 型定義 / extract helpers は
// hooks/useAllProjectsSidecarListener.ts に移植済。本ファイルからは削除。
