"use client";

import { Cpu, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  selectContextPercent,
  useMonitorStore,
} from "@/lib/stores/monitor";

/**
 * PM-172: ステータスバー（画面下端・28px 固定）。
 *
 * 3 カラム:
 *  - 左:   model 名 + CPU アイコン（未設定時は "Claude"）
 *  - 中央: context % 簡易ゲージ（色 dot + % テキスト、<60 緑 / <85 黄 / ≥85 赤）
 *  - 右:   git branch + hotkey ヒント（⌘K コマンド / ⌘/ ヘルプ）
 *
 * Chunk 2 の `useMonitorStore` が push する `MonitorState`（snake_case）から
 * 必要な値を selector 経由で購読する。`monitor:tick` が未到達（sidecar が
 * まだ返答していない）ときは fallback 表示になる。
 * Shell.tsx（Chunk 2）の下端にそのまま流し込む前提で、自身の幅は親 flex に従う。
 */
export function StatusBar() {
  const monitor = useMonitorStore((s) => s.monitor);
  const percentFromStore = useMonitorStore(selectContextPercent);

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

      {/* 中央: context % */}
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
