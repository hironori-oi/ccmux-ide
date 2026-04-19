"use client";

import { Cpu, DollarSign, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  selectContextPercent,
  useMonitorStore,
} from "@/lib/stores/monitor";
import { useUsageStore } from "@/lib/stores/usage";

/**
 * PRJ-012 Round C: ステータスバー（画面下端・28px 固定）。
 *
 * Round A（`claude /usage` TUI parse）は Windows 環境で 10 秒 timeout が常態化
 * したため、ここではミニゲージを廃止し、代わりに **Stage B（ローカル JSONL
 * 集計）の「今日の推定コスト」** を表示する。
 *
 * 4 カラム:
 *  - 左:    model 名 + CPU アイコン（未設定時は "Claude"）
 *  - 中央L: context % 簡易ゲージ（色 dot + % テキスト、<60 緑 / <85 黄 / ≥85 赤）
 *  - 中央R: 今日の推定コスト（`$` アイコン + USD、色段階 <$1 緑 / <$5 黄 / ≥$5 赤）
 *  - 右:    git branch + hotkey ヒント（⌘K コマンド / ⌘/ ヘルプ）
 *
 * 集計 fetch 自体は `UsageStatsCard` の `useUsageStats()` が担うため、本 component
 * は store を参照するだけ。Stage B が未ロード・エラー時は `—` placeholder を出す。
 */
export function StatusBar() {
  const monitor = useMonitorStore((s) => s.monitor);
  const percentFromStore = useMonitorStore(selectContextPercent);

  const stats = useUsageStore((s) => s.stats);
  const usageError = useUsageStore((s) => s.error);

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
