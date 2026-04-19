"use client";

import { Cpu, DollarSign, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  selectContextPercent,
  useMonitorStore,
} from "@/lib/stores/monitor";
import { useUsageStore } from "@/lib/stores/usage";
import { useOAuthUsageStore } from "@/lib/stores/oauth-usage";
import type { OAuthUsageWindow } from "@/lib/types";

/**
 * PRJ-012 Round D': ステータスバー（画面下端・28px 固定）。
 *
 * 5 カラム:
 *  - 左:    model 名 + CPU アイコン（未設定時は "Claude"）
 *  - 中央L: context % 簡易ゲージ（色 dot + % テキスト、<60 緑 / <85 黄 / ≥85 赤）
 *  - 中央M: **公式 OAuth ゲージ（Round D' 復活）** 5h / 7d の % + リセット
 *  - 中央R: 今日の推定コスト（Stage B、`$` アイコン + USD）
 *  - 右:    git branch + hotkey ヒント（⌘K コマンド / ⌘/ ヘルプ）
 *
 * fetch 自体は `UsageStatsCard` の hook 群（`useUsageStats` +
 * `useClaudeOAuthUsage`）が担うため、本 component は store を参照するだけ。
 * OAuth 取得未完了 / エラー時は `—` placeholder を出し、tooltip で状態を案内する。
 */
