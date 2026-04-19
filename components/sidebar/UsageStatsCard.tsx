"use client";

import { useMemo } from "react";
import {
  Activity,
  CalendarDays,
  Clock,
  ExternalLink,
  Layers,
  ShieldCheck,
  Users,
} from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUsageStats } from "@/hooks/useUsageStats";
import { useUsageStore } from "@/lib/stores/usage";
import type {
  DailyUsage,
  Last24h,
  ModelBreakdown,
  UsageWindow,
} from "@/lib/types";

/**
 * Claude Pro/Max 使用量カード（PRJ-012 Round C）。
 *
 * サイドバー下段（TodosList の下）に配置。`~/.claude/projects/**\/*.jsonl`
 * から Rust backend が集計した session 5h / weekly 7d / daily 使用量を表示する。
 *
 * ## Round C での変更点
 *
 * - Round A の `claude /usage` 自動取得は Windows で 10 秒タイムアウト常態化
 *   のため **廃止**。代わりに `公式レート制限` ブロックは Anthropic Console
 *   への外部リンクカードに格下げ。
 * - Stage B（ローカル JSONL 集計）を強化:
 *   - モデル別内訳（top 5 + others の横棒）を週次の下に追加
 *   - Last 24h セッション detail（長時間 / 背景ループ / subagent 検出）を追加
 *
 * ## 設計方針
 *
 * - Anthropic 公式の Pro/Max 「5h / weekly limit」の絶対値は公開されていない
 *   ため、**残量パーセント表示はしない**。絶対値（tokens / cost USD /
 *   message count）と「次のリセット時刻」を表示する。
 * - 料金は推定値（2026-04 時点）。ツールチップ + footer で明示する。
 * - Last 24h の long/background/subagent は heuristic。「目安」として提示。
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
      {/* Section 0: 公式レート制限（Round C で外部リンクカードに格下げ） */}
      <OfficialRateLimitsBlock />

      {/* 区切り: ここから先は自前の JSONL 集計 */}
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-muted-foreground/60">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>Stage B（ローカル JSONL 集計）</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

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

      {/* Section 3: モデル別内訳（週次ベース、Round C 追加） */}
      <ModelBreakdownBlock
        models={stats.weekly7d.byModel ?? []}
        totalCost={stats.weekly7d.costUsd}
      />

      {/* Section 4: Last 24h セッション（Round C 追加） */}
      <Last24hBlock last24h={stats.last24h} />

      {/* Section 5: 日別 bar chart */}
      <DailyBars daily={stats.daily} maxCost={dailyMaxCost} />

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
// Subcomponent: OfficialRateLimitsBlock（Round C 軽量版）
//
// Round A の `claude /usage` TUI parse は Windows で 10 秒 timeout が常態化し
// 実用不可と判明したため、ここは Anthropic Console への外部リンクカードに
// 格下げ。`useClaudeRateLimits` の自動 poll は呼ばない。
//
// `ClaudeRateLimits` 型 / `useClaudeUsageStore` / `claude_usage.rs` は将来
// 公式 JSON mode が実装された際に復活させるため、残しておく（dead code）。
// ---------------------------------------------------------------------------

