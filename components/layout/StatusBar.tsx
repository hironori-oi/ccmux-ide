"use client";

import { Cpu, GitBranch, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMonitorStore } from "@/lib/stores/monitor";
import { useOAuthUsageStore } from "@/lib/stores/oauth-usage";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore, type ChatActivity } from "@/lib/stores/chat";
import {
  normalizeSidecarStatus,
  type SidecarStatus,
} from "@/lib/sidecar-status";
import {
  ACTIVITY_VISUAL,
  isActiveKind,
  pickDominantActivity,
  type ActivityKind,
} from "@/lib/activity-indicator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OAuthUsageWindow, RegisteredProject } from "@/lib/types";

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

  const oauthUsage = useOAuthUsageStore((s) => s.usage);
  const oauthError = useOAuthUsageStore((s) => s.error);

  // v3.3 Chunk C (DEC-033) + review-v6 fix: Chunk B は sidecarStatus を store の
  // `Record<id, SidecarStatus>` map で保持する。初版は `(project as {...}).sidecarStatus`
  // を参照していたため常に undefined → count=0 固定のバグがあった。本 fix で map
  // を store から subscribe し、project.id でルックアップする方式に変更。
  const projects = useProjectStore((s) => s.projects);
  const sidecarStatusMap = useProjectStore((s) => s.sidecarStatus);
  const activeSidecarCount = countRunningSidecars(projects, sidecarStatusMap);

  // v3.5 Chunk C: chat store の panes 全体の activity を集約して StatusBar に表示。
  // read only（Chunk B 排他境界を守る）。
  const panes = useChatStore((s) => s.panes);
  const activePaneId = useChatStore((s) => s.activePaneId);

  const model = monitor?.model && monitor.model.length > 0
    ? shortModel(monitor.model)
    : "Claude";
  const branch = monitor?.git_branch ?? undefined;

  return (
    <TooltipProvider delayDuration={250}>
    <footer
      aria-label="ステータスバー"
      className="flex h-7 shrink-0 items-center justify-between gap-4 border-t bg-muted/30 px-3 text-[11px] text-muted-foreground"
    >
      {/* 左: model */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Cpu className="h-3 w-3" aria-hidden />
        <span className="truncate font-medium text-foreground/80">{model}</span>
      </div>

      {/* 左 2: active sidecars (Multi-Sidecar, DEC-033) */}
      <ActiveSidecarsIndicator
        count={activeSidecarCount}
        projects={projects}
        sidecarStatusMap={sidecarStatusMap}
      />

      {/* 左 3: Claude activity summary (v3.5 Chunk C) */}
      <ClaudeActivitySummary panes={panes} activePaneId={activePaneId} />

      {/* PM-985: 旧「中央L: context %」（global 最新値）を撤去。
          TrayBar の TrayContextBar (session 別) が代替となるため、StatusBar
          からは削除して重複表示を避ける。 */}

      {/* 中央M: 公式 OAuth ゲージ（Round D'） */}
      <OAuthGaugeSection
        fiveHour={oauthUsage?.fiveHour ?? null}
        sevenDay={oauthUsage?.sevenDay ?? null}
        error={oauthError}
      />

      {/*
       * 中央R: 今日の推定コスト（Stage B）— v3.4.11 で非表示化。
       * 素人ユーザーには $ 金額が意味不明、かつ Stage B の集計誤差もあり、
       * StatusBar のノイズになるため撤去。今後必要なら Settings > Usage 画面
       * で専用に表示する方針。
       */}
      {/* <TodayCostSection cost={todayCost} error={usageError} /> */}

      {/* 右: branch + hotkey
          v1.9.0 (DEC-053): ModelPickerPopover / EffortPickerPopover は TrayBar に
          session 別 picker として移設。StatusBar からは撤去し、OAuth ゲージと
          ClaudeActivitySummary は引き続き表示する。 */}
      <div className="flex items-center gap-2">
        {branch && (
          <span className="ml-1 flex items-center gap-1">
            <GitBranch className="h-3 w-3" aria-hidden />
            <span className="max-w-[160px] truncate font-mono">{branch}</span>
          </span>
        )}
        <span className="ml-1 hidden items-center gap-2 md:flex">
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
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Active sidecars indicator (DEC-033 Multi-Sidecar)
// ---------------------------------------------------------------------------

/**
 * status bar の「⚡ N sidecars」セクション。
 *
 * - count=0 の場合も表示（`⚡ 0 sidecars` 灰）、Tooltip で説明
 * - count>=1 の場合は primary 色、Tooltip で project 一覧を概観
 * - hidden md:flex で狭幅時は省略（model / context 表示優先）
 * - クリック一覧 dropdown は nice-to-have、現状は Tooltip で軽量に代替
 */
function ActiveSidecarsIndicator({
  count,
  projects,
  sidecarStatusMap,
}: {
  count: number;
  projects: RegisteredProject[];
  sidecarStatusMap: Record<string, SidecarStatus>;
}) {
  const getStatus = (p: RegisteredProject) =>
    normalizeSidecarStatus(sidecarStatusMap[p.id]);
  const running = projects.filter((p) => getStatus(p) === "running");
  const starting = projects.filter((p) => getStatus(p) === "starting");
  const errored = projects.filter((p) => getStatus(p) === "error");

  const hasAny = count > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`起動中の Claude プロセス ${count} 個`}
          className={cn(
            "hidden items-center gap-1 rounded px-1 py-0.5 transition hover:bg-muted md:flex",
            hasAny ? "text-foreground/80" : "opacity-60"
          )}
        >
          <Zap
            className={cn(
              "h-3 w-3",
              hasAny
                ? "text-amber-500 dark:text-amber-400"
                : "text-muted-foreground"
            )}
            aria-hidden
          />
          <span className="tabular-nums font-medium">{count}</span>
          <span className="text-muted-foreground">sidecars</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-xs">
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold">
            起動中の Claude プロセス: {count} 個
          </span>
          {count === 0 && (
            <span className="text-muted-foreground">
              まだ Claude プロセスは起動していません。プロジェクトを選択すると起動します。
            </span>
          )}
          {running.length > 0 && (
            <div>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                実行中 ({running.length})
              </span>
              <ul className="mt-0.5 list-disc pl-4 text-[10px] text-muted-foreground">
                {running.slice(0, 5).map((p) => (
                  <li key={p.id} className="truncate">
                    {p.title}
                  </li>
                ))}
                {running.length > 5 && (
                  <li className="text-muted-foreground/60">
                    ほか {running.length - 5} 件…
                  </li>
                )}
              </ul>
            </div>
          )}
          {starting.length > 0 && (
            <div>
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                起動中 ({starting.length})
              </span>
              <ul className="mt-0.5 list-disc pl-4 text-[10px] text-muted-foreground">
                {starting.slice(0, 3).map((p) => (
                  <li key={p.id} className="truncate">
                    {p.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {errored.length > 0 && (
            <div>
              <span className="text-[10px] text-rose-600 dark:text-rose-400">
                エラー ({errored.length})
              </span>
              <ul className="mt-0.5 list-disc pl-4 text-[10px] text-muted-foreground">
                {errored.slice(0, 3).map((p) => (
                  <li key={p.id} className="truncate">
                    {p.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="mt-1 text-[10px] text-muted-foreground/70">
            1 プロセス約 200〜300MB。10 件以上で警告が出ます。
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** status=running / starting の project 数を数える（起動試行中も RAM 消費あり）。 */
function countRunningSidecars(
  projects: RegisteredProject[],
  sidecarStatusMap: Record<string, SidecarStatus>
): number {
  let n = 0;
  for (const p of projects) {
    const s = normalizeSidecarStatus(sidecarStatusMap[p.id]);
    if (s === "running" || s === "starting") n += 1;
  }
  return n;
}

// v3.3 DEC-033 (review-v6): `readSidecarStatus(project)` は削除。
// store の `sidecarStatus` Record を受け取り、project.id で lookup する方式に統一。

// ---------------------------------------------------------------------------
// Claude activity summary (v3.5 Chunk C)
// ---------------------------------------------------------------------------

/**
 * 画面下の「Claude: 応答中...」サマリー。
 *
 * - 全 pane が `idle` / `complete` → 非表示（status bar のノイズにならない）
 * - 1 pane active → 「Claude: {label}」を dot + アニメで
 * - 2 pane split（いずれか active）→ 「Claude: Left 応答中 / Right idle」形式の短縮表記
 *
 * reduced-motion 設定時は `motion-safe:animate-pulse` が自動で無効になる。
 */
function ClaudeActivitySummary({
  panes,
  activePaneId,
}: {
  panes: Record<string, { activity: ChatActivity; currentSessionId: string | null }>;
  activePaneId: string;
}) {
  const paneIds = Object.keys(panes);
  const activities = paneIds.map((id) => panes[id]?.activity).filter(
    (a): a is ChatActivity => Boolean(a)
  );
  const dominant: ActivityKind = pickDominantActivity(activities);

  // すべて idle / complete なら非表示（ノイズ排除）。
  // ただし error は complete と違い idle 扱いにせず、user にすぐ気付かせる。
  const anyActive = activities.some(
    (a) => isActiveKind(a.kind) && a.kind !== "complete"
  );
  if (!anyActive) return null;

  const dominantVisual = ACTIVITY_VISUAL[dominant];

  // 分割 pane 時の個別ラベル（2 pane 以上 + いずれか active）。
  const showPerPane = paneIds.length >= 2;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="hidden min-w-0 items-center gap-1.5 rounded px-1 py-0.5 md:flex"
          aria-label={`Claude: ${dominantVisual.label}`}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              dominantVisual.dotClassName,
              dominantVisual.animate === "pulse" && "motion-safe:animate-pulse",
              dominantVisual.animate === "spin" && "motion-safe:animate-spin"
            )}
          />
          {showPerPane ? (
            <span className="truncate text-[11px]">
              <span className="text-muted-foreground">Claude: </span>
              <SplitPaneLabels panes={panes} activePaneId={activePaneId} />
            </span>
          ) : (
            <span className={cn("truncate text-[11px] font-medium", dominantVisual.color)}>
              Claude: {dominantVisual.label}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        <div className="flex flex-col gap-1">
          <span className="font-semibold">Claude の状況</span>
          <ul className="flex flex-col gap-0.5 text-[10px]">
            {paneIds.map((id, i) => {
              const pane = panes[id];
              if (!pane) return null;
              const v = ACTIVITY_VISUAL[pane.activity.kind];
              const side = paneIds.length >= 2 ? paneLabel(i) : null;
              return (
                <li key={id} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn("inline-block h-1.5 w-1.5 rounded-full", v.dotClassName)}
                  />
                  <span className="text-muted-foreground">
                    {side ? `${side}: ` : ""}
                  </span>
                  <span className={cn(v.color, "font-medium")}>{v.label}</span>
                </li>
              );
            })}
          </ul>
          <span className="mt-0.5 text-[10px] text-muted-foreground/70">
            {dominantVisual.description}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** 分割時の短縮ラベル: `Left 応答中 / Right 待機` 形式。 */
function SplitPaneLabels({
  panes,
  activePaneId,
}: {
  panes: Record<string, { activity: ChatActivity }>;
  activePaneId: string;
}) {
  const ids = Object.keys(panes);
  return (
    <>
      {ids.map((id, i) => {
        const pane = panes[id];
        if (!pane) return null;
        const v = ACTIVITY_VISUAL[pane.activity.kind];
        const isActive = id === activePaneId;
        return (
          <span key={id}>
            {i > 0 && <span className="text-muted-foreground/40"> / </span>}
            <span className={cn("text-muted-foreground", isActive && "underline decoration-dotted")}>
              {paneLabel(i)}
            </span>
            <span className={cn("ml-1", v.color)}>{v.label}</span>
          </span>
        );
      })}
    </>
  );
}

/** 2 pane 想定の簡易 side ラベル（3 pane 以降は `Pane N` にフォールバック）。 */
function paneLabel(idx: number): string {
  if (idx === 0) return "Left";
  if (idx === 1) return "Right";
  return `Pane ${idx + 1}`;
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
// v1.9.0 (DEC-053): TodayCostSection / formatCost / costTextColor /
// contextPercentColor は従来から呼出 0（render から消されたまま）だったため、
// StatusBar の picker 撤去に合わせてクリーンアップ目的で削除した。今後コスト
// 表示が必要になれば Settings > Usage 画面で別途実装する（PRJ-012 方針）。
// ---------------------------------------------------------------------------

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
