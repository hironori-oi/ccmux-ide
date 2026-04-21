"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  FileQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/lib/stores/session";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore } from "@/lib/stores/chat";
import {
  ACTIVITY_VISUAL,
  isActiveKind,
  pickDominantActivity,
  type ActivityKind,
} from "@/lib/activity-indicator";
import type { SessionSummary } from "@/lib/types";

/**
 * サイドバー左ペインのセッション一覧（PM-152）。
 *
 * マウント時に `fetchSessions()` を呼び、session 一覧と currentSessionId を
 * `useSessionStore` から購読する。クリックで `loadSession`、hover 時右端の
 * DropdownMenu から rename / delete を実行。
 *
 * 日本語 UI、framer-motion の `layout` アニメで並べ替え時の動きを滑らかにする。
 *
 * ## v5 Chunk B / DEC-032: activeProjectId 別表示 + 未分類 toggle
 *
 * - activeProjectId が null（未選択）なら全件表示（従来動作）
 * - activeProjectId が非 null の場合、当該 project の session のみをデフォルト表示
 * - session_store の fetchSessions 側で Rust に WHERE 条件を投げているので、
 *   UI 側では「未分類 toggle」のみで切替する（toggle ON 時は追加クエリで全件
 *   を取得し、projectId === null の分だけ併記）
 */
