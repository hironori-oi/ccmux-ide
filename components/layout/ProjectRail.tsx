"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Palette, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore } from "@/lib/stores/chat";
import { useSessionStore } from "@/lib/stores/session";
import {
  SIDECAR_STATUS_VISUAL,
  normalizeSidecarStatus,
  type SidecarStatus,
} from "@/lib/sidecar-status";
import type { ProjectStatus } from "@/lib/project-status";
import {
  ACCENT_COLORS,
  getAccentBgClass,
  getAccentChipBgClass,
  getAccentRingClass,
  getAccentTextClass,
  normalizeAccentColor,
  type AccentColor,
} from "@/lib/utils/project-colors";
import type { RegisteredProject } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.20.0 (DEC-066) — Discord / Slack 風のプロジェクトレール。
 *
 * ## v1.20.0 での主要変更 (DEC-066)
 *
 *  1. 右下 status dot / 左下 activity dot を **廃止**。アイコン本体の背景色 +
 *     ring overlay + 中央 overlay icon で状態を表現する (ProjectStatus):
 *       - idle      : accentColor そのまま
 *       - thinking  : ring-primary animate-pulse
 *       - streaming : ring-primary animate-pulse + subtle glow
 *       - completed : 中央に Sparkles アイコン (pulse, 未読強調)
 *       - error     : ring-destructive + AlertTriangle overlay
 *  2. Project の選択状態と **非連動** な volatile status map を store で保持
 *     (`projectStatus[id]`)。session 側 event を集約して反映する。
 *  3. 応答完了を「未読」として継続表示。ユーザーが該当プロジェクトを開くまで
 *     completed 状態が残る。
 *  4. プロジェクトごとの accentColor (19 色プリセット) を右クリックメニュー
 *     から変更可能。選択は即 localStorage に永続化される。
 *
 * ## v1.22.1 patch — 色変更メニューが即閉じする不具合の修正
 *
 *  v1.20.0 で導入した「右クリック → DropdownMenuItem『色を変更』をクリック →
 *  setTimeout(30ms) で別の Popover を open」する設計には、DropdownMenu の close
 *  時 focus 復元 と Popover の outside-click detection が衝突して Popover が
 *  瞬時に閉じる race condition が存在した。本 patch では Radix 標準の
 *  `DropdownMenuSub` / `DropdownMenuSubContent` を使い、19 色 grid を親
 *  DropdownMenu の **submenu** として展開する。Popover 経由を廃止することで、
 *  親メニューが開いている限り submenu も維持され、選択時に親も自然に close する。
 */

/** 10 project 超えの warning 発火閾値（DEC-033 から継続）。 */
const SIDECAR_SOFT_LIMIT = 10;

/**
 * 10 project 超え警告 toast の 1 セッション内連打を防ぐフラグ。
 */
let warnedSoftLimitOnce = false;

/** title から 2〜3 字の頭文字を生成。 */
function getInitials(project: RegisteredProject): string {
  const src = project.title || "";
  const prjMatch = /PRJ-(\d{1,3})/i.exec(src);
  if (prjMatch) {
    return prjMatch[1].padStart(3, "0").slice(-3);
  }
  const parts = src.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (src.length >= 2) return src.slice(0, 2).toUpperCase();
  if (src.length === 1) return src.toUpperCase();
  return "··";
}

/** project status ごとの日本語ラベル (Tooltip / aria-label 用)。 */
const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idle: "待機中",
  thinking: "思考中",
  streaming: "応答中",
  completed: "新着応答あり",
  error: "エラー",
};

