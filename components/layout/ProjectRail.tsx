"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore, type ChatActivity } from "@/lib/stores/chat";
import {
  SIDECAR_STATUS_VISUAL,
  normalizeSidecarStatus,
  type SidecarStatus,
} from "@/lib/sidecar-status";
import {
  ACTIVITY_VISUAL,
  isActiveKind,
  pickDominantActivity,
  type ActivityKind,
} from "@/lib/activity-indicator";
import type { RegisteredProject } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Discord / Slack 風のプロジェクトレール（PRJ-012 Round B / v3.2 Chunk A /
 * v3.3 Chunk C DEC-033）。
 *
 * Shell 左端に 48px 幅の縦アイコン列を常時表示し、プロジェクト切替を
 * ワンクリックで行えるようにする。
 *
 * ## v3.3 Chunk C 改修（DEC-033 Multi-Sidecar）
 *  - 各 project アイコンに **sidecar status dot**（右下 6px）を追加
 *    - 実行中=緑 / 起動中=黄(pulse) / 停止=灰 / 停止中=灰(pulse) / エラー=赤
 *  - **10 project warning**: 登録数が 10 以上になったら toast.warning で注意喚起
 *    （Claude プロセスも同数起動し、メモリ消費が増えるため）
 *  - Lazy start ヒント: status=stopped の tooltip に「クリックで Claude を起動」案内
 *  - 既存の onClick → `setActiveProject(id)` は維持。Chunk B 改修により内部で
 *    `ensureSidecarRunning` が自動発火する契約（Chunk C から直接 invoke しない）
 *
 * ## v3.2 Chunk A（DEC-031）以降の基盤
 *  - store は registry 型（`RegisteredProject[]`）
 *  - `+` ボタンが first-class な project 追加経路（初見時 pulse）
 *  - DropdownMenuTrigger / 右クリック / 長押しは廃止、削除は ActiveProjectPanel 一本化
 */

/** 10 project 超えの warning 発火閾値（DEC-033）。 */
const SIDECAR_SOFT_LIMIT = 10;

/**
 * 10 project 超え警告 toast の 1 セッション内連打を防ぐフラグ。
 * module scope なので HMR 時にリセットされる（開発中は都度出て問題ない）。
 */
let warnedSoftLimitOnce = false;

/**
 * 8 色のアクセントパレット。`RegisteredProject.colorIdx` に対応。
 */
const ACCENT_CLASSES: readonly string[] = [
  "bg-blue-500/20 text-blue-600 dark:bg-blue-500/30 dark:text-blue-300",
  "bg-emerald-500/20 text-emerald-600 dark:bg-emerald-500/30 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-700 dark:bg-amber-500/30 dark:text-amber-300",
  "bg-rose-500/20 text-rose-600 dark:bg-rose-500/30 dark:text-rose-300",
  "bg-violet-500/20 text-violet-600 dark:bg-violet-500/30 dark:text-violet-300",
  "bg-cyan-500/20 text-cyan-600 dark:bg-cyan-500/30 dark:text-cyan-300",
  "bg-pink-500/20 text-pink-600 dark:bg-pink-500/30 dark:text-pink-300",
  "bg-teal-500/20 text-teal-600 dark:bg-teal-500/30 dark:text-teal-300",
] as const;

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

