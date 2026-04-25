"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Github, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * v1.22.2 (PRJ-012): Settings > 外観タブの末尾に差し込む「Sumi について」セクション。
 *
 * - アプリのバージョン番号（`@tauri-apps/api/app::getVersion()`）
 * - ライセンス（MIT）と短い英語タグライン
 * - GitHub リポジトリ / CHANGELOG への外部リンク
 *   （`@tauri-apps/plugin-shell` の `open` で OS の既定ブラウザを起動）
 *
 * 専用タブを増やすほどコンテンツが多くないため、`AppearanceSettings` の末尾に
 * 含める軽量な独立セクション。
 */
const REPO_URL = "https://github.com/hironori-oi/ccmux-ide";
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

async function openExternal(href: string): Promise<void> {
  try {
    const mod = await import("@tauri-apps/plugin-shell");
    await mod.open(href);
  } catch (err) {
    // dev preview や plugin 未利用環境では window.open に fallback
    // eslint-disable-next-line no-console
    console.warn("[AboutSection] shell.open failed, fallback to window.open", err);
    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }
}

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);

  // Tauri API は client side のみ。useEffect 内で動的 import + getVersion()。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@tauri-apps/api/app");
        const v = await mod.getVersion();
        if (!cancelled) setVersion(v);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[AboutSection] getVersion failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const versionLabel = version ? `v${version}` : "—";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Info className="h-4 w-4" aria-hidden />
          Sumi について
        </h3>
        <p className="text-xs text-muted-foreground">
          このアプリのバージョン情報、ライセンス、ソースコード。
        </p>
      </div>

      <div className="space-y-2 rounded-md border bg-muted/30 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold tracking-tight">Sumi</span>
          <span className="font-mono text-base tabular-nums text-foreground/90">
            {versionLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Japanese-first Claude Code desktop client (Tauri + Next.js)
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          Licensed under the MIT License.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openExternal(REPO_URL)}
          className="gap-2"
          aria-label="GitHub リポジトリを開く"
        >
          <Github className="h-3.5 w-3.5" aria-hidden />
          GitHub リポジトリ
          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void openExternal(CHANGELOG_URL)}
          className="gap-2"
          aria-label="CHANGELOG を開く"
        >
          CHANGELOG
          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </div>
    </Card>
  );
}
