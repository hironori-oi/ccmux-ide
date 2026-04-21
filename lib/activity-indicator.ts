/**
 * PRJ-012 v3.5 Chunk C — Claude activity の視覚化ヘルパ。
 *
 * ## 背景
 *
 * Chunk B で `chat.ts` の state を `panes: Record<paneId, ChatPaneState>` に
 * 分離した結果、「このプロジェクト / セッションは今 Claude が何をしているか」を
 * 一目で示す dot / icon を複数箇所（ProjectRail / SessionList / StatusBar）
 * で再利用する必要が出た。`lib/sidecar-status.ts` と同じ philosophy で、
 * アイコン色・アニメ・ラベルの single source として本ファイルを用意する。
 *
 * ## 役割
 *
 * - `ACTIVITY_VISUAL`: `ChatActivity["kind"]` ごとの色・アニメ・ラベル・説明
 * - `pickDominantActivity`: 複数 pane の activity から 1 つの「代表値」を選出
 * - `isActiveKind`: idle / complete 以外（= 目立たせるべき状態）判定 util
 *
 * ## 設計メモ
 *
 * 1. **色は既存 Tailwind パレットに統一** — ActivityIndicator.tsx と同じ hue
 *    （thinking=amber, streaming=violet, tool_use=sky, error=rose, complete=emerald）。
 *    `lib/sidecar-status.ts` の emerald/amber/slate/rose と衝突しないよう、
 *    activity 側は **violet/sky** を主軸に使って差別化する。
 * 2. **アニメは `pulse` / `spin` / `none` の 3 値のみ** — reduced-motion 時は
 *    consumer 側で `motion-safe:` プレフィックスを付けて止められるよう
 *    class 名を直出ししない（animate キーで判断する API）。
 * 3. **dominant 選出は緊急度順** — `error > tool_use > streaming > thinking
 *    > complete > idle`。UI 側で「何もしていないのに赤 dot が残る」のを
 *    防ぐため、error は 5 秒で idle に戻る前提（ActivityIndicator.tsx の
 *    既存ロジックと同じ）。
 */

import type { ChatActivity } from "@/lib/stores/chat";

/** `ChatActivity["kind"]` の別名。 */
export type ActivityKind = ChatActivity["kind"];

/** `ACTIVITY_VISUAL[kind]` の値の型。 */
export interface ActivityVisual {
  /** lucide アイコン色（text-{color}-500 系）。`dotClassName` 側にも同じ hue を使う。 */
  color: string;
  /** dot 用 bg-* 色（SessionList / ProjectRail overlay で利用）。 */
  dotClassName: string;
  /** アニメ種別。`"none"` は静止。consumer が motion-safe: prefix で disable 可能。 */
  animate: "pulse" | "spin" | "none";
  /** 短縮ラベル（hover Tooltip / StatusBar 用、日本語）。 */
  label: string;
  /** 詳細説明（aria-label / Tooltip body）。 */
  description: string;
}

/**
 * Claude activity 6 状態の視覚メタ情報。
 *
 * - `idle`     : 何もしていない → 表示しない（呼び出し側で早期 return 前提）
 * - `thinking` : 推論中（reasoning） → amber pulse
 * - `streaming`: テキスト生成中 → violet pulse
 * - `tool_use` : tool 実行中 → sky pulse
 * - `complete` : 完了直後 → emerald 静止（3 秒で idle に戻る）
 * - `error`    : エラー → rose 静止
 */
export const ACTIVITY_VISUAL: Record<ActivityKind, ActivityVisual> = {
  idle: {
    color: "text-muted-foreground",
    dotClassName: "bg-muted-foreground/30",
    animate: "none",
    label: "待機中",
    description: "Claude は待機中です。",
  },
  thinking: {
    color: "text-amber-500 dark:text-amber-400",
    dotClassName: "bg-amber-500 dark:bg-amber-400",
    animate: "pulse",
    label: "思考中",
    description: "Claude が考えています。",
  },
  streaming: {
    color: "text-violet-500 dark:text-violet-400",
    dotClassName: "bg-violet-500 dark:bg-violet-400",
    animate: "pulse",
    label: "応答中",
    description: "Claude が応答を生成しています。",
  },
  tool_use: {
    color: "text-sky-500 dark:text-sky-400",
    dotClassName: "bg-sky-500 dark:bg-sky-400",
    animate: "pulse",
    label: "ツール実行中",
    description: "Claude がツール（ファイル読み書き / コマンド等）を実行しています。",
  },
  complete: {
    color: "text-emerald-500 dark:text-emerald-400",
    dotClassName: "bg-emerald-500 dark:bg-emerald-400",
    animate: "none",
    label: "完了",
    description: "直前の応答が完了しました。",
  },
  error: {
    color: "text-rose-500 dark:text-rose-400",
    dotClassName: "bg-rose-500 dark:bg-rose-400",
    animate: "none",
    label: "エラー",
    description: "Claude の実行でエラーが発生しました。",
  },
};

/** `pickDominantActivity` が使う優先度（高いほど代表値として選ばれやすい）。 */
const KIND_PRIORITY: Record<ActivityKind, number> = {
  error: 5,
  tool_use: 4,
  streaming: 3,
  thinking: 2,
  complete: 1,
  idle: 0,
};

/**
 * 複数 pane の activity から「代表値」を 1 つ選ぶ。
 *
 * 優先度: `error > tool_use > streaming > thinking > complete > idle`。
 *
 * ProjectRail / SessionList で「このプロジェクトは今何してる？」を 1 dot で
 * 表現するのに使う（分割 pane 時に 2 つ indicator を出すと dot が増えすぎる
 * ため、集約表現を主とする方針）。
 *
 * StatusBar は分割時の個別 label（「Left 応答中 / Right idle」）を出すため
 * この関数ではなく `activities[]` を直接舐める。
 *
 * @param activities 対象 pane の activity 配列（順序不問、空配列なら `idle`）
 */
export function pickDominantActivity(activities: ChatActivity[]): ActivityKind {
  if (activities.length === 0) return "idle";
  let best: ActivityKind = "idle";
  let bestPriority = -1;
  for (const a of activities) {
    const p = KIND_PRIORITY[a.kind] ?? -1;
    if (p > bestPriority) {
      best = a.kind;
      bestPriority = p;
    }
  }
  return best;
}

/**
 * dot / indicator を画面に出すべきか判定する shortcut。
 * `idle` は常に false、`complete` は 3 秒後に自動 idle 化されるため
 * consumer 側の要件次第（現状は「出す」側に倒す）。
 */
export function isActiveKind(kind: ActivityKind): boolean {
  return kind !== "idle";
}

/**
 * `ChatActivity` を受け取って visual を返す薄いラッパ。
 * `tool_use` の `toolName` を description に足したい等の拡張用に、
 * ここで一元化しておく。
 */
export function describeActivity(activity: ChatActivity): ActivityVisual {
  const base = ACTIVITY_VISUAL[activity.kind];
  if (activity.kind === "tool_use") {
    return {
      ...base,
      description: `ツール「${activity.toolName}」を実行しています。`,
    };
  }
  if (activity.kind === "error" && activity.message) {
    return {
      ...base,
      description: `エラー: ${activity.message}`,
    };
  }
  return base;
}
