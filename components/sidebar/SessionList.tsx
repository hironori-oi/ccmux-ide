"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  MouseSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  Clock,
  GripVertical,
  ListOrdered,
  Loader2,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSessionStore, type SessionStatus } from "@/lib/stores/session";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore } from "@/lib/stores/chat";
import {
  applySessionOrder,
  useSessionOrderStore,
} from "@/lib/stores/session-order";
import {
  ACTIVITY_VISUAL,
  isActiveKind,
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
 * ## v5 Chunk B / DEC-032 → PM-985 で簡素化
 *
 * - activeProjectId が null（未選択）なら全件表示（従来動作）
 * - activeProjectId が非 null の場合、当該 project の session のみをデフォルト表示
 * - 旧「未分類 toggle」は PM-985 で撤去（オーナー判断、機能不要）
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

  // v1.18.0 (DEC-064): activity は session 単位 store から直接引く（pane 経由
  // の集約は廃止）。pane 切替しても session 自身の activity は保持されるため、
  // 思考中 session のアイコンは pane 切替に連動しない。
  const sessionActivity = useChatStore((s) => s.sessionActivity);
  const activitiesBySession = useMemo(() => {
    const map = new Map<string, ActivityKind>();
    for (const [sid, activity] of Object.entries(sessionActivity)) {
      map.set(sid, activity.kind);
    }
    return map;
  }, [sessionActivity]);

  // v1.18.0 (DEC-064): session 単位 status (idle / thinking / streaming / error)。
  // pane とは無関係、session 自身が保持する揮発状態を購読。
  const sessionVolatile = useSessionStore((s) => s.volatile);
  const statusBySession = useMemo(() => {
    const map = new Map<string, SessionStatus>();
    for (const [sid, v] of Object.entries(sessionVolatile)) {
      map.set(sid, v.status);
    }
    return map;
  }, [sessionVolatile]);

  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  // PM-983: セッション表示順の管理（auto = 更新順 / manual = 手動並替）
  const orderMode = useSessionOrderStore((s) => s.mode);
  const orderMap = useSessionOrderStore((s) => s.order);
  const setOrderMode = useSessionOrderStore((s) => s.setMode);
  const setOrder = useSessionOrderStore((s) => s.setOrder);
  const removeFromOrder = useSessionOrderStore((s) => s.removeFromOrder);

  // PM-985: 旧「未分類を表示」toggle は撤去済（オーナー判断、機能不要）

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  // activeProjectId != null のとき、本体 sessions は fetchSessions が既に
  // project filter 済で返しているのでそのまま使う。ただし万一 race で
  // 混ざった場合のフェールセーフとして client 側でも保険フィルタを通す。
  const filteredSessions = useMemo(() => {
    if (activeProjectId === null) return sessions;
    return sessions.filter((s) => s.projectId === activeProjectId);
  }, [sessions, activeProjectId]);

  // PM-983: 表示順を適用。manual モードなら保存済並び順、それ以外は updated_at DESC
  const projectKey = activeProjectId ?? "__none__";
  const visibleSessions = useMemo(
    () =>
      applySessionOrder(filteredSessions, projectKey, orderMode, orderMap),
    [filteredSessions, projectKey, orderMode, orderMap]
  );

  // PM-983: drag sensors（4px 移動で activate、通常クリックを誤発火させない）
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // PM-983: drag 完了 → 配列 reorder → store に永続化
  function handleDragEnd(ev: DragEndEvent, targetKey: string, ids: string[]) {
    const activeId = ev.active.id;
    const overId = ev.over?.id;
    if (!overId || activeId === overId) return;
    const oldIndex = ids.indexOf(String(activeId));
    const newIndex = ids.indexOf(String(overId));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setOrder(targetKey, next);
  }

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
    // PM-983: 手動並び順 store からも除去（stale 参照回避）
    removeFromOrder(deleteTarget.id);
    toast.success("セッションを削除しました");
    setDeleteTarget(null);
  }

  const hasMain = visibleSessions.length > 0;
  const showEmpty = !hasMain && !isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 新規セッションボタン + 並び順 toggle
          PM-939 (v3.5.22): activeProjectId が null の時は disabled。
          PM-983: 並び順 toggle を追加。デフォルト auto（更新順）、
          manual に切替でドラッグ&ドロップ並替可能。 */}
      <div className="p-2">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleNewSession}
            disabled={!activeProjectId}
            title={
              !activeProjectId
                ? "先にプロジェクトを作成/選択してください"
                : "新規セッションを作成"
            }
            aria-disabled={!activeProjectId}
            className="flex-1 justify-start gap-2"
            size="sm"
            variant="default"
          >
            <Plus className="h-4 w-4" aria-hidden />
            新規セッション
          </Button>
          <OrderModeToggle
            mode={orderMode}
            onToggle={() =>
              setOrderMode(orderMode === "auto" ? "manual" : "auto")
            }
          />
        </div>
        {!activeProjectId && (
          <p className="mt-1.5 px-1 text-[11px] leading-tight text-muted-foreground">
            プロジェクトを選択するとセッションを作成できます
          </p>
        )}
        {orderMode === "manual" && (
          <p className="mt-1.5 px-1 text-[10px] leading-tight text-muted-foreground">
            手動並替モード: 各項目の ⋮⋮ ハンドルでドラッグして順序を変更
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
              <SessionSection
                sessions={visibleSessions}
                orderKey={projectKey}
                orderMode={orderMode}
                sensors={dndSensors}
                onDragEnd={handleDragEnd}
                currentSessionId={currentSessionId}
                activitiesBySession={activitiesBySession}
                statusBySession={statusBySession}
                onLoad={(id) => void handleLoad(id)}
                onRename={(s) => openRename(s)}
                onDelete={(s) => setDeleteTarget(s)}
              />
            )}

          </>
        )}
      </div>

      {/* PM-985: 旧「未分類を表示」toggle は撤去（機能不要のため）。 */}

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

