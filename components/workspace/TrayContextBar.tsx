"use client";

import { AlertTriangle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMonitorStore, selectMonitorForSession } from "@/lib/stores/monitor";
import { useSessionStore } from "@/lib/stores/session";
import { cn } from "@/lib/utils";

/**
 * PM-984: Tray Bar 内に表示する session 別コンテキスト使用量の横 1 行バッジ。
 *
 * ## レイアウト
 *
 * ```
 * [■■■■░░ 38%]   ← 色付き thin bar + 数値パーセント
 * ```
 *
 * 色段階（サイドバー ContextGauge と同じ閾値）:
 *   <60%  emerald
 *   <85%  yellow
 *   >=85% red + ⚠ icon
 *
 * tooltip で詳細（tokens used / max、model）を表示。
 *
 * ## session 切替時の挙動
 *
 * `useSessionStore.currentSessionId` を subscribe し、その session の snapshot を
 * `selectMonitorForSession` で取得。該当 session が tick をまだ受けていなければ
 * global (最新) monitor を fallback 表示。
 */
export function TrayContextBar() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const monitor = useMonitorStore((s) =>
    selectMonitorForSession(s, currentSessionId)
  );

  // monitor が null（1 度も tick を受けていない）なら非表示
  if (!monitor) {
    return null;
  }

  const percent =
    monitor.tokens_max === 0
      ? 0
      : Math.min(
          100,
          Math.round((monitor.tokens_used / monitor.tokens_max) * 100)
        );
  const nearLimit = percent >= 85;

  const colorText =
    percent >= 85
      ? "text-red-500 dark:text-red-400"
      : percent >= 60
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-emerald-600 dark:text-emerald-400";

  const colorBar =
    percent >= 85
      ? "bg-red-500"
      : percent >= 60
        ? "bg-yellow-500"
        : "bg-emerald-500";

  const trackColor =
    percent >= 85
      ? "bg-red-500/15"
      : percent >= 60
        ? "bg-yellow-500/15"
        : "bg-emerald-500/15";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded border border-border/40 bg-muted/20 px-2 text-[11px]"
            role="status"
            aria-label={`コンテキスト使用量 ${percent}%`}
          >
            {nearLimit && (
              <AlertTriangle
                className={cn("h-3 w-3 shrink-0", colorText)}
                aria-hidden
              />
            )}
            <span className="shrink-0 text-[10px] text-muted-foreground">
              ctx
            </span>
            {/* thin progress bar (60px 固定幅) */}
            <div
              className={cn(
                "relative h-1 w-[60px] shrink-0 overflow-hidden rounded-full",
                trackColor
              )}
              aria-hidden
            >
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full transition-all", colorBar)}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span
              className={cn(
                "shrink-0 tabular-nums font-semibold",
                colorText
              )}
            >
              {percent}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <p>
              <strong>コンテキスト使用量</strong>: {percent}%
            </p>
            <p className="tabular-nums text-[10px] text-muted-foreground">
              {humanizeTokens(monitor.tokens_used)} /{" "}
              {humanizeTokens(monitor.tokens_max)} tokens
            </p>
            {monitor.model && (
              <p className="text-[10px] text-muted-foreground">
                {monitor.model}
              </p>
            )}
            {!currentSessionId && (
              <p className="text-[10px] text-muted-foreground">
                （session 未選択、最新値を表示）
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function humanizeTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  const k = n / 1000;
  return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}