export function ProjectRail() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const registerProject = useProjectStore((s) => s.registerProject);
  // v3.3 DEC-033 (review-v6): Chunk B は sidecarStatus を Record<id, status> の
  // 別 map で保持している。初版は `project.sidecarStatus` field を読もうとして
  // undefined になっていた（dot が全部灰色）。store の map を直接参照する。
  const sidecarStatusMap = useProjectStore((s) => s.sidecarStatus);

  // v3.5 Chunk C + v3.5.10 改修: 各 project の activity を可視化。
  // - active project: chat store の現在 panes から集約
  // - 非 active project: chat store の projectSnapshots[projectId] から集約
  //   （v3.5.9 で project 切替時に panes を snapshot 保存している）
  // これにより「他のプロジェクトに切替えても、裏で思考中の dot が表示される」UX を実現。
  const panes = useChatStore((s) => s.panes);
  const projectSnapshots = useChatStore((s) => s.projectSnapshots);

  /** 任意 projectId について dominant activity を返す（active なら panes、それ以外は snapshot） */
  const activityForProject = useCallback(
    (projectId: string): ActivityKind => {
      const isActive = projectId === activeProjectId;
      const source = isActive
        ? panes
        : projectSnapshots[projectId] ?? null;
      if (!source) return "idle";
      const activities: ChatActivity[] = Object.values(source).map(
        (p) => p.activity
      );
      if (activities.length === 0) return "idle";
      return pickDominantActivity(activities);
    },
    [panes, projectSnapshots, activeProjectId]
  );

  const [busy, setBusy] = useState(false);

  const highlightAdd = projects.length === 0;

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

      // v3.3 DEC-033: 10 project 超えで warning toast。
      // 登録直後の projects.length は non-existent（set 済だが closure 外）ので、
      // store から最新を取り直す。
      const currentCount = useProjectStore.getState().projects.length;
      if (currentCount >= SIDECAR_SOFT_LIMIT && !warnedSoftLimitOnce) {
        warnedSoftLimitOnce = true;
        toast.warning(
          `プロジェクトが ${currentCount} 件を超えました`,
          {
            description:
              "Claude プロセスを 10 個以上同時に起動するとメモリ消費が増えます（1 プロセスあたり約 200〜300MB）。既存プロジェクトを整理するか、慎重にご利用ください。",
            duration: 8000,
          }
        );
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
        {/* ブランド小アイコン */}
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md"
          aria-hidden
        >
          <Sparkles className="h-4 w-4 text-primary" />
        </div>

        <div className="my-1 h-px w-6 bg-border" aria-hidden />

        {/* プロジェクト一覧 */}
        <nav
          aria-label="プロジェクト一覧"
          className="flex flex-1 flex-col items-center gap-1 overflow-y-auto"
        >
          {projects.map((p) => (
            <ProjectRailItem
              key={p.id}
              project={p}
              sidecarStatus={normalizeSidecarStatus(sidecarStatusMap[p.id])}
              activity={activityForProject(p.id)}
              active={p.id === activeProjectId}
              onClick={() => setActiveProject(p.id)}
            />
          ))}

          {/* 空 registry プレースホルダー */}
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

        {/* 追加ボタン */}
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
  /** v3.3 DEC-033 (review-v6): store からの per-project sidecar status。 */
  sidecarStatus: SidecarStatus;
  /**
   * v3.5 Chunk C: 当該 project の Claude activity（dominant 値）。
   * idle の場合は activity overlay を非表示にする。
   * 現状 `ChatPaneState` に projectId が無いため、非 active project は常に idle。
   */
  activity: ActivityKind;
  active: boolean;
  onClick: () => void;
}

function ProjectRailItem({
  project,
  sidecarStatus,
  activity,
  active,
  onClick,
}: ProjectRailItemProps) {
  const colorIdx =
    typeof project.colorIdx === "number"
      ? ((project.colorIdx % ACCENT_CLASSES.length) + ACCENT_CLASSES.length) %
        ACCENT_CLASSES.length
      : 0;
  const initials = getInitials(project);
  const title = project.title;

  const statusVisual = SIDECAR_STATUS_VISUAL[sidecarStatus];
  const activityVisual = ACTIVITY_VISUAL[activity];
  const showActivity = isActiveKind(activity);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          layout
          type="button"
          onClick={onClick}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-semibold leading-none tracking-tight transition",
            ACCENT_CLASSES[colorIdx],
            active &&
              "ring-2 ring-primary ring-offset-1 ring-offset-background brightness-110"
          )}
          aria-label={
            showActivity
              ? `${title}（Claude: ${statusVisual.label} / ${activityVisual.label}）`
              : `${title}（Claude: ${statusVisual.label}）`
          }
          aria-pressed={active}
        >
          {initials}
          {/* v3.3 DEC-033: sidecar status dot（右下 6px 絶対配置） */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background",
              statusVisual.dotClassName
            )}
          />
          {/* v3.5 Chunk C: activity dot（左下 6px 絶対配置、idle 時は非表示） */}
          {showActivity && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute -bottom-0.5 -left-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                activityVisual.dotClassName,
                activityVisual.animate === "pulse" && "motion-safe:animate-pulse",
                activityVisual.animate === "spin" && "motion-safe:animate-spin"
              )}
            />
          )}
        </motion.button>
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
            className={cn("inline-block h-1.5 w-1.5 rounded-full", statusVisual.dotClassName)}
          />
          <span className="text-muted-foreground">Claude: {statusVisual.label}</span>
        </div>
        {showActivity && (
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              aria-hidden
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                activityVisual.dotClassName,
                activityVisual.animate === "pulse" && "motion-safe:animate-pulse"
              )}
            />
            <span className={cn("font-medium", activityVisual.color)}>
              {activityVisual.label}
            </span>
          </div>
        )}
        {sidecarStatus === "stopped" && (
          <span className="text-[10px] text-muted-foreground/80">
            クリックで Claude を起動します
          </span>
        )}
        {sidecarStatus === "error" && (
          <span className="text-[10px] text-rose-500 dark:text-rose-400">
            起動に失敗しました。再度クリックで再試行できます。
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// v3.3 DEC-033 (review-v6): `readSidecarStatus(project)` は削除。
// Chunk B の正しい API（store.sidecarStatus[id]）に parent 側で subscribe し、
// 子 component には prop として status を渡す設計に変更したため不要。
