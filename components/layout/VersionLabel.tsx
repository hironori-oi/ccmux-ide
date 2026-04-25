"use client";

import { useEffect, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * v1.22.2: StatusBar 右端に表示するアプリのバージョンラベル。
 *
 * - `@tauri-apps/api/app::getVersion()` を `useEffect` 内で呼び、
 *   Tauri の `tauri.conf.json` から実行時に動的取得する。
 *   render 中に呼ぶと SSR / 静的 export で undefined → React error #185
 *   を引き起こすため、必ず mount 後に setState で反映する。
 * - 取得前 / 取得失敗時は em-dash (`—`) を placeholder として描画し、
 *   レイアウトが揺れないように tabular-nums を使用する。
 * - 視覚: `text-[11px] font-mono tabular-nums text-muted-foreground` で
 *   既存 OAuth ゲージ / branch 表示と同じ控えめなトーンに揃える。
 * - Tooltip で「Sumi v{x.y.z}」を表示し、StatusBar 上の数字だけでも
 *   バージョン把握できるようにする。
 *
 * Tauri が走っていないブラウザ（dev 時の Next.js プレビュー）では
 * `getVersion()` が reject するため、catch して em-dash を維持する。
 */
export function VersionLabel() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@tauri-apps/api/app");
        const v = await mod.getVersion();
        if (!cancelled) setVersion(v);
      } catch (err) {
        // dev preview / 取得失敗 → em-dash 維持
        // eslint-disable-next-line no-console
        console.warn("[VersionLabel] getVersion failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const label = version ? `v${version}` : "—";
  const tooltip = version ? `Sumi v${version}` : "Sumi（バージョン取得中）";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={tooltip}
          className="hidden cursor-default font-mono text-[11px] tabular-nums text-muted-foreground/80 sm:inline-block"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <span className="font-medium">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}
