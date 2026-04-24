"use client";

import React from "react";

/**
 * v1.16.0 / DEC-062: UpdateNotifier を包む独自 ErrorBoundary。
 *
 * ## 背景
 * M3 MVP 時に `UpdateNotifier` が React error #185 容疑で Shell 側で disable
 * されたまま v1.15.0 まで放置されていた。v1.16.0 で再マウントするにあたり、
 * 万一 Notifier が例外を投げてもアプリ本体に波及しないよう境界を張る。
 *
 * ## 挙動
 *  - 正常時: children をそのまま描画
 *  - 例外発生時:
 *    - `console.error` にスタックトレースを吐いてテレメトリに残す
 *    - `crashed=true` を state に保持、以降は **children を描画しない**
 *      → 再マウントによる再クラッシュを防止
 *    - `NODE_ENV === "development"` のときは画面右下に「updater disabled」
 *      の fallback badge を表示（prod は silent）
 *
 * ## 採用理由（react-error-boundary dep 非導入）
 *  - v1.16.0 で唯一の ErrorBoundary 利用箇所。依存を 1 行増やすより自前の
 *    16 行 class component で足りる。
 *  - SSR 互換のため `"use client"` のみで完結。
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  crashed: boolean;
  errorMessage: string | null;
}

export class UpdateNotifierBoundary extends React.Component<Props, State> {
  state: State = { crashed: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return {
      crashed: true,
      errorMessage: error?.message ?? "unknown error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      "[UpdateNotifierBoundary] UpdateNotifier がクラッシュしました。以降は disable します。",
      error,
      info
    );
  }

  render() {
    if (this.state.crashed) {
      if (process.env.NODE_ENV === "development") {
        return (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-2 right-2 z-50 rounded-md border border-destructive/60 bg-background/90 px-2 py-1 text-[10px] text-destructive shadow"
          >
            updater disabled: {this.state.errorMessage}
          </div>
        );
      }
      return null;
    }
    return this.props.children;
  }
}
