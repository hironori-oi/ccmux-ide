"use client";

import { AlertTriangle, GitBranch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  selectContextPercent,
  selectIsNearLimit,
  useMonitorStore,
} from "@/lib/stores/monitor";

/**
 * サイドバー下段のコンテキスト使用量ゲージ（PM-165）。
 *
 * 色段階（Tailwind class で直書き、oklch 統一は M3 で）:
 *   <60%  緑系
 *   <85%  黄系
 *  >=85%  赤系 + 警告アイコン
 *
 * 表示項目:
 *   - 「コンテキスト使用量」ラベル
 *   - 数値パーセント
 *   - shadcn Progress バー（上記色段階）
 *   - `<used>k / <max>k` 形式（1000 未満はそのまま）
 *   - model 名の Badge
 *   - git branch（取得できていれば）
 */
export function ContextGauge() {
  const monitor = useMonitorStore((s) => s.monitor);
  const percent = useMonitorStore(selectContextPercent);
  const nearLimit = useMonitorStore(selectIsNearLimit);

  // 未初期化（sidecar がまだ 1 度も tick を発していない）時の placeholder。
  if (!monitor) {
    return (
      <div
        className="flex flex-col gap-2 px-2 py-3 text-xs text-muted-foreground"
        aria-label="コンテキスト使用量"
      >
        <div className="flex items-center justify-between">
          <span>コンテキスト使用量</span>
          <span className="tabular-nums">—</span>
        </div>
        <Progress value={0} className="h-1.5" />
        <div className="text-[10px] opacity-60">Claude からの応答を待機中…</div>
      </div>
    );
  }

  const colorTextClass =
    percent >= 85
      ? "text-red-500 dark:text-red-400"
      : percent >= 60
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-emerald-600 dark:text-emerald-400";

  // shadcn Progress は inner bar の色を className で上書きできないので、
  // track に `[&>*]:bg-<color>` を流し込む方式で色段階を表現する。
  const colorBarClass =
    percent >= 85
      ? "[&>*]:bg-red-500 bg-red-500/15"
      : percent >= 60
      ? "[&>*]:bg-yellow-500 bg-yellow-500/15"
      : "[&>*]:bg-emerald-500 bg-emerald-500/15";

  return (
    <div
      className="flex flex-col gap-1.5 px-2 py-3"
      aria-label="コンテキスト使用量"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">
          コンテキスト使用量
        </span>
        <span
          className={cn(
            "flex items-center gap-1 tabular-nums font-semibold",
            colorTextClass
          )}
        >
          {nearLimit && (
            <AlertTriangle
              className="h-3 w-3"
              aria-label="残量わずか"
            />
          )}
          {percent}%
        </span>
      </div>

      <Progress
        value={percent}
        className={cn("h-1.5", colorBarClass)}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      />

      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>
          {humanizeTokens(monitor.tokens_used)} /{" "}
          {humanizeTokens(monitor.tokens_max)} tokens
        </span>
        <span>残り {100 - percent}%</span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {monitor.model && (
          <Badge
            variant="secondary"
            className="px-1.5 py-0 text-[10px] font-normal"
            title={monitor.model}
          >
            {shortModel(monitor.model)}
          </Badge>
        )}
        {monitor.git_branch && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
            title={`ブランチ: ${monitor.git_branch}`}
          >
            <GitBranch className="h-3 w-3" aria-hidden />
            <span className="max-w-[120px] truncate">
              {monitor.git_branch}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/** 1000 以上は `35.2k` のような短縮、未満はそのまま整数で返す。 */
function humanizeTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  const k = n / 1000;
  return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}

/**
 * "claude-opus-4-7[1m]" → "opus-4-7 (1M)" のように簡略化。
 * Badge の文字数上限 (~12 字) を超えないよう配慮。
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
