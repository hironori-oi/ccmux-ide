/**
 * PRJ-012 v3.3 Chunk C (DEC-033) — Sidecar status 型定義と UI ヘルパ。
 *
 * ## 背景
 *  DEC-033 Multi-Sidecar Architecture で 1 project = 1 Claude プロセス。
 *  各 `RegisteredProject` はランタイムで `sidecarStatus` を保持し、
 *  ProjectRail / ActiveProjectPanel / StatusBar で可視化する。
 *
 * ## 5 状態
 *  - `stopped`  : プロセス未起動（Lazy start 待ち、あるいは停止済）
 *  - `starting` : Tauri `start_agent_sidecar` が走行中（event 未達）
 *  - `running`  : Claude プロセス生存、`agent:ready` 受信済
 *  - `stopping` : `stop_agent_sidecar` 走行中（UI disable 表示）
 *  - `error`    : 起動失敗 / 異常終了（`agent:error` or process exit code !=0）
 *
 * ## 色・ラベル（素人にも分かる色コード + 日本語）
 *  | status   | dot色       | ラベル  | バッジ variant  |
 *  |----------|-------------|---------|------------------|
 *  | stopped  | 灰 (slate)  | 停止中  | secondary        |
 *  | starting | 黄 (amber)  | 起動中  | secondary(amber) |
 *  | running  | 緑 (emerald)| 実行中  | secondary(green) |
 *  | stopping | 灰 (slate)  | 停止中… | secondary        |
 *  | error    | 赤 (rose)   | エラー  | destructive      |
 *
 *  Chunk B が `lib/stores/project.ts` の `RegisteredProject` に
 *  `sidecarStatus?: SidecarStatus` を追加する想定。本ファイルは型の single source。
 *  Chunk B は `import type { SidecarStatus } from "@/lib/sidecar-status";` で参照する。
 */

/** sidecar lifecycle 5 状態。 */
export type SidecarStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/** UI 可視化用の 1 状態あたりメタ情報。 */
export interface SidecarStatusVisual {
  /** 日本語短ラベル（バッジ / tooltip 向け） */
  label: string;
  /** ProjectRail dot 用 bg-* Tailwind class */
  dotClassName: string;
  /** バッジ背景 + text の Tailwind class（shadcn Badge secondary 相当に色付け） */
  badgeClassName: string;
  /** aria-label / tooltip 用の 1 行説明 */
  description: string;
}

/** 5 状態分のマスタ。UI レイヤは必ずこれ経由で参照する。 */
export const SIDECAR_STATUS_VISUAL: Record<SidecarStatus, SidecarStatusVisual> =
  {
    stopped: {
      label: "停止",
      dotClassName: "bg-slate-400 dark:bg-slate-500",
      badgeClassName:
        "border-transparent bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
      description:
        "Claude プロセスは停止中です。プロジェクトを選択すると起動します。",
    },
    starting: {
      label: "起動中",
      dotClassName: "bg-amber-400 dark:bg-amber-500 animate-pulse",
      badgeClassName:
        "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
      description: "Claude プロセスを起動しています。数秒お待ちください。",
    },
    running: {
      label: "実行中",
      dotClassName: "bg-emerald-500 dark:bg-emerald-400",
      badgeClassName:
        "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
      description: "Claude プロセスが実行中です。すぐにチャット可能です。",
    },
    stopping: {
      label: "停止中…",
      dotClassName: "bg-slate-400 dark:bg-slate-500 animate-pulse",
      badgeClassName:
        "border-transparent bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
      description: "Claude プロセスを停止しています。",
    },
    error: {
      label: "エラー",
      dotClassName: "bg-rose-500 dark:bg-rose-400",
      badgeClassName:
        "border-transparent bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
      description:
        "Claude プロセスの起動に失敗しました。ログ（Inspector）を確認してください。",
    },
  };

/**
 * sidecarStatus が undefined（Chunk B 未配線時 / 新規 project 直後）の場合は
 * `stopped` として扱うためのノーマライザ。
 */
export function normalizeSidecarStatus(
  status: SidecarStatus | null | undefined
): SidecarStatus {
  return status ?? "stopped";
}

/**
 * project 切替中（loader 表示）を status 単体から判定するユーティリティ。
 * TitleBar の spinner 表示などで使う。
 */
export function isTransitionalStatus(status: SidecarStatus): boolean {
  return status === "starting" || status === "stopping";
}
