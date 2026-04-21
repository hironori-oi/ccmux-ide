"use client";

import { useMemo } from "react";
import { ChevronDown, Split, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";
import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v3.5 Chunk B (Split Sessions) / 各 pane 上部のヘッダ。
 *
 * 機能:
 *  - 現在 pane が表示している session のタイトルを表示
 *  - クリックで同じ project 内の session 一覧から切替できる dropdown を開く
 *  - pane が複数ある場合に「この pane を閉じる」× ボタンを右端に
 *  - active pane は primary border、inactive はボーダー無し
 *
 * ## 同一 session の 2 pane 同時展開ガード
 *
 * オーナーの明示要求: 同じ session を 2 つの pane で同時に開くと sidecar event
 * がどちらの pane に反映されるか曖昧になる（sidecar は project 単位で共有のため）。
 * UX 上も意味が薄いので、session 選択時に「他 pane で既に開かれている session」
 * を選ぶと toast.warning で拒否する。
 */
export function ChatPaneHeader({
  paneId,
  active,
  canClose,
}: {
  paneId: string;
  active: boolean;
  canClose: boolean;
}) {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useChatStore(
    (s) => s.panes[paneId]?.currentSessionId ?? null
  );
  const allPanes = useChatStore((s) => s.panes);
  const removePane = useChatStore((s) => s.removePane);
  const setActivePane = useChatStore((s) => s.setActivePane);
  // PM-939 (v3.5.22): プロジェクト未選択時は「新規セッション」メニューを disable する。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId]
  );

  // 他 pane で既に開かれている session id の set（同一 session 二重展開防止用）
  const takenSessionIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, p] of Object.entries(allPanes)) {
      if (id === paneId) continue;
      if (p.currentSessionId) set.add(p.currentSessionId);
    }
    return set;
  }, [allPanes, paneId]);

  const title = currentSession?.title?.trim()
    ? currentSession.title
    : currentSessionId
      ? "（無題のセッション）"
      : "セッション未選択";

  async function handleSelectSession(sessionId: string) {
    if (takenSessionIds.has(sessionId)) {
      toast.warning("このセッションはもう一方のペインで開かれています");
      return;
    }
    // 切替前に active pane を自 pane に固定（loadSession の副作用は
    // chat store の setSessionId 経由で activePane に書き込まれるため）。
    setActivePane(paneId);
    try {
      await useSessionStore.getState().loadSession(sessionId);
    } catch (e) {
      toast.error(`セッションの読込に失敗しました: ${String(e)}`);
    }
  }

  async function handleNewSession() {
    // PM-939 (v3.5.22): activeProjectId が null ならセッション作成を拒否。
    // DropdownMenuItem 側でも disabled にしているが keyboard 経路の安全網として残す。
    if (!activeProjectId) {
      toast.error(
        "プロジェクトが選択されていません。左のレールからプロジェクトを作成/選択してください。"
      );
      return;
    }
    setActivePane(paneId);
    try {
      await useSessionStore.getState().createNewSession();
      toast.success("新規セッションを作成しました");
    } catch (e) {
      toast.error(`セッション作成に失敗しました: ${String(e)}`);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label={`ペイン ${paneId}`}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs",
        active
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-muted/30 text-muted-foreground"
      )}
      onMouseDown={() => setActivePane(paneId)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 min-w-0 flex-1 justify-start gap-1 px-2 text-xs"
            aria-label="セッションを切替"
          >
            <Split className="h-3 w-3 shrink-0" aria-hidden />
            <span className="line-clamp-1">{title}</span>
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-[280px] overflow-y-auto">
          <DropdownMenuLabel>セッションを選択</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!activeProjectId}
            onSelect={() => void handleNewSession()}
            className={cn(
              !activeProjectId && "flex flex-col items-start gap-0.5"
            )}
          >
            <span>新規セッション</span>
            {!activeProjectId && (
              <span className="text-[10px] text-muted-foreground">
                プロジェクトを選択してください
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {sessions.length === 0 ? (
            <DropdownMenuItem disabled>セッションがありません</DropdownMenuItem>
          ) : (
            sessions.map((s) => {
              const taken = takenSessionIds.has(s.id);
              const isActive = s.id === currentSessionId;
              const display = s.title?.trim() || "（無題のセッション）";
              return (
                <DropdownMenuItem
                  key={s.id}
                  disabled={taken && !isActive}
                  onSelect={() => void handleSelectSession(s.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5",
                    isActive && "font-medium text-primary"
                  )}
                >
                  <span className="line-clamp-1">{display}</span>
                  {taken && !isActive && (
                    <span className="text-[10px] text-muted-foreground">
                      もう一方のペインで開かれています
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label="ペインを閉じる"
          onClick={() => removePane(paneId)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}
