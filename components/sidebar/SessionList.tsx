"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
import type { SessionSummary } from "@/lib/types";

/**
 * サイドバー左ペインのセッション一覧（PM-152）。
 *
 * マウント時に `fetchSessions()` を呼び、session 一覧と currentSessionId を
 * `useSessionStore` から購読する。クリックで `loadSession`、hover 時右端の
 * DropdownMenu から rename / delete を実行。
 *
 * 日本語 UI、framer-motion の `layout` アニメで並べ替え時の動きを滑らかにする。
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

  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  async function handleNewSession() {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 新規セッションボタン */}
      <div className="p-2">
        <Button
          onClick={handleNewSession}
          className="w-full justify-start gap-2"
          size="sm"
          variant="default"
        >
          <Plus className="h-4 w-4" aria-hidden />
          新規セッション
        </Button>
      </div>

      {/* セッション一覧 */}
      <div
        className="flex-1 overflow-y-auto px-2 pb-2"
        role="listbox"
        aria-label="セッション一覧"
      >
        {sessions.length === 0 && !isLoading ? (
          <EmptyState />
        ) : (
          <motion.ul layout className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {sessions.map((s) => (
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
                    onClick={() => void handleLoad(s.id)}
                    onRename={() => openRename(s)}
                    onDelete={() => setDeleteTarget(s)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>

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

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
      <Sparkles className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">まだセッションがありません</p>
      <p className="text-xs text-muted-foreground">
        上の「新規セッション」から開始できます。
      </p>
    </div>
  );
}

function SessionItem({
  session,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const title = session.title?.trim() || "（無題のセッション）";
  const excerpt = session.lastMessageExcerpt ?? "（まだメッセージはありません）";
  const relative = formatDistanceToNow(session.updatedAt);

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-left transition-colors",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-transparent bg-transparent hover:bg-accent"
      )}
      onClick={onClick}
      role="option"
      aria-selected={active}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
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
