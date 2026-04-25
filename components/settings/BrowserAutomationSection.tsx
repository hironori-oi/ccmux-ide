"use client";

import { useEffect, useState } from "react";
import {
  Chrome,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callTauri } from "@/lib/tauri-api";
import {
  HARD_DEFAULT_PREFERENCES,
  useSessionPreferencesStore,
} from "@/lib/stores/session-preferences";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore, DEFAULT_PANE_ID } from "@/lib/stores/chat";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.24.0 (DEC-070): Settings の「ブラウザ操作」section。
 *
 * Claude Code 公式の `--chrome` / `/chrome` ブラウザ操作機能 (Phase 1 MVP) を
 * Sumi に統合する UI 入口。
 *
 * ## 構成
 * - 機能説明: navigate / click / form 入力 / screenshot を Claude に依頼可能
 * - Chrome 拡張インストールボタン: chromewebstore.google.com を OS 既定ブラウザで開く
 * - デフォルト ON toggle: 当 project の sticky として Chrome 連携を毎回 ON にする
 *   - 既定 OFF: context 消費が増えるため `/chrome` で都度 ON 推奨
 * - CLI version 表示: 起動時に `claude --version` を 1 回呼び、2.0.73 未満なら warning
 * - ヘルプリンク: 公式 docs (code.claude.com/docs/ja/chrome)
 * - トラブルシュートヒント: 拡張未検知時の対処
 *
 * ## デフォルト ON toggle の persist 経路
 * 「project sticky」として `useSessionPreferencesStore.perProject[activeProjectId]
 * .chromeEnabled` に保存する。これにより同 project の次回 session 起動時に
 * `chromeEnabled: true` で初期化され、自動で `--chrome` flag が CLI に付く。
 * project が選択されていない場合は toggle 自体を disable する（DEC-057 sticky
 * 設計と整合）。
 */
const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn";
const CHROME_DOCS_URL = "https://code.claude.com/docs/ja/chrome";

const REQUIRED_CLI_VERSION = "2.0.73";

