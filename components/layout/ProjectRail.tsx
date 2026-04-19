"use client";

import { useEffect } from "react";
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
import type { ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Discord / Slack 風のプロジェクトレール（PRJ-012 Round B / dev-roundB）。
 *
 * Shell 左端に 48px 幅の縦アイコン列を常時表示し、プロジェクト切替を
 * ワンクリックで行えるようにする。既存の Sidebar 上部 ProjectSwitcher
 * はフル情報表示用として残置し、Rail と併用する。
 *
 * - 最上段: ブランド小アイコン（Sparkles）— 現状は装飾、将来 Home 用
 * - 中段: 登録済み projects を縦に並べる（`ProjectRailItem`）
 *    - 48px タッチターゲット / 32px 円形アイコン
 *    - 頭文字 2〜3 字（`PRJ-012` → `012`, `COMPANY-WEBSITE` → `CW`）
 *    - id hash → 8 色から 1 つ（同一 id で常に同色）
 *    - active は `ring-2 ring-primary` + 濃度上げ
 *    - hover は Radix Tooltip で full title + phase
 * - 最下段: 「+」ボタン — dialog で directory を選んで登録
 *
 * アクセシビリティ:
 *  - `<aside role="navigation">` + 日本語 aria-label
 *  - 各 item は `aria-pressed` で active 表明
 */

/**
 * 8 色のアクセントパレット。id の単純 hash で stable に割り当てる。
 * Tailwind の `bg-*-500/20` + `text-*-600` の組み合わせで、
 * 軽いトーンを保ちつつ dark mode でも視認できる明度を確保。
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

/**
 * 文字列から stable に 0..N-1 のインデックスを返す。
 * 軽量な djb2 類似ハッシュ（同一文字列は常に同じ値）。
 */
function hashToColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % ACCENT_CLASSES.length;
}

/**
 * プロジェクト ID から 2〜3 字の頭文字を生成する。
 *
 * - `PRJ-012` → `012`
 * - `COMPANY-WEBSITE` → `CW`
 * - `hello-world` → `HW`
 * - `foo` → `FO`
 */
function getInitials(project: ProjectSummary): string {
  const id = project.id;
  if (id.startsWith("PRJ-")) {
    const tail = id.slice(4, 7);
    if (tail) return tail;
  }
  const parts = id.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return id.slice(0, 2).toUpperCase();
}

export function ProjectRail() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const addProjectFromPath = useProjectStore((s) => s.addProjectFromPath);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  // Sidebar 側の ProjectSwitcher もマウント時に fetchProjects() を呼ぶが、
  // Rail 単独でもデータを持てるよう冗長に呼んでおく（内部で guard されないため
  // 2 回走るが、projects/ 読取のみで副作用は軽微）。
  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  async function handleAdd() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "プロジェクトを追加",
      });
      if (typeof selected !== "string") return;
      await addProjectFromPath(selected);
    } catch (e) {
      toast.error(`プロジェクトの追加に失敗しました: ${String(e)}`);
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        role="navigation"
        aria-label="プロジェクトレール"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/50 py-2"
      >
        {/* ブランド小アイコン（将来 Home 遷移 / 現状は装飾） */}
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
              active={p.id === activeProjectId}
              onClick={() => setActiveProject(p.id)}
            />
          ))}
        </nav>

        {/* 追加ボタン */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleAdd}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="プロジェクトを追加"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            プロジェクトを追加
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}

interface ProjectRailItemProps {
  project: ProjectSummary;
  active: boolean;
  onClick: () => void;
}

function ProjectRailItem({ project, active, onClick }: ProjectRailItemProps) {
  const colorIdx = hashToColorIndex(project.id);
  const initials = getInitials(project);
  const title = project.title ?? project.id;

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
          aria-label={title}
          aria-pressed={active}
        >
          {initials}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2 text-xs">
        <span className="font-medium">{title}</span>
        {project.phase && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Phase {project.phase}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