export function StatusBar() {
  const monitor = useMonitorStore((s) => s.monitor);
  const percentFromStore = useMonitorStore(selectContextPercent);

  const stats = useUsageStore((s) => s.stats);
  const usageError = useUsageStore((s) => s.error);

  const oauthUsage = useOAuthUsageStore((s) => s.usage);
  const oauthError = useOAuthUsageStore((s) => s.error);

  const model = monitor?.model && monitor.model.length > 0
    ? shortModel(monitor.model)
    : "Claude";
  const branch = monitor?.git_branch ?? undefined;
  const contextPercent = monitor ? percentFromStore : null;

  // daily の末尾 = 今日（Rust 側が 7 日分を昇順で返してくる）
  const todayCost = stats?.daily?.[stats.daily.length - 1]?.costUsd ?? null;

  return (
    <footer
      aria-label="ステータスバー"
      className="flex h-7 shrink-0 items-center justify-between gap-4 border-t bg-muted/30 px-3 text-[11px] text-muted-foreground"
    >
      {/* 左: model */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Cpu className="h-3 w-3" aria-hidden />
        <span className="truncate font-medium text-foreground/80">{model}</span>
      </div>

      {/* 中央L: context % */}
      <div className="flex items-center gap-1.5">
        {contextPercent !== null ? (
          <>
            <span
              aria-hidden
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                contextPercentColor(contextPercent)
              )}
            />
            <span
              aria-label={`コンテキスト使用率 ${contextPercent}%`}
              className="tabular-nums"
            >
              コンテキスト {Math.round(contextPercent)}%
            </span>
          </>
        ) : (
          <span className="opacity-60">コンテキスト --</span>
        )}
      </div>

      {/* 中央M: 公式 OAuth ゲージ（Round D'） */}
      <OAuthGaugeSection
        fiveHour={oauthUsage?.fiveHour ?? null}
        sevenDay={oauthUsage?.sevenDay ?? null}
        error={oauthError}
      />

      {/* 中央R: 今日の推定コスト（Stage B） */}
      <TodayCostSection cost={todayCost} error={usageError} />

      {/* 右: branch + hotkey */}
      <div className="flex items-center gap-3">
        {branch && (
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" aria-hidden />
            <span className="max-w-[160px] truncate font-mono">{branch}</span>
          </span>
        )}
        <span className="hidden items-center gap-2 md:flex">
          <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
          <span>コマンド</span>
          <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">
            ⌘/
          </kbd>
          <span>ヘルプ</span>
        </span>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// 公式 OAuth 使用率ゲージ（Round D'）
// ---------------------------------------------------------------------------

interface OAuthGaugeSectionProps {
  fiveHour: OAuthUsageWindow | null;
  sevenDay: OAuthUsageWindow | null;
  error: string | null;
}

/**
 * 5h / 7d の使用率 % + リセット時刻の mini-gauge。
 *
 * - 値あり: `5h: 45% ▓▓░░ ~19:00  |  7d: 62% ▓▓▓░ 4/24` 形式
 * - 値なし: `5h: —  |  7d: —` placeholder（tooltip で状態説明）
 * - `hidden lg:flex` でナローウィンドウでは省略
 *
 * color は <60 緑 / <85 黄 / >=85 赤 の 3 段階。
 */
function OAuthGaugeSection({ fiveHour, sevenDay, error }: OAuthGaugeSectionProps) {
  const tooltip = error
    ? `公式 OAuth API 取得失敗: ${error}`
    : "Claude OAuth Usage API から 5 分 cache で取得";

  return (
    <div
      className="hidden items-center gap-2 lg:flex"
      title={tooltip}
      aria-label="公式 OAuth レート制限"
    >
      <OAuthMiniGauge label="5h" window={fiveHour} showTime />
      <span className="text-muted-foreground/40" aria-hidden>|</span>
      <OAuthMiniGauge label="7d" window={sevenDay} showDate />
    </div>
  );
}

/**
 * `label: NN% ▓▓░ HH:mm` の mini gauge。
 *
 * `window` が null の場合は `label: —` placeholder。
 */
function OAuthMiniGauge({
  label,
  window,
  showTime,
  showDate,
}: {
  label: string;
  window: OAuthUsageWindow | null;
  showTime?: boolean;
  showDate?: boolean;
}) {
  if (!window) {
    return (
      <span className="inline-flex items-center gap-1 opacity-60" aria-label={`${label} 取得未完了`}>
        <span className="tabular-nums">{label}:</span>
        <span>—</span>
      </span>
    );
  }

  const pct = clampPercent(window.utilization);
  const resetText = formatShortResetTime(window.resetsAt, {
    withTime: showTime,
    withDate: showDate,
  });

  return (
    <span className="inline-flex items-center gap-1" aria-label={`${label} 使用率 ${pct.toFixed(0)}%`}>
      <span className="tabular-nums text-muted-foreground">{label}:</span>
      <span className={cn("tabular-nums font-medium", utilizationTextColor(pct))}>
        {pct.toFixed(0)}%
      </span>
      <span
        className="h-1 w-8 overflow-hidden rounded bg-muted"
        aria-hidden
      >
        <span
          className={cn("block h-full rounded", utilizationBarBg(pct))}
          style={{ width: `${pct}%` }}
        />
      </span>
      {resetText && (
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">{resetText}</span>
      )}
    </span>
  );
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function utilizationTextColor(p: number): string {
  if (p >= 85) return "text-red-500 dark:text-red-400";
  if (p >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function utilizationBarBg(p: number): string {
  if (p >= 85) return "bg-red-500";
  if (p >= 60) return "bg-yellow-500";
  return "bg-emerald-500";
}

/**
 * StatusBar 用の短い reset 時刻表記。
 * - `withTime=true`: `~HH:mm`（5h 用）
 * - `withDate=true`: `M/D`（7d 用）
 *
 * どちらも無効 / null なら null を返す。
 */
function formatShortResetTime(
  iso: string | null,
  { withTime, withDate }: { withTime?: boolean; withDate?: boolean },
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);

  if (withTime) {
    const fmt = new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `~${fmt.format(d)}`;
  }
  if (withDate) {
    const fmt = new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
    });
    return fmt.format(d);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 今日の推定コスト (Stage B)
// ---------------------------------------------------------------------------

interface TodayCostSectionProps {
  cost: number | null;
  error: string | null;
}

/**
 * Stage B の今日分コストを表示する mini-section。
 *
 * - ロード中 / エラー / データ無し → `—` placeholder（タイトル属性でエラー内容表示）
 * - 値あり → `$1.23` 形式 + 色段階（<$1 緑 / <$5 黄 / >=$5 赤）
 *
 * `hidden md:flex` でナローウィンドウでは省略（status bar の全体幅を確保するため）。
 */
function TodayCostSection({ cost, error }: TodayCostSectionProps) {
  if (cost === null) {
    return (
      <div
        className="hidden items-center gap-1 opacity-60 md:flex"
        title={
          error
            ? `Stage B 集計エラー: ${error}`
            : "今日のローカル集計コスト（推定値、取得中）"
        }
        aria-label="今日の推定コスト"
      >
        <DollarSign className="h-3 w-3" aria-hidden />
        <span>—</span>
      </div>
    );
  }

  return (
    <div
      className="hidden items-center gap-1 md:flex"
      title="今日のローカル集計コスト（推定値）"
      aria-label={`今日の推定コスト ${formatCost(cost)}`}
    >
      <DollarSign
        className={cn("h-3 w-3", costTextColor(cost))}
        aria-hidden
      />
      <span className={cn("font-medium tabular-nums", costTextColor(cost))}>
        {formatCost(cost)}
      </span>
      <span className="text-[10px] text-muted-foreground/70">今日</span>
    </div>
  );
}

/** `$0` / `$1.23` / `$12` の桁に応じた簡易 format。 */
function formatCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

/** 今日コストの色段階（<$1 緑 / <$5 黄 / >=$5 赤）。 */
function costTextColor(usd: number): string {
  if (usd >= 5) return "text-red-500 dark:text-red-400";
  if (usd >= 1) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

/**
 * context 使用率の段階色。Chunk 2 の ContextGauge（PM-165）と同じ閾値。
 */
function contextPercentColor(p: number): string {
  if (p >= 85) return "bg-red-500";
  if (p >= 60) return "bg-yellow-500";
  return "bg-green-500";
}

/**
 * `"claude-opus-4-7[1m]"` → `"opus-4.7 1M"` 形式に短縮。
 * ContextGauge と同じ表記に揃えるための最小実装。
 */
function shortModel(model: string): string {
  const m = model.toLowerCase();
  const is1m = m.includes("[1m]") || m.includes("-1m");
  let base = m;
  if (m.includes("opus-4-7")) base = "opus-4.7";
  else if (m.includes("opus-4-6")) base = "opus-4.6";
  else if (m.includes("opus-4-5")) base = "opus-4.5";
  else if (m.includes("sonnet-4-6")) base = "sonnet-4.6";
  else if (m.includes("sonnet-4-5")) base = "sonnet-4.5";
  else if (m.includes("haiku-4-5")) base = "haiku-4.5";
  else if (m.startsWith("claude-")) base = m.slice("claude-".length);
  return is1m ? `${base} 1M` : base;
}