export function BrowserAutomationSection() {
  // ---------------------------------------------------------------------------
  // CLI version 検出 (起動時に 1 回)
  // ---------------------------------------------------------------------------
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliVersionLoading, setCliVersionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await callTauri<string | null>("claude_version");
        if (cancelled) return;
        setCliVersion(v ?? null);
      } catch {
        if (cancelled) return;
        setCliVersion(null);
      } finally {
        if (!cancelled) setCliVersionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 手動再検出
  async function refreshCliVersion() {
    setCliVersionLoading(true);
    try {
      const v = await callTauri<string | null>("claude_version");
      setCliVersion(v ?? null);
      if (!v) {
        toast.warning(
          "Claude Code CLI が見つかりませんでした。インストール状況をご確認ください。",
        );
      } else {
        toast.success(`Claude Code CLI v${v} を検出しました`);
      }
    } catch (e) {
      setCliVersion(null);
      toast.error(
        `CLI バージョン取得に失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setCliVersionLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // デフォルト ON toggle (project sticky)
  // ---------------------------------------------------------------------------
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectChromeEnabled = useSessionPreferencesStore(
    (s) => (activeProjectId ? s.perProject[activeProjectId]?.chromeEnabled : undefined) ?? false,
  );
  const setPreference = useSessionPreferencesStore((s) => s.setPreference);

  // 現在表示中の session も同期更新する（toggle を切替えた直後の send で即反映）。
  // pane → currentSessionId の取得は DEFAULT_PANE_ID を使う（settings 画面では
  // pane 概念が存在しないため、active pane = default 1 つ）。
  const currentSessionIdForActivePane = useChatStore(
    (s) => s.panes[DEFAULT_PANE_ID]?.currentSessionId ?? null,
  );

  function toggleChromeDefault() {
    if (!activeProjectId) {
      toast.warning(
        "プロジェクトが選択されていません。サイドバーからプロジェクトを開いてください。",
      );
      return;
    }
    const next = !projectChromeEnabled;
    // perSession（現 session）にも即時反映するため sessionId は現値、未作成なら null。
    // setPreference は projectId 非 null なら perProject も同時更新する設計。
    setPreference(currentSessionIdForActivePane ?? "__settings_no_session__", activeProjectId, {
      chromeEnabled: next,
    });
    if (next) {
      toast.success(
        "Chrome 連携をデフォルト ON にしました。次の送信から `--chrome` フラグが付きます。",
      );
    } else {
      toast.message(
        "Chrome 連携をデフォルト OFF にしました。`/chrome` で都度有効化できます。",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 外部リンク (Tauri shell.open)
  // ---------------------------------------------------------------------------
  async function openExternal(url: string) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (e) {
      toast.error(
        `外部ブラウザで開けませんでした: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CLI version 比較
  // ---------------------------------------------------------------------------
  const cliMeetsRequirement =
    cliVersion !== null && compareSemver(cliVersion, REQUIRED_CLI_VERSION) >= 0;

  return (
    <div className="space-y-6">
      {/* 機能説明 */}
      <section className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Chrome 拡張と連携して、Claude にブラウザ操作（navigate / click /
          フォーム入力 / screenshot 等）を依頼できます。組み込み MCP
          <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            claude-in-chrome
          </code>
          経由で動作します。Anthropic 直契約プラン (Pro / Max / Team / Enterprise)
          のみ利用可能です。
        </p>
      </section>

      {/* CLI version 表示 */}
      <section className="rounded-md border bg-muted/30 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Claude Code CLI バージョン
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {cliVersionLoading
                ? "確認中..."
                : cliVersion === null
                  ? "Claude Code CLI が見つかりません"
                  : `検出: v${cliVersion}（必要バージョン: v${REQUIRED_CLI_VERSION} 以上）`}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshCliVersion}
            disabled={cliVersionLoading}
            className="gap-1"
            aria-label="CLI バージョンを再確認"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                cliVersionLoading && "animate-spin",
              )}
              aria-hidden
            />
            再確認
          </Button>
        </div>
        {!cliVersionLoading && cliVersion === null && (
          <div className="mt-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            <div>
              Claude Code CLI が PATH 上に見つかりません。
              <code className="mx-1 rounded bg-background/50 px-1 font-mono">
                npm install -g @anthropic-ai/claude-code
              </code>
              などでインストールしてから「再確認」してください。
            </div>
          </div>
        )}
        {!cliVersionLoading && cliVersion !== null && !cliMeetsRequirement && (
          <div className="mt-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            <div>
              Claude Code CLI v{REQUIRED_CLI_VERSION} 以上が必要です。CLI を更新してください
              （
              <code className="mx-1 rounded bg-background/50 px-1 font-mono">
                npm update -g @anthropic-ai/claude-code
              </code>
              ）。
            </div>
          </div>
        )}
      </section>

      {/* Chrome 拡張インストール */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Chrome className="h-4 w-4" aria-hidden />
          Chrome 拡張をインストール
        </h3>
        <p className="text-[11px] text-muted-foreground">
          公式拡張「Claude in Chrome」を Chrome ウェブストアからインストールしてください。
          初回起動で Native Messaging Host が自動配置されるため、インストール後は
          Chrome を 1 度再起動してください。
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openExternal(CHROME_EXTENSION_URL)}
          className="gap-2"
        >
          <Chrome className="h-3.5 w-3.5" aria-hidden />
          Chrome ウェブストアで開く
          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </section>

      {/* デフォルト ON toggle */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Chrome 連携の既定値</h3>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">Chrome デフォルト ON</div>
            <div className="text-[11px] text-muted-foreground">
              ON にすると毎回
              <code className="mx-1 rounded bg-background/50 px-1 font-mono">
                --chrome
              </code>
              フラグ付きで Claude を起動します。context 消費が増えるため、必要時のみ
              <code className="mx-1 rounded bg-background/50 px-1 font-mono">
                /chrome
              </code>
              で都度有効化を推奨します。
              {!activeProjectId && (
                <span className="mt-1 block text-amber-600 dark:text-amber-500">
                  ※ プロジェクトを選択していないため切替できません
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={projectChromeEnabled}
            onClick={toggleChromeDefault}
            disabled={!activeProjectId}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              projectChromeEnabled
                ? "border-primary bg-primary"
                : "border-border bg-muted",
            )}
            aria-label={
              projectChromeEnabled
                ? "Chrome 連携のデフォルトを OFF にする"
                : "Chrome 連携のデフォルトを ON にする"
            }
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform",
                projectChromeEnabled ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      {/* トラブルシュート */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">トラブルシュート</h3>
        <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted-foreground">
          <li>
            拡張が検知されない場合は Chrome を再起動 → 入力欄で
            <code className="mx-1 rounded bg-muted px-1 font-mono">/chrome</code>
            を実行 →「Reconnect extension」を選択してください。
          </li>
          <li>
            Brave / Arc / WSL は公式サポート外です（chrome.exe / google-chrome
            の安定版で動作確認されています）。
          </li>
          <li>
            既存 Chrome プロファイルを使うため、ログイン中の Cookie がそのまま
            Claude のブラウザ操作に共有されます（公式既定）。
          </li>
        </ul>
      </section>

      {/* ヘルプリンク */}
      <section>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openExternal(CHROME_DOCS_URL)}
          className="gap-2 text-xs"
        >
          公式ドキュメントを開く
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Button>
      </section>

      {/* 開発者向けの内部 default 表示 (UI 上 silent) */}
      {/* HARD_DEFAULT_PREFERENCES.chromeEnabled === false の確認用、render 副作用なし */}
      <span hidden aria-hidden>
        default={String(HARD_DEFAULT_PREFERENCES.chromeEnabled)}
      </span>
    </div>
  );
}

/**
 * 単純な semver 比較（"x.y.z" のみ、pre-release / build metadata は無視）。
 *
 * 戻り値: a < b → -1、a == b → 0、a > b → 1
 * 不正入力は「未満として扱う」(=-1) のではなく、各セグメントの parse 失敗時は 0
 * に倒してエラー表示が暴発しないようにする (saner default)。
 */
function compareSemver(a: string, b: string): number {
  const pa = parseTriple(a);
  const pb = parseTriple(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function parseTriple(s: string): [number, number, number] | null {
  const parts = s.split(".");
  if (parts.length < 3) return null;
  const nums = parts.slice(0, 3).map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2]];
}
