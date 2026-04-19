"use client";

import { useMemo } from "react";
import { Activity, CalendarDays, Clock, ExternalLink } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUsageStats } from "@/hooks/useUsageStats";
import { useUsageStore } from "@/lib/stores/usage";
import type { DailyUsage, UsageWindow } from "@/lib/types";

/**
 * Claude Pro/Max 使用量カード（PRJ-012 Stage B）。
 *
 * サイドバー下段（TodosList の下）に配置。`~/.claude/projects/**\/*.jsonl`
 * から Rust backend が集計した session 5h / weekly 7d / daily 使用量を表示する。
 *
 * ## 設計方針
 *
 * - Anthropic 公式の Pro/Max 「5h / weekly limit」の絶対値は公開されていない
 *   ため、**残量パーセント表示はしない**。代わりに絶対値（tokens / cost USD /
 *   message count）と「次のリセット時刻」を表示する。
 * - フッターに `claude.ai/settings/billing` への案内を小さく出し、正確な
 *   プラン制限は公式 Console で確認する導線を提供する。
 * - 料金は推定値（2026-04 時点）。ツールチップで明示する。
 * - ContextGauge と同じデザイン言語（humanizeTokens, 色段階は目盛り警告のみ）。
 */
export function UsageStatsCard() {
  useUsageStats();

  const stats = useUsageStore((s) => s.stats);
  const isLoading = useUsageStore((s) => s.isLoading);
  const error = useUsageStore((s) => s.error);

  // 日別 cost の最大値で bar を正規化。
  const dailyMaxCost = useMemo(() => {
    if (!stats) return 0;
    return stats.daily.reduce((acc, d) => Math.max(acc, d.costUsd), 0);
  }, [stats]);

  // session reset までの残時間（"2h 34m" 形式）
  const sessionRemain = useMemo(() => {
    if (!stats?.sessionResetAt) return null;
    const resetMs = Date.parse(stats.sessionResetAt);
    if (!Number.isFinite(resetMs)) return null;
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return "リセット済み";
    const h = Math.floor(diffMs / (60 * 60 * 1000));
    const m = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }, [stats]);

  // 週次 daily のうち使用があった日数
  const activeDays = useMemo(() => {
    if (!stats) return 0;
    return stats.daily.filter((d) => d.messages > 0).length;
  }, [stats]);

  if (isLoading && !stats) {
    return <UsageStatsSkeleton />;
  }

  if (error && !stats) {
    return (
      <section
        className="flex flex-col gap-1 px-2 py-3 text-[10px] text-muted-foreground"
        aria-label="Claude 使用状況"
      >
        <div className="text-xs font-medium">使用状況</div>
        <div
          className="rounded-md border border-dashed px-2 py-1.5 text-[10px]"
          title={error}
        >
          取得失敗: {error.slice(0, 60)}
        </div>
      </section>
    );
  }

  if (!stats) {
    return <UsageStatsSkeleton />;
  }

  return (
    <section
      className="flex flex-col gap-3 px-2 py-3"
      aria-label="Claude 使用状況"
    >
      {/* Section 1: セッション 5h */}
      <WindowBlock
        icon={<Clock className="h-3 w-3" aria-hidden />}
        title="セッション (5h)"
        remainLabel={sessionRemain ?? undefined}
        window={stats.session5h}
        tooltip="最初のメッセージから 5 時間経過でリセット（推定）。Claude Pro/Max の公式 5h window を ~/.claude/projects の JSONL log から近似。"
      />

      {/* Section 2: 週次 7d */}
      <WindowBlock
        icon={<CalendarDays className="h-3 w-3" aria-hidden />}
        title="週次 (7 日)"
        remainLabel={`${activeDays} / 7 日`}
        window={stats.weekly7d}
        tooltip="過去 7 日間のローリングウィンドウ。Anthropic 公式の weekly limit 値は非公開のため、実測値として表示する。"
      />

      {/* Section 3: 日別 bar chart */}
      <DailyBars daily={stats.daily} maxCost={dailyMaxCost} />

      {/* Footer: プラン制限の導線 */}
      <a
        href="https://claude.ai/settings/billing"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
        title="Anthropic Console でプラン制限を確認"
      >
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
        <span>公式プラン制限を確認</span>
      </a>

      {/* デバッグ: 集計ファイル数（hover で出す） */}
      <div
        className="text-[9px] text-muted-foreground/60"
        title={`集計対象 JSONL: ${stats.sourceFiles} 件（~/.claude/projects/）`}
      >
        推定値 · log {stats.sourceFiles} 件から集計
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: WindowBlock（session_5h / weekly_7d 共通）
// ---------------------------------------------------------------------------

interface WindowBlockProps {
  icon: React.ReactNode;
  title: string;
  /** "2h 34m" / "3 / 7 日" など */
  remainLabel?: string;
  window: UsageWindow;
  tooltip: string;
}

function WindowBlock({
  icon,
  title,
  remainLabel,
  window,
  tooltip,
}: WindowBlockProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border bg-background/40 px-2 py-1.5"
      title={tooltip}
    >
      <header className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
          {icon}
          {title}
        </span>
        {remainLabel && (
          <span className="text-[10px] tabular-nums text-foreground/80">
            {remainLabel}
          </span>
        )}
      </header>

      <div className="flex items-center justify-between text-[10px] tabular-nums">
        <span className="text-muted-foreground">メッセージ</span>
        <span className="font-medium">{window.messages} 件</span>
      </div>
      <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>入出力</span>
        <span>
          入 {humanizeTokens(window.inputTokens)} / 出{" "}
          {humanizeTokens(window.outputTokens)}
        </span>
      </div>
      {(window.cacheReadTokens > 0 || window.cacheCreationTokens > 0) && (
        <div
          className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/80"
          title="キャッシュ読込 / 作成トークン"
        >
          <span>キャッシュ</span>
          <span>
            読 {humanizeTokens(window.cacheReadTokens)} / 作{" "}
            {humanizeTokens(window.cacheCreationTokens)}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] tabular-nums">
        <span className="text-muted-foreground">推定コスト</span>
        <span
          className={cn("font-semibold", costColorClass(window.costUsd))}
          title="2026-04 時点の Anthropic 公開価格を元にした推定値"
        >
          {formatCost(window.costUsd)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: DailyBars
// ---------------------------------------------------------------------------

function DailyBars({ daily, maxCost }: { daily: DailyUsage[]; maxCost: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background/40 px-2 py-1.5">
      <header className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Activity className="h-3 w-3" aria-hidden />
        日別
      </header>
      <ul className="flex flex-col gap-0.5">
        {daily.map((d) => (
          <DailyRow key={d.date} daily={d} maxCost={maxCost} />
        ))}
      </ul>
    </div>
  );
}

function DailyRow({ daily, maxCost }: { daily: DailyUsage; maxCost: number }) {
  const ratio = maxCost > 0 ? Math.min(1, daily.costUsd / maxCost) : 0;
  const pct = Math.round(ratio * 100);
  const label = daily.date.slice(5); // "MM-DD"

  return (
    <li
      className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-1 text-[10px] tabular-nums"
      title={`${daily.date}: ${daily.messages} 件 / 入${humanizeTokens(
        daily.inputTokens
      )} 出${humanizeTokens(daily.outputTokens)} / ${formatCost(daily.costUsd)}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <div
          className={cn(
            "h-full rounded transition-all",
            costBarColor(daily.costUsd)
          )}
          style={{ width: `${pct}%` }}
          aria-label={`日別コスト ${pct}%`}
        />
      </div>
      <span
        className={cn(
          "text-right",
          daily.messages === 0
            ? "text-muted-foreground/40"
            : "text-foreground/80"
        )}
      >
        {formatCost(daily.costUsd)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function UsageStatsSkeleton() {
  return (
    <section
      className="flex flex-col gap-2 px-2 py-3"
      aria-label="Claude 使用状況"
      aria-busy="true"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-20 w-full" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 1000 以上は `35.2k` / 1M 以上は `1.2M` の形式に短縮。 */
function humanizeTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

/** "$12.34" 形式に format。0 は "$0" で短く。 */
function formatCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

/** コストに応じた強調色（ContextGauge と同じ色段階）。 */
function costColorClass(usd: number): string {
  if (usd >= 50) return "text-red-500 dark:text-red-400";
  if (usd >= 10) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/** 日別 bar の色。 */
function costBarColor(usd: number): string {
  if (usd >= 10) return "bg-red-500";
  if (usd >= 3) return "bg-yellow-500";
  if (usd > 0) return "bg-emerald-500";
  return "bg-muted";
}