/* ─────────────────────────  Order Mode Toggle  ───────────────────────── */

function OrderModeToggle({
  mode,
  onToggle,
}: {
  mode: "auto" | "manual";
  onToggle: () => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={onToggle}
            aria-pressed={mode === "manual"}
            aria-label={
              mode === "auto"
                ? "手動並替モードに切替"
                : "更新順モードに切替"
            }
          >
            {mode === "auto" ? (
              <Clock className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ListOrdered className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {mode === "auto"
            ? "並び: 更新順 → 手動へ切替"
            : "並び: 手動 → 更新順へ切替"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─────────────────────────  Session Section  ───────────────────────── */

/**
 * PM-983: セクション 1 つ分の session list 描画。
 * orderMode === "manual" のときは DndContext + SortableContext で wrap し、
 * drag&drop 並替を可能にする。auto のときは従来通り motion.ul で描画。
 */
function SessionSection({
  sessions,
  orderKey,
  orderMode,
  sensors,
  onDragEnd,
  currentSessionId,
  activitiesBySession,
  statusBySession,
  onLoad,
  onRename,
  onDelete,
  muted = false,
  keyPrefix = "",
}: {
  sessions: SessionSummary[];
  orderKey: string;
  orderMode: "auto" | "manual";
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (ev: DragEndEvent, targetKey: string, ids: string[]) => void;
  currentSessionId: string | null;
  activitiesBySession: Map<string, ActivityKind>;
  statusBySession: Map<string, SessionStatus>;
  onLoad: (id: string) => void;
  onRename: (s: SessionSummary) => void;
  onDelete: (s: SessionSummary) => void;
  muted?: boolean;
  keyPrefix?: string;
}) {
  const ids = sessions.map((s) => s.id);

  if (orderMode === "manual") {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(ev) => onDragEnd(ev, orderKey, ids)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => (
              <SortableSessionItem
                key={`${keyPrefix}${s.id}`}
                session={s}
                active={s.id === currentSessionId}
                activity={activitiesBySession.get(s.id) ?? "idle"}
                sessionStatus={statusBySession.get(s.id) ?? "idle"}
                onClick={() => onLoad(s.id)}
                onRename={() => onRename(s)}
                onDelete={() => onDelete(s)}
                muted={muted}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    );
  }

  // auto モード（従来動作、アニメーション付き）
  return (
    <motion.ul layout className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {sessions.map((s) => (
          <motion.li
            key={`${keyPrefix}${s.id}`}
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
              sessionStatus={statusBySession.get(s.id) ?? "idle"}
              onClick={() => onLoad(s.id)}
              onRename={() => onRename(s)}
              onDelete={() => onDelete(s)}
              muted={muted}
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

/* ─────────────────────────  Sortable Session Item  ───────────────────────── */

function SortableSessionItem({
  session,
  active,
  activity,
  sessionStatus,
  onClick,
  onRename,
  onDelete,
  muted = false,
}: {
  session: SessionSummary;
  active: boolean;
  activity: ActivityKind;
  sessionStatus: SessionStatus;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  muted?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: session.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-60")}
    >
      <SessionItem
        session={session}
        active={active}
        activity={activity}
        sessionStatus={sessionStatus}
        onClick={onClick}
        onRename={onRename}
        onDelete={onDelete}
        muted={muted}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </li>
  );
}

/* ─────────────────────────  Session Item  ───────────────────────── */

function SessionItem({
  session,
  active,
  activity,
  sessionStatus,
  onClick,
  onRename,
  onDelete,
  muted = false,
  dragHandleProps,
}: {
  session: SessionSummary;
  active: boolean;
  /**
   * v3.5 Chunk C: session 単位の Claude activity。
   * v1.18.0 (DEC-064): session 単位 store から直接引かれるため、pane 切替に
   * 連動しない。load されていない session は `"idle"`（marker 非表示）。
   */
  activity: ActivityKind;
  /**
   * v1.18.0 (DEC-064): session 単位 status。pane 切替とは完全に独立に、session 自身が
   * 保持する揮発状態。right 側のアイコン表示に使う。
   */
  sessionStatus: SessionStatus;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** 未分類セクション用にトーンを落とす */
  muted?: boolean;
  /**
   * PM-983: 手動並替モード時に SortableSessionItem から注入される drag handle props。
   */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
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
        "group relative flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-left transition-colors",
        dragHandleProps ? "pl-7" : "pl-3",
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
      {/* PM-983: drag handle（手動並替モード時のみ表示）。
          handle 内の mousedown だけが DnD を起動するので、card 本体の click
          が壊れない。 */}
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          className="absolute left-1 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          aria-label="ドラッグで並び替え"
          title="ドラッグで並び替え"
          role="button"
        >
          <GripVertical className="h-3 w-3" aria-hidden />
        </div>
      )}
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
        {/* v1.18.0 (DEC-064): session 単位 status icon。pane 切替に連動しない。
            sessionStatus は session 自身が保持する揮発状態。 */}
        <SessionStatusIcon status={sessionStatus} />
        {/* v1.22.5: hover / focus 時に三点ボタンが現れるので、相対時刻を fade out
            して位置の重なりを回避する。group-hover / group-focus-within に追従。 */}
        <span className="shrink-0 text-[10px] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
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
 * v1.18.0 (DEC-064): session 単位 status アイコン。
 *
 * - `thinking`: Loader2 + 回転アニメ + primary color（考え中）
 * - `streaming`: Sparkles + パルスアニメ + primary color（応答中）
 * - `error`: AlertCircle 赤（エラー）
 * - `idle`: 非表示
 *
 * pane 切替で消えない: sessionStatus は session 自身が持つため、どの pane が
 * どの session を指していても、session 自体が思考中ならアイコンは出続ける。
 */
function SessionStatusIcon({ status }: { status: SessionStatus }) {
  if (status === "idle") return null;
  const iconClass = "h-3 w-3 shrink-0";
  if (status === "thinking") {
    return (
      <span
        role="img"
        aria-label="思考中"
        title="思考中"
        className="inline-flex items-center text-primary"
      >
        <Loader2 className={cn(iconClass, "motion-safe:animate-spin")} aria-hidden />
      </span>
    );
  }
  if (status === "streaming") {
    return (
      <span
        role="img"
        aria-label="応答中"
        title="応答中"
        className="inline-flex items-center text-primary"
      >
        <Sparkles className={cn(iconClass, "motion-safe:animate-pulse")} aria-hidden />
      </span>
    );
  }
  // error
  return (
    <span
      role="img"
      aria-label="エラー"
      title="エラー"
      className="inline-flex items-center text-red-500 dark:text-red-400"
    >
      <AlertCircle className={iconClass} aria-hidden />
    </span>
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
