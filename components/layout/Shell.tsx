"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Columns2,
  FileCode2,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Square,
  Terminal as TerminalIcon,
} from "lucide-react";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { ImagePasteZone } from "@/components/chat/ImagePasteZone";
import { EditorPane } from "@/components/editor/EditorPane";
import { ProjectRail } from "@/components/layout/ProjectRail";
import { SplitView } from "@/components/layout/SplitView";
import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TerminalView } from "@/components/terminal/TerminalView";
import { WorkspaceView } from "@/components/workspace/WorkspaceView";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// v1.16.0 (DEC-062): M3 MVP 時に React error #185 容疑で disable していた
// UpdateNotifier を再マウント。独自 ErrorBoundary で包み、万一のクラッシュは
// アプリ本体に波及させない。
import { UpdateNotifier } from "@/components/updates/UpdateNotifier";
import { UpdateNotifierBoundary } from "@/components/updates/UpdateNotifierBoundary";
import { UpdateDialog } from "@/components/updates/UpdateDialog";
import { useAllProjectsSidecarListener } from "@/hooks/useAllProjectsSidecarListener";
import { useClaudeMonitor } from "@/hooks/useClaudeMonitor";
import { useClaudeOAuthUsage } from "@/hooks/useClaudeOAuthUsage";
import { useTerminalListener } from "@/hooks/useTerminalListener";
import { useChatStore, MAX_PANES } from "@/lib/stores/chat";
import {
  useEditorStore,
  EDITOR_MAX_PANES,
} from "@/lib/stores/editor";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import {
  useTerminalStore,
  TERMINAL_MAX_PANES,
} from "@/lib/stores/terminal";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

/**
 * Workspace 全体の統合 Shell（PM-167 + v5 Chunk C / DEC-030）。
 *
 * 構造（縦 flex）:
 *   ┌──────────────────────────────────────────────────┐
 *   │                TitleBar (36px)                   │
 *   ├─────┬──────────┬───────────────────┬────────────┤
 *   │Rail │ Sidebar  │       main        │ Inspector  │
 *   │48px │ 240/48px │     flex-1        │   320px    │
 *   ├─────┴──────────┴───────────────────┴────────────┤
 *   │                StatusBar (28px)                  │
 *   └──────────────────────────────────────────────────┘
 *
 * v3.5 Chunk B (Split Sessions):
 *  - main 領域の Chat タブ配下を SplitView で 1〜2 pane に分割。
 *  - 「分割」ボタンを Chat / Editor タブの右側に追加（pane < MAX_PANES のみ有効）。
 *  - 各 pane は独立した ChatPanel（paneId prop 付き）。pane 上部に ChatPaneHeader
 *    を表示し session 切替 / pane 閉じ操作を提供する。
 *  - ImagePasteZone は Shell に 1 個だけマウント（hotkey 重複を避ける）。
 *    activePane に対して attachment を追加する。
 */