export function ProjectRail() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const registerProject = useProjectStore((s) => s.registerProject);
  const clearProjectUnread = useProjectStore((s) => s.clearProjectUnread);
  const sidecarStatusMap = useProjectStore((s) => s.sidecarStatus);
  const projectStatusMap = useProjectStore((s) => s.projectStatus);

  // v1.20.0 (DEC-066): session 側の status/volatile 変化を subscribe して
  // project 集約を随時リフレッシュする。session 追加・削除の tip もここで拾う。
  const sessions = useSessionStore((s) => s.sessions);
  const sessionVolatile = useSessionStore((s) => s.volatile);
  const chatPanes = useChatStore((s) => s.panes);
  const recomputeProjectStatus = useProjectStore(
    (s) => s.recomputeProjectStatus
  );

  useEffect(() => {
    for (const p of projects) {
      recomputeProjectStatus(p.id);
    }
    // deps: sessions / sessionVolatile / chatPanes の変化で再計算。
  }, [projects, sessions, sessionVolatile, chatPanes, recomputeProjectStatus]);

  const [busy, setBusy] = useState(false);
  const highlightAdd = projects.length === 0;

  const handleSelect = useCallback(
    (id: string) => {
      setActiveProject(id);
      // 選択で未読をクリア (UX: アイコンが sparkles → neutral に戻る)
      clearProjectUnread(id);
    },
    [setActiveProject, clearProjectUnread]
  );

  async function handleAdd() {
    if (busy) return;
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "プロジェクトを追加",
      });
      if (typeof selected !== "string") return;
      const project = await registerProject(selected);
      toast.success(`プロジェクトを追加しました: ${project.title}`);

      const currentCount = useProjectStore.getState().projects.length;
      if (currentCount >= SIDECAR_SOFT_LIMIT && !warnedSoftLimitOnce) {
        warnedSoftLimitOnce = true;
        toast.warning(`プロジェクトが ${currentCount} 件を超えました`, {
          description:
            "Claude プロセスを 10 個以上同時に起動するとメモリ消費が増えます（1 プロセスあたり約 200〜300MB）。既存プロジェクトを整理するか、慎重にご利用ください。",
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error(`プロジェクトの追加に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        role="navigation"
        aria-label="プロジェクトレール"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/50 py-2"
      >
        <nav
          aria-label="プロジェクト一覧"
          className="flex flex-1 flex-col items-center gap-1 overflow-y-auto"
        >
          {projects.map((p) => (
            <ProjectRailItem
              key={p.id}
              project={p}
              sidecarStatus={normalizeSidecarStatus(sidecarStatusMap[p.id])}
              projectStatus={projectStatusMap[p.id]?.status ?? "idle"}
              active={p.id === activeProjectId}
              onClick={() => handleSelect(p.id)}
            />
          ))}

          {projects.length === 0 && (
            <div
              className="mt-1 flex w-9 flex-col items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1 py-2 text-center text-[9px] leading-tight text-muted-foreground/80"
              aria-hidden
            >
              <span>下の</span>
              <Plus className="h-3 w-3" aria-hidden />
              <span>から追加</span>
            </div>
          )}
        </nav>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy}
              className={cn(
                "relative flex h-8 w-8 items-center justify-center rounded-md border border-dashed text-muted-foreground transition hover:bg-accent hover:text-foreground",
                busy && "opacity-60",
                highlightAdd && "border-primary/50 text-primary"
              )}
              aria-label="プロジェクトを追加"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {highlightAdd && (
                <span
                  className="pointer-events-none absolute inset-0 -z-0 animate-ping rounded-md bg-primary/20"
                  aria-hidden
                />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="flex flex-col">
              <span className="font-semibold">+ 新しいプロジェクト</span>
              <span className="text-[10px] text-muted-foreground">
                任意のフォルダを登録できます
              </span>
              {projects.length >= SIDECAR_SOFT_LIMIT && (
                <span className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  ※ 登録数が {projects.length} 件（10 以上）になっています
                </span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}

interface ProjectRailItemProps {
  project: RegisteredProject;
  sidecarStatus: SidecarStatus;
  /**
   * v1.20.0 (DEC-066): project 集約 status。ProjectRail 自身が store から
   * 購読し、選択状態とは独立に icon 表現へ反映する。
   */
  projectStatus: ProjectStatus;
  active: boolean;
  onClick: () => void;
}

function ProjectRailItem({
  project,
  sidecarStatus,
  projectStatus,
  active,
  onClick,
}: ProjectRailItemProps) {
  const setProjectAccentColor = useProjectStore((s) => s.setProjectAccentColor);

  const accent = normalizeAccentColor(project.accentColor);
  const bgClass = getAccentBgClass(accent);
  const textClass = getAccentTextClass(accent);
  const accentRing = getAccentRingClass(accent);

  const initials = getInitials(project);
  const title = project.title;
  const statusVisual = SIDECAR_STATUS_VISUAL[sidecarStatus];
  const statusLabel = PROJECT_STATUS_LABEL[projectStatus];

  // v1.22.1: 色変更は DropdownMenuSub に統合したため、Popover open state は
  // 不要になった。menuOpen は右クリック起動と DropdownMenu 制御のために保持。
  const [menuOpen, setMenuOpen] = useState(false);

  const currentAccent = normalizeAccentColor(project.accentColor);

  const handlePickColor = useCallback(
    (color: AccentColor) => {
      setProjectAccentColor(project.id, color === "neutral" ? null : color);
    },
    [project.id, setProjectAccentColor]
  );

  // status に応じた ring / overlay
  const isThinking = projectStatus === "thinking";
  const isStreaming = projectStatus === "streaming";
  const isCompleted = projectStatus === "completed";
  const isError = projectStatus === "error";
  const isActiveStatus = isThinking || isStreaming;

  const ariaLabel = `${title}（Claude: ${statusVisual.label} / ${statusLabel}）`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <motion.button
                  layout
                  type="button"
                  onPointerDown={(e) => {
                    // v1.22.4: Radix DropdownMenu の DropdownMenuTrigger asChild
                    // は左クリックで自動 open する仕様のため、左クリック (button=0)
                    // のみ preventDefault して open を抑制する。これによりクリック
                    // = プロジェクト切替 / 右クリック = メニュー、の役割分離を維持。
                    if (e.button === 0) e.preventDefault();
                  }}
                  onClick={onClick}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuOpen(true);
                  }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-semibold leading-none tracking-tight transition",
                    bgClass,
                    textClass,
                    active &&
                      "ring-2 ring-primary ring-offset-1 ring-offset-background brightness-110",
                    // status 表現: idle/completed/error は ring なし
                    isActiveStatus && [
                      "ring-2 ring-offset-1 ring-offset-background",
                      accentRing,
                      "motion-safe:animate-pulse",
                    ],
                    isStreaming && "shadow-[0_0_12px_-2px_currentColor]",
                    isError &&
                      "ring-2 ring-destructive ring-offset-1 ring-offset-background"
                  )}
                  aria-label={ariaLabel}
                  aria-pressed={active}
                >
                  {initials}

                  {/* completed = 新着応答あり overlay */}
                  {isCompleted && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-background/80 ring-2 ring-primary motion-safe:animate-pulse">
                        <Sparkles className="h-2.5 w-2.5 text-primary" aria-hidden />
                      </span>
                    </span>
                  )}

                  {/* error overlay */}
                  {isError && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-background/80 ring-2 ring-destructive">
                        <AlertTriangle
                          className="h-2.5 w-2.5 text-destructive"
                          aria-hidden
                        />
                      </span>
                    </span>
                  )}
                </motion.button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                className="w-48"
              >
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette className="mr-2 h-3.5 w-3.5" aria-hidden />
                    色を変更
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent
                      sideOffset={4}
                      className="w-auto max-w-[220px] p-3"
                    >
                      <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
                        プロジェクトの色
                      </div>
                      <div
                        role="radiogroup"
                        aria-label="プロジェクトの色を選択"
                        className="grid grid-cols-5 gap-1.5"
                      >
                        {ACCENT_COLORS.map((c) => {
                          const selected = currentAccent === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              aria-label={c.label}
                              title={c.label}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePickColor(c.id);
                                setMenuOpen(false);
                              }}
                              className={cn(
                                "relative flex h-7 w-7 items-center justify-center rounded-md transition",
                                "hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 hover:ring-offset-background",
                                getAccentChipBgClass(c.id),
                                selected &&
                                  "ring-2 ring-primary ring-offset-1 ring-offset-background"
                              )}
                            >
                              {selected && (
                                <Check
                                  className="h-3.5 w-3.5 text-white drop-shadow"
                                  aria-hidden
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-[10px] text-muted-foreground">
                  右クリックでこのメニューを開きます
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {project.phase && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Phase {project.phase}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              aria-hidden
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                statusVisual.dotClassName
              )}
            />
            <span className="text-muted-foreground">
              Claude: {statusVisual.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            {isCompleted ? (
              <Sparkles className="h-3 w-3 text-primary" aria-hidden />
            ) : isError ? (
              <AlertTriangle className="h-3 w-3 text-destructive" aria-hidden />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  isActiveStatus
                    ? "bg-primary motion-safe:animate-pulse"
                    : "bg-muted-foreground/40"
                )}
              />
            )}
            <span
              className={cn(
                "font-medium",
                isCompleted && "text-primary",
                isError && "text-destructive"
              )}
            >
              {statusLabel}
            </span>
          </div>
          {sidecarStatus === "stopped" && (
            <span className="text-[10px] text-muted-foreground/80">
              クリックで Claude を起動します
            </span>
          )}
          {isCompleted && (
            <span className="text-[10px] text-muted-foreground/80">
              クリックで開いて未読をクリア
            </span>
          )}
          <span className="mt-0.5 text-[10px] text-muted-foreground/60">
            右クリックで色変更メニュー
          </span>
        </TooltipContent>
      </Tooltip>
    </>
  );
}

// 外部から import される可能性に備えて re-export (後方互換) — 実体は同ファイル。
export type { RegisteredProject };