export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const isLoading = useSessionStore((s) => s.isLoading);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const loadSession = useSessionStore((s) => s.loadSession);
  const createNewSession = useSessionStore((s) => s.createNewSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  // Chunk A / DEC-031 の project registry から現在 active な project id を取得。
  // null ならフィルタ無し（従来動作 = 全件）。
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // v3.5 Chunk C: 現在 load 中の session に対する pane activity を集約する。
  // 同一 session を複数 pane で開いている場合は dominant 選出で 1 つに畳む。
  // read only（write はしない、Chunk B 排他）。
  const panes = useChatStore((s) => s.panes);
  const activitiesBySession = useMemo(() => {
    const map = new Map<string, ActivityKind>();
    // sessionId ごとに activity を寄せる
    const bucket = new Map<string, import("@/lib/stores/chat").ChatActivity[]>();
    for (const p of Object.values(panes)) {
      if (!p.currentSessionId) continue;
      const arr = bucket.get(p.currentSessionId) ?? [];
      arr.push(p.activity);
      bucket.set(p.currentSessionId, arr);
    }
    for (const [sid, arr] of bucket) {
      map.set(sid, pickDominantActivity(arr));
    }
    return map;
  }, [panes]);

  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  // v5 Chunk B / DEC-032: 「未分類を表示」toggle。初期 off。
  // activeProjectId != null のときだけ UI を出す（null のときは既に全件表示中）。
  const [showUncategorized, setShowUncategorized] = useState(false);
  // 未分類 toggle が ON のとき、別クエリで持ってくる未分類セッション一覧。
  const [uncategorizedSessions, setUncategorizedSessions] = useState<
    SessionSummary[]
  >([]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  // activeProjectId が切り替わったら未分類 toggle を off にリセット（UX シンプル化）。
  useEffect(() => {
    setShowUncategorized(false);
    setUncategorizedSessions([]);
  }, [activeProjectId]);

  // 未分類 toggle ON 時に未分類 session を fetch する（Rust の list_sessions を
  // projectId 引数なし = 全件で叩き、projectId === null のものだけに絞る）。
  useEffect(() => {
    if (!showUncategorized) {
      setUncategorizedSessions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 動的 import を避けるため、session store の fetch は使わず直接 invoke する。
        // サイドバーの main list state を汚さないためにも local state で保持する。
        const { callTauri } = await import("@/lib/tauri-api");
        const all = await callTauri<SessionSummary[]>("list_sessions", {
          limit: 200,
          offset: 0,
        });
        if (cancelled) return;
        setUncategorizedSessions(all.filter((s) => s.projectId === null));
      } catch (e) {
        if (!cancelled) {
          toast.error(`未分類セッションの取得に失敗: ${String(e)}`);
          setShowUncategorized(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showUncategorized]);

  // activeProjectId != null のとき、本体 sessions は fetchSessions が既に
  // project filter 済で返しているのでそのまま使う。ただし万一 race で
  // 混ざった場合のフェールセーフとして client 側でも保険フィルタを通す。
  const visibleSessions = useMemo(() => {
    if (activeProjectId === null) return sessions;
    return sessions.filter((s) => s.projectId === activeProjectId);
  }, [sessions, activeProjectId]);

  async function handleNewSession() {
    // PM-939 (v3.5.22): プロジェクト未選択時は作成不可。
    // button の disabled で塞いではいるが、keyboard 経由 (Enter / Space) での
    // fallback として二重ガード。toast で理由を明示する。
    if (!activeProjectId) {
      toast.error(
        "プロジェクトが選択されていません。左のレールからプロジェクトを作成/選択してください。"
      );
      return;
    }
    try {
      await createNewSession();
      toast.success("新規セッションを作成しました");
    } catch (e) {
      toast.error(`セッション作成に失敗: ${String(e)}`);
    }
  }

  async function handleLoad(id: string) {
    if (id === currentSessionId) return;
    await loadSession(id);
  }

  function openRename(s: SessionSummary) {
    setRenameTarget(s);
    setRenameValue(s.title ?? "");
  }

  async function submitRename() {
    if (!renameTarget) return;
    const value = renameValue.trim();
    if (!value) {
      toast.error("タイトルを入力してください");
      return;
    }
    await renameSession(renameTarget.id, value);
    toast.success("タイトルを変更しました");
    setRenameTarget(null);
    setRenameValue("");
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget.id);
    toast.success("セッションを削除しました");
    setDeleteTarget(null);
  }

  const hasMain = visibleSessions.length > 0;
  const hasUncategorized =
    showUncategorized && uncategorizedSessions.length > 0;
  const showEmpty = !hasMain && !hasUncategorized && !isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 新規セッションボタン
          PM-939 (v3.5.22): activeProjectId が null の時は disabled。
          title 属性で理由を提示し、ボタン直下に静的な案内テキストも出す。 */}
      <div className="p-2">
        <Button
          onClick={handleNewSession}
          disabled={!activeProjectId}
          title={
            !activeProjectId
              ? "先にプロジェクトを作成/選択してください"
              : "新規セッションを作成"
          }
          aria-disabled={!activeProjectId}
          className="w-full justify-start gap-2"
          size="sm"
          variant="default"
        >
          <Plus className="h-4 w-4" aria-hidden />
          新規セッション
        </Button>
        {!activeProjectId && (
          <p className="mt-1.5 px-1 text-[11px] leading-tight text-muted-foreground">
            プロジェクトを選択するとセッションを作成できます
          </p>
        )}
      </div>

      {/* セッション一覧 */}
      <div
        className="flex-1 overflow-y-auto px-2 pb-2"
        role="listbox"
        aria-label="セッション一覧"
      >
        {showEmpty ? (
          <EmptyState projectSelected={activeProjectId !== null} />
        ) : (
          <>
            {/* active project の session（通常ケース） */}
            {hasMain && (
              <motion.ul layout className="flex flex-col gap-1">
                <AnimatePresence initial={false}>
                  {visibleSessions.map((s) => (
                    <motion.li
                      key={s.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.15 }}
                    >
                      <SessionItem
                        session={s}
                        active={s.id === currentSessionId}
                        activity={activitiesBySession.get(s.id) ?? "idle"}
                        onClick={() => void handleLoad(s.id)}
                        onRename={() => openRename(s)}
                        onDelete={() => setDeleteTarget(s)}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}

            {/* 未分類セクション（toggle ON + active project 指定時のみ） */}
            {hasUncategorized && (
              <div className="mt-4">
                <div className="mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <FileQuestion className="h-3 w-3" aria-hidden />
                  未分類
                </div>
                <motion.ul layout className="flex flex-col gap-1">
                  <AnimatePresence initial={false}>
                    {uncategorizedSessions.map((s) => (
                      <motion.li
                        key={`uncat-${s.id}`}
                        layout
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.15 }}
                      >
                        <SessionItem
                          session={s}
                          active={s.id === currentSessionId}
                          activity={activitiesBySession.get(s.id) ?? "idle"}
                          onClick={() => void handleLoad(s.id)}
                          onRename={() => openRename(s)}
                          onDelete={() => setDeleteTarget(s)}
                          muted
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* 未分類 toggle（activeProjectId 指定時のみ表示） */}
      {activeProjectId !== null && (
        <div className="border-t px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs text-muted-foreground"
            onClick={() => setShowUncategorized((v) => !v)}
            aria-pressed={showUncategorized}
          >
            {showUncategorized ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden />
            )}
            {showUncategorized ? "未分類を隠す" : "未分類を表示"}
          </Button>
        </div>
      )}

      {/* Rename Dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セッション名の変更</DialogTitle>
            <DialogDescription>
              新しいタイトルを入力してください。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="タイトル"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitRename();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
            >
              キャンセル
            </Button>
            <Button onClick={() => void submitRename()}>変更する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セッションの削除</DialogTitle>
            <DialogDescription>
              「{deleteTarget?.title ?? "（無題）"}」を削除します。
              この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitDelete()}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ projectSelected }: { projectSelected: boolean }) {
  // PM-939 (v3.5.22): プロジェクト未選択時は「先にプロジェクト」を促す文言に差替え。
  // 選択済みならこれまでどおり「送信で自動作成」を案内する。
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
      <Sparkles className="h-6 w-6 text-muted-foreground" aria-hidden />
      {projectSelected ? (
        <>
          <p className="text-sm font-medium">まだセッションがありません</p>
          <p className="text-xs text-muted-foreground">
            チャットを送信すると自動作成されます
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">プロジェクトを選択してください</p>
          <p className="text-xs text-muted-foreground">
            左のレールからプロジェクトを作成/選択すると、セッション一覧がここに表示されます
          </p>
        </>
      )}
    </div>
  );
}

function SessionItem({
  session,
  active,
  activity,
  onClick,
  onRename,
  onDelete,
  muted = false,
}: {
  session: SessionSummary;
  active: boolean;
  /**
   * v3.5 Chunk C: この session に紐づく pane の Claude activity。
   * load されていない session は `"idle"`（marker 非表示）。
   */
  activity: ActivityKind;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** 未分類セクション用にトーンを落とす */
  muted?: boolean;
}) {
  const title = session.title?.trim() || "（無題のセッション）";
  const excerpt = session.lastMessageExcerpt ?? "（まだメッセージはありません）";
  const relative = formatDistanceToNow(session.updatedAt);

  // v3.5 Chunk C: active session かつ active 状態なら pulse、非 active session
  // は marker 非表示（session 切替時のみ visible にする）。
  const activityVisual = ACTIVITY_VISUAL[activity];
  const showActivityMarker = active && isActiveKind(activity);

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer flex-col gap-1 rounded-md border p-2 pl-3 text-left transition-colors",
        active
          ? "border-primary/60 bg-primary/10"
          : muted
            ? "border-transparent bg-transparent opacity-70 hover:opacity-100 hover:bg-accent"
            : "border-transparent bg-transparent hover:bg-accent"
      )}
      onClick={onClick}
      role="option"
      aria-selected={active}
      aria-label={
        showActivityMarker
          ? `${title}（Claude: ${activityVisual.label}）`
          : title
      }
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* v3.5 Chunk C: 左端の activity marker（active session かつ active 状態時のみ） */}
      {showActivityMarker && (
        <span
          aria-hidden
          title={activityVisual.description}
          className={cn(
            "pointer-events-none absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full",
            activityVisual.dotClassName,
            activityVisual.animate === "pulse" && "motion-safe:animate-pulse",
            activityVisual.animate === "spin" && "motion-safe:animate-spin"
          )}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <span
          className="line-clamp-1 flex-1 text-sm font-medium"
          title={title}
        >
          {title}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {relative}
        </span>
      </div>
      <p
        className="line-clamp-2 text-xs text-muted-foreground"
        title={excerpt}
      >
        {excerpt}
      </p>

      {/* hover 時のみ表示するアクションメニュー */}
      <div
        className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="セッション操作"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden />
              名前を変更
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Unix epoch（秒）から日本語の相対時刻表記を返す。
 * `date-fns` を追加せずに Chunk B 範囲内で完結させるため自前実装。
 */
function formatDistanceToNow(epochSec: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - epochSec);
  if (diff < 60) return "たった今";
  if (diff < 60 * 60) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 60 * 60 * 24) return `${Math.floor(diff / (60 * 60))} 時間前`;
  if (diff < 60 * 60 * 24 * 7) {
    return `${Math.floor(diff / (60 * 60 * 24))} 日前`;
  }
  // それ以前は日付表記（YYYY/MM/DD）
  const d = new Date(epochSec * 1000);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}/${m}/${day}`;
}