export function Shell({ children }: { children?: ReactNode }) {

  useClaudeMonitor();
  // PRJ-012 v3.5.11 Chunk E (Cross-Project Events): 全 project の sidecar event を
  // 常時購読する singleton hook。Shell から 1 回だけ呼ぶことで、project 切替
  // 中も非 active project の thinking → tool_use → streaming → complete が
  // 裏で進行し続け、ProjectRail の activity dot が独立動作する。
  useAllProjectsSidecarListener();
  // v3.5.15 (2026-04-20): Claude Max プランの 5h / 7d 使用量を **アプリ起動時から**
  // 即 poll 開始（60 秒間隔）。従来は `UsageStatsCard` が mount されるまで fetch
  // されず、Sidebar の「実行状態」タブを開くまで StatusBar の 5h / 7d ゲージが
  // 空のままだった UX を解消する。hook 自体に二重 fetch ガード + interval cleanup
  // があるため複数箇所で呼んでも安全。
  useClaudeOAuthUsage();
  // PRJ-012 v1.0 / PM-920 / DEC-045: 組込ターミナル exit event listener。
  // data event は TerminalPane が自前で subscribe、ここは exit 集約のみ。
  useTerminalListener();

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const reduceMotion = useReducedMotion();

  // -------------------------------------------------------------------------
  // PRJ-012 PM-890 (v1.1): project 切替時 snapshot save/restore orchestrate。
  //
  // ## 背景
  //
  // PM-810 regression hotfix (2026-04-20) で ChatPanel.tsx 側に `initialMountRef`
  // guard を入れたことで、project 切替時の snapshot save/restore が縮退していた:
  //
  //  - Before: project 切替で streaming 中メッセージも snapshot として保持
  //  - After (PM-810 hotfix): 切替時は DB load のみで復元 → **streaming 中メッセージが
  //    切替で失われる**
  //
  // また ChatPanel 側で orchestrate する方式は addPane で新 pane が mount された瞬間
  // にも useEffect が走り、panes 全体を破壊するバグを生んでいた（PM-810 regression 本体）。
  //
  // ## PM-890 の解決
  //
  // Shell 側で activeProjectId の変化を監視し、ChatPanel の mount タイミング **に依存
  // せずに** snapshot を orchestrate する。ChatPanel は snapshot swap を持たない
  // subscriber に戻る。
  //
  //  - 初回 mount (prev === undefined): 何もしない（起動直後 or リロード直後の復元は
  //    ChatPanel 側の `mountLoadRanRef` パスで persisted currentSessionId から DB load）
  //  - prev → next 変化:
  //    1. prev が truthy なら `saveProjectSnapshot(prev)` で現 panes を丸ごと退避
  //    2. next が truthy なら `restoreProjectSnapshot(next)`
  //       - cache hit (true): snapshot を panes に復元 → streaming 中 message も
  //         そのまま戻る。DB との差分 merge は Chunk E 以降で対応。
  //       - cache miss (false): panes は初期 pane 1 個にリセット済。project の
  //         lastSessionId があれば DB から loadSession で復元する。
  //    3. next が null (未選択) なら panes を初期化のみ
  //
  // ## PM-810 paneId routing への影響
  //
  // `reqIdToPane` / `pendingSendsByProject` map は useAllProjectsSidecarListener
  // 内で独立に管理されており、本 effect は touch しない。split pane の routing は
  // 非 regression。
  // -------------------------------------------------------------------------
  const prevActiveProjectIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevActiveProjectIdRef.current;
    const next = activeProjectId;
    // 初回 mount (起動直後 / リロード後) は sentinel から抜けるだけで orchestrate 無し。
    // persisted currentSessionId からの復元は ChatPanel 側 mountLoadRanRef が担当。
    if (prev === undefined) {
      prevActiveProjectIdRef.current = next;
      return;
    }
    if (prev === next) return;
    prevActiveProjectIdRef.current = next;

    const chat = useChatStore.getState();
    const projectStore = useProjectStore.getState();

    // 1) 切替直前の project の panes を snapshot に退避（streaming 中 message ごと保持）。
    //    同時に lastSessionId の write back（従来挙動維持、旧 ChatPanel 経路のコピー）。
    if (prev) {
      const activePaneId = chat.activePaneId;
      const currentSessionId =
        chat.panes[activePaneId]?.currentSessionId ?? null;
      const projectStoreAny = projectStore as unknown as {
        updateProject?: (
          id: string,
          patch: { lastSessionId?: string | null }
        ) => void;
      };
      if (
        typeof projectStoreAny.updateProject === "function" &&
        currentSessionId
      ) {
        try {
          projectStoreAny.updateProject(prev, { lastSessionId: currentSessionId });
        } catch {
          // silent
        }
      }
      chat.saveProjectSnapshot(prev);
    }

    // 2) 切替後の project の snapshot を復元 or 初期化。
    if (!next) {
      // 未選択遷移: panes を初期化のみ（__none__ は cache miss 固定で panes を reset）
      chat.restoreProjectSnapshot("__none__");
      return;
    }
    const hit = chat.restoreProjectSnapshot(next);
    logger.debug("[pm890-orchestrate]", { prev, next, hit });

    if (!hit) {
      // cache miss: panes は初期 pane 1 個に reset 済。
      // project.lastSessionId があれば DB から load（従来経路踏襲）。
      // persist 復元された currentSessionId が優先されるべきケースは
      // ChatPanel の mountLoadRanRef が拾うため、ここでは lastSessionId のみ考慮。
      const projectStoreAny2 = projectStore as unknown as {
        projects: Array<{ id: string; lastSessionId?: string | null }>;
      };
      const nextProject = projectStoreAny2.projects.find((p) => p.id === next);
      const lastSessionId = nextProject?.lastSessionId ?? null;
      if (lastSessionId) {
        void (async () => {
          try {
            await useSessionStore.getState().loadSession(lastSessionId);
          } catch {
            // loadSession 失敗は致命でない（空 pane のまま継続）
            const chat2 = useChatStore.getState();
            const activePaneId2 = chat2.activePaneId;
            chat2.setPaneSession(activePaneId2, null);
          }
        })();
      }
    }
    // v3.5.10 方針踏襲: cache hit 時は snapshot を 100% 信じて DB load しない
    // （streaming / activity を消さないため）。DB 差分取り込みは別 chunk で対応。
  }, [activeProjectId]);

  // v3.4 Chunk A: Chat / Editor 切替
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const openFileCount = useEditorStore((s) => s.openFiles.length);

  // v3.5 Chunk B: pane 一覧 + 分割操作
  const panes = useChatStore((s) => s.panes);
  const activePaneId = useChatStore((s) => s.activePaneId);
  const addPane = useChatStore((s) => s.addPane);
  const removePane = useChatStore((s) => s.removePane);
  const paneIds = useMemo(() => Object.keys(panes), [panes]);

  // PM-924: Editor 分割の state
  const editorPanes = useEditorStore((s) => s.editorPanes);
  const addEditorPane = useEditorStore((s) => s.addEditorPane);
  const removeEditorPane = useEditorStore((s) => s.removeEditorPane);
  const editorPaneIds = useMemo(() => Object.keys(editorPanes), [editorPanes]);

  // PM-924: Terminal 分割の state
  const terminalPanes = useTerminalStore((s) => s.terminalPanes);
  const addTerminalPane = useTerminalStore((s) => s.addTerminalPane);
  const removeTerminalPane = useTerminalStore((s) => s.removeTerminalPane);
  const terminalPaneIds = useMemo(
    () => Object.keys(terminalPanes),
    [terminalPanes]
  );

  /**
   * PM-937 (2026-04-20): viewMode に応じて「現在の pane 数」「目標 pane 数への遷移」
   * を抽象化するヘルパ。1 / 2 / 4 の 3 モードから選べる dropdown から呼ばれる。
   *
   * - target < current: 余分な pane を末尾（= 追加順で後ろ）から removePane
   * - target > current: 差分だけ addPane
   * - target === current: no-op
   *
   * Terminal だけ removePane が async（pty kill 含む）だが、void で fire-and-forget
   * して UI は即 state を読み直す（store 側が optimistic update 済）。
   */
  const applyPaneMode = useCallback(
    (target: 1 | 2 | 4) => {
      switch (viewMode) {
        case "chat": {
          const cur = paneIds.length;
          if (cur === target) return;
          if (cur < target) {
            for (let i = cur; i < target; i++) addPane();
          } else {
            // 末尾から削る（先頭 = "main" / 最初に作られた pane を残す）
            const toRemove = paneIds.slice(target);
            for (const id of toRemove) removePane(id);
          }
          return;
        }
        case "editor": {
          const cur = editorPaneIds.length;
          if (cur === target) return;
          if (cur < target) {
            for (let i = cur; i < target; i++) addEditorPane();
          } else {
            const toRemove = editorPaneIds.slice(target);
            for (const id of toRemove) removeEditorPane(id);
          }
          return;
        }
        case "terminal": {
          const cur = terminalPaneIds.length;
          if (cur === target) return;
          if (cur < target) {
            for (let i = cur; i < target; i++) addTerminalPane();
          } else {
            const toRemove = terminalPaneIds.slice(target);
            // removeTerminalPane は async (pty kill) だが fire-and-forget で OK
            // （store 側が optimistic に UI state を更新する）
            toRemove.forEach((id) => {
              void removeTerminalPane(id);
            });
          }
          return;
        }
        default:
          return;
      }
    },
    [
      viewMode,
      paneIds,
      addPane,
      removePane,
      editorPaneIds,
      addEditorPane,
      removeEditorPane,
      terminalPaneIds,
      addTerminalPane,
      removeTerminalPane,
    ]
  );

  /**
   * PM-937: 現在の viewMode での pane 数 / 最大 pane 数を返す。
   * Dropdown の 4 pane 項目の enable 判定と checkmark 表示に使う。
   */
  const paneModeInfo = (() => {
    switch (viewMode) {
      case "chat":
        return { current: paneIds.length, max: MAX_PANES, target: "チャット" };
      case "editor":
        return {
          current: editorPaneIds.length,
          max: EDITOR_MAX_PANES,
          target: "エディタ",
        };
      case "terminal":
        return {
          current: terminalPaneIds.length,
          max: TERMINAL_MAX_PANES,
          target: "ターミナル",
        };
      default:
        return null;
    }
  })();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const transitionConfig = reduceMotion
    ? { duration: 0 }
    : {
        duration: 0.18,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      };

  if (!mounted) {
    return (
      <div
        className="flex h-screen flex-col bg-transparent"
        suppressHydrationWarning
      />
    );
  }

  const paneItems = paneIds.map((id) => ({
    id,
    content: (
      <ChatPanel
        paneId={id}
        canClose={paneIds.length > 1}
        showHeader={paneIds.length > 1}
      />
    ),
  }));

  return (
    // PM-870: bg-background → bg-transparent。html::before (背景画像) と
    // html::after (背景色 overlay) を body 越しに見せるため、最外コンテナの
    // 背景色を撤去する。画像なし時は html::after の opacity=1 で従来と同じ見た目。
    <div className="flex h-screen flex-col bg-transparent">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ProjectRail />
        <Sidebar />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={activeProjectId ?? "__none__"}
            aria-label="メインビュー"
            className="flex min-w-0 flex-1 flex-col"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={transitionConfig}
          >
            {/*
             * PM-970: ViewModeTab / 分割 dropdown を完全撤去、ワークスペース単独 UI に。
             *
             * 旧構成:
             *   [チャット][エディタ][ターミナル][プレビュー][ワークスペース] [分割▾]
             *   → 各 view は独立 SplitView で分割され、同時表示不可
             *
             * 新構成:
             *   Tray Bar (chat/editor/terminal/preview チップ + 新規ボタン + Layout 切替)
             *   + Slot Grid (Tray からの DnD + Sidebar からの file drop を受ける)
             *
             * viewMode は store に残存させるが、Shell 描画では参照しない。ファイル
             * open 時の `setViewMode("editor")` 等の副作用もワークスペース側で無視
             * されるだけで害なし（将来整理）。
             */}
            <WorkspaceView />
          </motion.main>
        </AnimatePresence>
        {/* v3.5.3: 右 Inspector 完全撤去（Git / Status / Worktree / CLAUDE.md 全機能を
            Sidebar / エディタ / 左 Rail に再配置。チャット + エディタを広く使うため。） */}
      </div>
      <StatusBar />
      {/*
       * v3.5 Chunk B: ImagePasteZone は Shell にグローバル 1 個だけマウント。
       * hotkey は DOM 全体で capture されるため各 pane に配ると重複発火する。
       * 貼付先は常に activePane（pane を変えれば paste 先も切替わる）。
       */}
      <ImagePasteZone paneId={activePaneId} />
      {/*
       * Next.js page children（WorkspacePage）をここに overlay として mount する。
       * page 側は CommandPalette / SearchPalette / HelloBubble 等の上乗せ UI のみ。
       */}
      {children}
      {/*
       * v1.16.0 (DEC-062): UpdateNotifier を ErrorBoundary で包んで再マウント。
       * Notifier は DOM を持たない（store を更新 + toast を出すだけ）。
       * UpdateDialog は TitleBar の UpdateBadge クリックから CustomEvent で開く。
       */}
      <UpdateNotifierBoundary>
        <UpdateNotifier />
      </UpdateNotifierBoundary>
      <UpdateDialog />
    </div>
  );
}

/**
 * PM-937 (2026-04-20): 分割モード選択 dropdown の 1 項目。
 *
 * 現在のモードに一致する項目に checkmark を表示する。選択で applyPaneMode(target) を呼ぶ。
 * disabled は MAX_PANES 超過ケース（将来的に max が 2 に下げられた場合の guard）。
 */
function PaneModeItem({
  icon,
  label,
  active,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(e) => {
        // onSelect は default で menu を close するが、preventDefault しない方が UX 自然
        e.preventDefault();
        onSelect();
      }}
      className="flex items-center gap-2 text-[12px]"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {active && <Check className="h-3.5 w-3.5" aria-hidden />}
    </DropdownMenuItem>
  );
}

/**
 * Chat / Editor 切替 1 タブ。TitleBar 直下に配置。
 */
function ViewModeTab({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-full items-center gap-1.5 border-b-2 px-3 text-[12px] font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span
          aria-label={`${badge} 件開いています`}
          className="ml-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
