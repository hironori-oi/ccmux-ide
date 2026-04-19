"use client";

import { AlertTriangle, Clock, Cpu, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  selectContextPercent,
  useMonitorStore,
} from "@/lib/stores/monitor";
import { useClaudeUsageStore } from "@/lib/stores/claude-usage";
import { useClaudeRateLimits } from "@/hooks/useClaudeRateLimits";
import type { ClaudeRateLimits } from "@/lib/types";

/**
 * PM-172 / PRJ-012 Round A: ステータスバー（画面下端・28px 固定）。
 *
 * 4 カラム:
 *  - 左:    model 名 + CPU アイコン（未設定時は "Claude"）
 *  - 中央L: context % 簡易ゲージ（色 dot + % テキスト、<60 緑 / <85 黄 / ≥85 赤）
 *  - 中央R: Claude CLI レート制限（5h reset + Weekly Sonnet %、PRJ-012 Round A）
 *  - 右:    git branch + hotkey ヒント（⌘K コマンド / ⌘/ ヘルプ）
 *
 * `useClaudeRateLimits()` をここでマウントすることで 30 秒 poll が始まる。
 * 同じ store を `UsageStatsCard` も購読するので、サイドバーが折り畳まれていても
 * StatusBar が単独でフェッチを継続する。Rust 側に 30 秒 cache があるため
 * Sidebar との二重マウントでも CLI spawn は実質 30 秒に 1 回。
 */
export function StatusBar() {
  const monitor = useMonitorStore((s) => s.monitor);
  const percentFromStore = useMonitorStore(selectContextPercent);

  // PRJ-012 Round A: claude /usage の自動 poll を開始
  useClaudeRateLimits();
  const limits = useClaudeUsageStore((s) => s.limits);
  const limitsError = useClaudeUsageStore((s) => s.error);

  const model = monitor?.model && monitor.model.length > 0
    ? shortModel(monitor.model)
    : "Claude";
  const branch = monitor?.git_branch ?? undefined;
  const contextPercent = monitor ? percentFromStore : null;

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

      {/* 中央R: Claude /usage 公式レート制限 */}
      <RateLimitsSection limits={limits} error={limitsError} />

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
// Rate limits sub-section
// ---------------------------------------------------------------------------

interface RateLimitsSectionProps {
  limits: ClaudeRateLimits | null;
  error: string | null;
}

/**
 * `5h: 9pm | 週: 51% ▓▓▓░░ Apr24` のような 1 行を出す。情報が取れていない
 * フィールドは静かに省略し、何も無ければ `—` placeholder。
 *
 * Sonnet only の % が一番情報量があるため優先表示。閾値は ContextGauge と
 * 揃えて <60 緑 / <85 黄 / ≥85 赤、≥85 で AlertTriangle アイコンを併記する。
 */
function RateLimitsSection({ limits, error }: RateLimitsSectionProps) {
  if (error && !limits) {
    return (
      <div
        className="flex items-center gap-1 opacity-60"
        title={`Claude /usage 取得失敗: ${error}`}
      >
        <Clock className="h-3 w-3" aria-hidden />
        <span>—</span>
      </div>
    );
  }

  if (!limits) {
    return (
      <div className="flex items-center gap-1 opacity-60" title="Claude /usage を取得中…">
        <Clock className="h-3 w-3" aria-hidden />
        <span>—</span>
      </div>
    );
  }

  const sonnetPct = limits.weeklySonnetPercent;
  const sessionReset = limits.sessionResetAt;
  const weeklyReset = limits.weeklySonnetResetAt ?? limits.weeklyAllResetAt;

  const tooltip = [
    sessionReset ? `セッション (5h) リセット: ${sessionReset}` : null,
    limits.weeklyAllResetAt
      ? `週次 (全モデル) リセット: ${limits.weeklyAllResetAt}` +
        (limits.weeklyAllPercent !== null
          ? ` (${limits.weeklyAllPercent}% 使用)`
          : "")
      : null,
    limits.weeklySonnetResetAt
      ? `週次 (Sonnet) リセット: ${limits.weeklySonnetResetAt}` +
        (sonnetPct !== null ? ` (${sonnetPct}% 使用)` : "")
      : null,
    "詳細はサイドバーの使用状況カードを参照",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="hidden items-center gap-3 lg:flex"
      title={tooltip}
      aria-label="Claude レート制限"
    >
      {/* 5h session */}
      {sessionReset && (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">5h: {shortenReset(sessionReset)}</span>
        </span>
      )}

      {/* Weekly Sonnet only %（あれば優先） */}
      {(sonnetPct !== null || weeklyReset) && (
        <span className="flex items-center gap-1.5">
          {sonnetPct !== null && sonnetPct >= 85 && (
            <AlertTriangle
              className={cn("h-3 w-3", weeklyPercentTextColor(sonnetPct))}
              aria-hidden
            />
          )}
          <span className="text-foreground/70">週:</span>
          {sonnetPct !== null ? (
            <>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  weeklyPercentTextColor(sonnetPct)
                )}
              >
                {sonnetPct}%
              </span>
              <PercentBar percent={sonnetPct} />
            </>
          ) : (
            <span className="opacity-60">--%</span>
          )}
          {weeklyReset && (
            <span className="tabular-nums opacity-70">
              {shortenReset(weeklyReset)}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * インライン bar（4 セグメント）。文字情報の補助なので過剰な装飾はしない。
 */
function PercentBar({ percent }: { percent: number }) {
  const filled = Math.min(4, Math.max(0, Math.round((percent / 100) * 4)));
  return (
    <span aria-hidden className="inline-flex gap-[1px]">
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-[1px]",
            i < filled ? weeklyPercentBarColor(percent) : "bg-muted"
          )}
        />
      ))}
    </span>
  );
}

/**
 * `"Apr 24, 5am (Etc/GMT-9)"` を `"Apr24 5am"` 程度に短縮する（StatusBar
 * 表示用）。タイムゾーン表記は tooltip に残すのでここでは捨てる。
 */
function shortenReset(raw: string): string {
  const tzStripped = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // 「Apr 24, 5am」→「Apr24 5am」
  return tzStripped.replace(/^(\w{3})\s+(\d+),\s*/, "$1$2 ");
}

function weeklyPercentTextColor(p: number): string {
  if (p >= 85) return "text-red-500 dark:text-red-400";
  if (p >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function weeklyPercentBarColor(p: number): string {
  if (p >= 85) return "bg-red-500";
  if (p >= 60) return "bg-yellow-500";
  return "bg-emerald-500";
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