function OfficialRateLimitsBlock() {
  const handleOpen = () => {
    void openExternal("https://claude.ai/settings/billing").catch((e) => {
      // plugin-shell が未許可 / 失敗した場合は console.error に留める
      // （UI 側の表示崩れは起こさない）。
      console.error("[UsageStatsCard] open billing failed:", e);
    });
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
      <header className="flex items-center gap-1 text-xs font-medium text-foreground/80">
        <ShieldCheck className="h-3 w-3 text-primary" aria-hidden />
        公式レート制限
      </header>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Claude Code CLI の <code className="font-mono text-[9px]">/usage</code>{" "}
        は対話モード専用で、ccmux-ide からは自動取得できません。公式プランの残量は
        Anthropic Console で確認してください。
      </p>

      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "inline-flex items-center justify-center gap-1 rounded border border-primary/40 bg-background/60 px-2 py-1 text-[10px] font-medium",
          "text-foreground/90 transition-colors hover:bg-primary/10 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        aria-label="Anthropic Console を開いて残量を確認"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        Console で残量を確認
      </button>
    </div>
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
// Subcomponent: ModelBreakdownBlock（Round C 追加、X-ray 風 stacked bar）
// ---------------------------------------------------------------------------

interface ModelBreakdownBlockProps {
  models: ModelBreakdown[];
  totalCost: number;
}

/**
 * 週次のモデル別コスト内訳を横並び stacked bar + 明細で表示する。
 *
 * - 上段: 幅 100% の bar を cost 比率で塗り分け（モデルごとに色違い）
 * - 下段: 各モデルの `{name}: $x.xx ({pct}%)` list
 *
 * アクセントカラーとの干渉を避けるため、色は lucide アイコンではなく
 * `hsl(...)` 直指定で固定。未集計 / 空配列時は helper メッセージに切替。
 */
function ModelBreakdownBlock({ models, totalCost }: ModelBreakdownBlockProps) {
  if (models.length === 0 || totalCost <= 0) {
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-background/40 px-2 py-1.5">
        <header className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Layers className="h-3 w-3" aria-hidden />
          モデル別内訳 (7 日)
        </header>
        <div className="text-[10px] text-muted-foreground/70">
          データなし
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border bg-background/40 px-2 py-1.5"
      title="過去 7 日間のモデル別コスト内訳（推定）。top 5 + others にまとめて表示。"
    >
      <header className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
          <Layers className="h-3 w-3" aria-hidden />
          モデル別内訳 (7 日)
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          合計 {formatCost(totalCost)}
        </span>
      </header>

      {/* 上段: stacked bar（flex で cost 比率に応じて伸縮） */}
      <div
        className="flex h-2 overflow-hidden rounded bg-muted"
        role="img"
        aria-label="モデル別コスト比率"
      >
        {models.map((m, i) => {
          const pct = totalCost > 0 ? (m.costUsd / totalCost) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <span
              key={`${m.model}-${i}`}
              className="h-full"
              style={{
                width: `${pct}%`,
                backgroundColor: modelColor(m.model),
              }}
              title={`${m.model}: ${formatCost(m.costUsd)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* 下段: 明細 list */}
      <ul className="flex flex-col gap-0.5">
        {models.map((m, i) => {
          const pct = totalCost > 0 ? (m.costUsd / totalCost) * 100 : 0;
          return (
            <li
              key={`${m.model}-row-${i}`}
              className="grid grid-cols-[0.5rem_1fr_auto_3rem] items-center gap-1.5 text-[10px] tabular-nums"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: modelColor(m.model) }}
                aria-hidden
              />
              <span className="truncate text-foreground/80">{m.model}</span>
              <span className="text-muted-foreground">
                {pct.toFixed(1)}%
              </span>
              <span className="text-right font-medium text-foreground/90">
                {formatCost(m.costUsd)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * モデルファミリごとの表示色。アクセントカラー（`--primary`）と
 * 競合しないよう hsl 直指定で固定（Settings の AccentPicker の影響を受けない）。
 *
 * - Opus 系: オレンジ系（ブランドと近いがアクセントではない色相固定）
 * - Sonnet 系: 青系
 * - Haiku 系: 緑系
 * - others / 未知: グレー系
 */
function modelColor(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("opus")) return "hsl(25 90% 55%)"; // orange
  if (n.startsWith("sonnet")) return "hsl(215 85% 55%)"; // blue
  if (n.startsWith("haiku")) return "hsl(150 60% 45%)"; // green
  if (n === "others") return "hsl(220 10% 55%)"; // gray
  return "hsl(280 40% 55%)"; // purple for unknown
}

// ---------------------------------------------------------------------------
// Subcomponent: Last24hBlock（Round C 追加）
// ---------------------------------------------------------------------------

/**
 * 過去 24h のセッション detail を 3x2 grid で表示する。
 *
 * 値はすべて heuristic（Rust 側 `compute_stats` の detection ロジック参照）。
 * ツールチップで検出基準を明示し「目安」である旨を伝える。
 */
function Last24hBlock({ last24h }: { last24h: Last24h }) {
  const cells: Array<{
    label: string;
    value: number | string;
    hint: string;
  }> = [
    {
      label: "セッション",
      value: last24h.sessionCount,
      hint: "過去 24h に少なくとも 1 メッセージがあった JSONL ファイル数。",
    },
    {
      label: "メッセージ",
      value: last24h.messageCount,
      hint: "過去 24h の assistant message 件数（集計対象のみ）。",
    },
    {
      label: "長時間",
      value: last24h.longSessions,
      hint: "1 セッション内の最古〜最新 timestamp 差が 30 分以上（heuristic）。",
    },
    {
      label: "背景ループ",
      value: last24h.backgroundSessions,
      hint: "連続メッセージ間隔が 5 分以内のペアが 10 組以上（heuristic）。",
    },
    {
      label: "subagent",
      value: last24h.subagentMessages,
      hint: "parentToolUseId / Task tool 検出ベース（heuristic）。",
    },
    {
      label: "コスト",
      value: formatCost(last24h.costUsd),
      hint: "過去 24h のローカル集計コスト（推定）。",
    },
  ];

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border bg-background/40 px-2 py-1.5"
      title="過去 24h のセッション detail（heuristic 検出ベース、目安）"
    >
      <header className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Users className="h-3 w-3" aria-hidden />
        直近 24h セッション
      </header>
      <ul className="grid grid-cols-3 gap-1">
        {cells.map((c) => (
          <li
            key={c.label}
            className="flex flex-col items-center rounded border border-border/50 px-1 py-1"
            title={c.hint}
          >
            <span className="text-[11px] font-semibold tabular-nums text-foreground/90">
              {c.value}
            </span>
            <span className="text-[9px] text-muted-foreground">{c.label}</span>
          </li>
        ))}
      </ul>
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
      <Skeleton className="h-16 w-full" />
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
