"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Plus, X, Terminal as TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/lib/stores/project";
import {
  TERMINAL_DEFAULT_PANE_ID,
  useTerminalStore,
  type TerminalState,
} from "@/lib/stores/terminal";
import { cn } from "@/lib/utils";

// TerminalPane (xterm.js 依存) は SSR 不可。Next.js の dynamic import で ssr:false。
const TerminalPane = dynamic(
  () =>
    import("@/components/terminal/TerminalPane").then((m) => m.TerminalPane),
  { ssr: false }
);

/**
 * PRJ-012 PM-924 (2026-04-20): 1 pane 分の terminal container。
 *
 * 旧 TerminalView（単一 pane）の sub-tab 管理ロジックを paneId スコープに分離。
 * 各 pane は独立した pty sub-tab 群を持ち、auto-spawn / active 切替 /
 * close 操作も pane ごとに独立する。
 *
 * 全 pane で共有されるのは pty の map（`terminals`）と project 情報のみ。
 * pty は `paneId` field で所属 pane を識別する。
 */
export function TerminalPaneItem({
  paneId,
  showHeader,
  canClose,
}: {
  paneId: string;
  showHeader: boolean;
  canClose: boolean;
}) {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const activeProjectId = activeProject?.id ?? null;
  const activeProjectPath = activeProject?.path ?? null;

  const terminals = useTerminalStore((s) => s.terminals);
  const pane = useTerminalStore((s) => s.terminalPanes[paneId]);
  const activeTerminalPaneId = useTerminalStore(
    (s) => s.activeTerminalPaneId
  );
  const setActiveTerminalPane = useTerminalStore(
    (s) => s.setActiveTerminalPane
  );
  const removeTerminalPane = useTerminalStore((s) => s.removeTerminalPane);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const closeTerminal = useTerminalStore((s) => s.closeTerminal);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);

  const activeTerminalId = pane?.activeTerminalId ?? null;

  // 当該 project + pane に紐づく pty のみ filter
  const paneTerminals: TerminalState[] = useMemo(() => {
    if (!activeProjectId) return [];
    return Object.values(terminals)
      .filter(
        (t) =>
          t.projectId === activeProjectId &&
          (t.paneId ?? TERMINAL_DEFAULT_PANE_ID) === paneId
      )
      .sort((a, b) => a.startedAt - b.startedAt);
  }, [terminals, activeProjectId, paneId]);

  // active terminal が pane に含まれていない場合は先頭 pty を active に
  useEffect(() => {
    if (!activeProjectId) return;
    if (paneTerminals.length === 0) return;
    const isValid = paneTerminals.some((t) => t.ptyId === activeTerminalId);
    if (!isValid) {
      setActiveTerminal(paneTerminals[0].ptyId, paneId);
    }
  }, [activeProjectId, paneTerminals, activeTerminalId, setActiveTerminal, paneId]);

  // PM-922 由来の auto-spawn guard（pane 単位に拡張）。
  // StrictMode 二重起動で同 pane に 2 本 spawn されるのを防ぐ。
  const spawnedProjectsRef = useRef<Set<string>>(new Set());

  // auto-spawn: pane が **main pane** のときだけ project 初回に 1 pty 起動。
  // 新規分割 pane は明示的に「+新規」で terminal を起動してもらう
  // （split 押下で勝手に pty が 2 本起動するのはユーザーが想定しない挙動のため）。
  useEffect(() => {
    if (paneId !== TERMINAL_DEFAULT_PANE_ID) return;
    if (!activeProjectId || !activeProjectPath) return;
    if (paneTerminals.length > 0) return;
    const key = `${activeProjectId}:${paneId}`;
    if (spawnedProjectsRef.current.has(key)) return;
    spawnedProjectsRef.current.add(key);
    void createTerminal(
      activeProjectId,
      activeProjectPath,
      undefined,
      paneId
    ).then((ptyId) => {
      if (!ptyId) spawnedProjectsRef.current.delete(key);
    });
  }, [paneId, activeProjectId, activeProjectPath, paneTerminals.length, createTerminal]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (paneTerminals.length === 0) return;
    spawnedProjectsRef.current.add(`${activeProjectId}:${paneId}`);
  }, [activeProjectId, paneTerminals.length, paneId]);

  if (!pane) return null;

  if (!activeProject) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        プロジェクトを選択するとターミナルが使えます
      </div>
    );
  }

  const isActivePane = paneId === activeTerminalPaneId;

  return (
    <div
      className={cn(
        // PM-928 hotfix: PM-926 の `bg-background/30` は 1 pane 時に xterm canvas
        // との合成レンダリングを阻害し、text が背景色に溶けて見えなくなる回帰を
        // 起こしていた (2 pane 時は SplitView の Panel レイアウトが container を
        // 異なる subtree に配置するため副次的に回避されていた)。
        // 1/2 pane で同一挙動を保証するため、外殻は `bg-transparent` にして
        // 背景塗りは xterm 本体の theme.background (0.6) 単独に委譲する。
        // sub-tab bar / split header は自前の bg-background/50 を維持するため
        // UI 可読性は落ちない。
        "flex h-full w-full flex-col bg-transparent",
        showHeader && !isActivePane && "opacity-95"
      )}
      onMouseDown={() => {
        if (!isActivePane) setActiveTerminalPane(paneId);
      }}
    >
      {showHeader && (
        // PM-926: split header は sub-tab bar と同じ階層的透過に合わせる。
        <div className="flex h-6 shrink-0 items-center justify-between border-b border-border/40 bg-background/50 px-2 text-[10px] text-muted-foreground">
          <span className={cn(isActivePane && "text-foreground")}>
            {isActivePane ? "このペインにフォーカス中" : "クリックでフォーカス"}
          </span>
          {canClose && (
            <button
              type="button"
              onClick={() => void removeTerminalPane(paneId)}
              className="flex h-4 w-4 items-center justify-center rounded hover:bg-accent/30"
              aria-label="このターミナルペインを閉じる"
              title="ペインを閉じる (pty は全て kill)"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* sub-tab bar: pty 一覧 + 新規ボタン */}
      {/* PM-926: sub-tab bar は外殻より少し濃い半透明 (bg-background/50) にして
          「外殻 30% < sub-tab 50% < active tab 70%」の階層感を作る。
          壁紙が透けるが UI の境界は視認できる。 */}
      <div
        role="tablist"
        aria-label={`ターミナル一覧 (${paneId})`}
        className="flex h-8 shrink-0 items-center gap-0 border-b border-border/30 bg-background/50 px-2"
      >
        {paneTerminals.map((t) => (
          <TerminalSubTab
            key={t.ptyId}
            terminal={t}
            active={t.ptyId === activeTerminalId}
            onActivate={() => setActiveTerminal(t.ptyId, paneId)}
            onClose={() => void closeTerminal(t.ptyId)}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-1 h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (activeProjectPath) {
              void createTerminal(
                activeProject.id,
                activeProjectPath,
                undefined,
                paneId
              );
            }
          }}
          aria-label="新しいターミナルを開く"
          title="新しいターミナル"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          <span>新規</span>
        </Button>
      </div>

      {/* Terminal panes: 非 active は display:none で xterm state を保持 */}
      <div className="relative min-h-0 flex-1">
        {paneTerminals.map((t) => (
          <div
            key={t.ptyId}
            className={cn(
              "absolute inset-0",
              t.ptyId === activeTerminalId ? "block" : "hidden"
            )}
            aria-hidden={t.ptyId !== activeTerminalId}
          >
            <TerminalPane ptyId={t.ptyId} />
            {t.exited && (
              <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] text-yellow-300">
                終了 (exit code {t.exitCode ?? "?"})
              </div>
            )}
          </div>
        ))}
        {paneTerminals.length === 0 && (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            <TerminalIcon className="mr-2 h-4 w-4" aria-hidden />
            {paneId === TERMINAL_DEFAULT_PANE_ID
              ? "ターミナルを起動しています…"
              : "「+新規」でこのペインにターミナルを起動してください"}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalSubTab({
  terminal,
  active,
  onActivate,
  onClose,
}: {
  terminal: TerminalState;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        "group flex h-7 items-center gap-1 border-b-2 px-2 text-[11px] font-medium transition-colors",
        // PM-926: active tab は bg-background/70 で階層最上位を視覚化 (外殻 30
        // sub-tab 50 < active 70)。壁紙は薄く透けるが選択中の tab がはっきり分かる。
        active
          ? "border-primary bg-background/70 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex items-center gap-1"
      >
        <TerminalIcon className="h-3 w-3" aria-hidden />
        <span>{terminal.title}</span>
        {terminal.exited && (
          <span className="text-yellow-400">(終了)</span>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted/30 hover:text-foreground group-hover:opacity-60"
        aria-label={`${terminal.title} を閉じる`}
        title="閉じる"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
