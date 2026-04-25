"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw, Server, Square, SquarePlus } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { logger } from "@/lib/logger";
import { useProjectStore } from "@/lib/stores/project";
import { useSessionStore } from "@/lib/stores/session";
import { usePreviewInstances } from "@/lib/stores/preview-instances";
import type { LocalServer } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * PRJ-012 v1.23.0 / DEC-069: localhost サーバー管理パネル (Phase 1 MVP)。
 *
 * ## 概要
 * 開発者が起動した dev server (next dev :3000 / vite :5173 / python :8000 等) を
 * sidebar の「サーバー」tab で一覧表示し、外部ブラウザで開く / Preview に配置 /
 * 停止 の 3 アクションを完結させる。Cursor では「どこかで何かが port を握っている」
 * 状態を逐一 ps / taskkill で探す必要があったが、本 panel で 1 クリック解決する。
 *
 * ## データソース
 * Rust command `list_local_servers()` (sysinfo + netstat2) を **5 秒間隔で polling**。
 * tab 非アクティブ時 (document.visibilityState !== "visible") は polling 停止して
 * 無駄な OS API 呼び出しを抑制。component unmount 時に cleanup で interval clear。
 *
 * ## 操作
 * - 外部で開く : `@tauri-apps/plugin-shell` の open() で OS デフォルトブラウザに `http://{host}:{port}`
 * - Preview   : `usePreviewInstances.addInstance` で workspace の Preview slot に投入
 * - 停止     : AlertDialog で確認 → `kill_local_server(pid, force=false)`
 *
 * ## kill 候補からの除外
 * Sumi 自身の pid は `is_self=true` で返ってくるので、停止ボタンは disable。
 * （Rust 側でも self-pid 拒否を二重ガード）
 */
export function LocalServersPanel() {
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<LocalServer | null>(null);
  const [killing, setKilling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 取得処理本体。手動 refresh / polling / 初回 mount で共有する。
  const fetchServers = useCallback(async () => {
    try {
      const list = await invoke<LocalServer[]>("list_local_servers");
      setServers(list);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[local-servers] list failed:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // 5 秒 polling + visibility 制御。
  useEffect(() => {
    let cancelled = false;

    function startPolling() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        if (cancelled) return;
        void fetchServers();
      }, 5000);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // 初回 fetch & polling start (visible なときだけ)。
    void fetchServers();
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    ) {
      startPolling();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        // 戻ってきたら即 fetch + polling 再開。
        void fetchServers();
        startPolling();
      } else {
        stopPolling();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      stopPolling();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [fetchServers]);

  // 外部ブラウザで開く。
  const openExternal = useCallback(async (server: LocalServer) => {
    try {
      // dynamic import で SSR / build-time の plugin-shell 読込を回避。
      const { open } = await import("@tauri-apps/plugin-shell");
      const url = buildUrl(server);
      await open(url);
      toast.info(`外部ブラウザで開きました (${url})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`ブラウザを開けませんでした: ${msg}`);
      logger.error("[local-servers] open external failed:", msg);
    }
  }, []);

  // Preview slot に追加。activeProjectId 必須。
  const addToPreview = useCallback((server: LocalServer) => {
    const { activeProjectId } = useProjectStore.getState();
    if (!activeProjectId) {
      toast.error("Preview に追加するにはプロジェクトを選択してください");
      return;
    }
    const sessionId = useSessionStore.getState().currentSessionId;
    const url = buildUrl(server);
    usePreviewInstances
      .getState()
      .addInstance(activeProjectId, { initialUrl: url, sessionId });
    toast.success(`Preview に追加しました (port ${server.port})`);
  }, []);

  // 停止確認 dialog open。
  const requestKill = useCallback((server: LocalServer) => {
    setKillTarget(server);
  }, []);

  // 停止実行。
  const confirmKill = useCallback(async () => {
    if (!killTarget) return;
    setKilling(true);
    try {
      await invoke("kill_local_server", {
        pid: killTarget.pid,
        force: false,
      });
      toast.success(`サーバー（port ${killTarget.port}）を停止しました`);
      setKillTarget(null);
      // 即時 refresh (polling 待ちを回避)。
      await fetchServers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`停止に失敗しました: ${msg}`);
      logger.error("[local-servers] kill failed:", msg);
    } finally {
      setKilling(false);
    }
  }, [killTarget, fetchServers]);

  // 表示用に kill 不可なもの (Sumi 自身) を末尾、それ以外は port 昇順 (Rust 側で sort 済)。
  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? 1 : -1;
      if (a.port !== b.port) return a.port - b.port;
      return a.pid - b.pid;
    });
  }, [servers]);

  return (
    <TooltipProvider delayDuration={300}>
      <section
        className="flex min-h-0 flex-1 flex-col"
        aria-label="localhost サーバー一覧"
      >
        {/* ヘッダ: 件数 + 手動 refresh */}
        <header className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <Server className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium">サーバー</span>
            <span className="tabular-nums text-muted-foreground">
              {servers.length}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => void fetchServers()}
                disabled={loading}
                aria-label="再取得"
              >
                <RefreshCw
                  className={cn(
                    "h-3 w-3",
                    loading && "animate-spin text-muted-foreground"
                  )}
                  aria-hidden
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              再取得 (5 秒ごと自動更新中)
            </TooltipContent>
          </Tooltip>
        </header>

        {/* 本体 */}
        {error ? (
          <div className="flex flex-1 items-center justify-center px-3 text-center text-xs text-destructive">
            取得に失敗しました: {error}
          </div>
        ) : loading && servers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
            読み込み中…
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-3 text-center text-xs text-muted-foreground">
            稼働中の localhost サーバーはありません
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <ul className="flex flex-col divide-y">
              {sortedServers.map((server) => (
                <li key={`${server.pid}-${server.port}`}>
                  <ServerRow
                    server={server}
                    onOpenExternal={() => void openExternal(server)}
                    onAddPreview={() => addToPreview(server)}
                    onKill={() => requestKill(server)}
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        {/* 停止確認 AlertDialog */}
        <AlertDialog
          open={killTarget !== null}
          onOpenChange={(next) => {
            if (!next && !killing) setKillTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>このサーバーを停止しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                {killTarget && (
                  <>
                    プロセス {killTarget.pid} ({killTarget.processName}) を停止します。
                    <br />
                    <span className="text-destructive">
                      実行中の処理は失われます。
                    </span>
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={killing}>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void confirmKill();
                }}
                disabled={killing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {killing && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                )}
                停止
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// 内部コンポーネント
// ---------------------------------------------------------------------------

/** 1 行分のサーバー row。 */
function ServerRow({
  server,
  onOpenExternal,
  onAddPreview,
  onKill,
}: {
  server: LocalServer;
  onOpenExternal: () => void;
  onAddPreview: () => void;
  onKill: () => void;
}) {
  const elapsed = useMemo(() => formatElapsed(server.startedAt), [
    server.startedAt,
  ]);

  return (
    <div className="px-2 py-2">
      <div className="flex items-start gap-1.5">
        {/* ステータスドット */}
        <span
          className={cn(
            "mt-1 h-2 w-2 shrink-0 rounded-full",
            server.isSelf
              ? "bg-muted-foreground/50"
              : "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]"
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {/* 1 行目: port + process name + pid */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-mono font-semibold tabular-nums">
              {server.port}
            </span>
            <span className="truncate font-medium" title={server.processName}>
              {server.processName}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              PID:{server.pid}
            </span>
          </div>

          {/* 2 行目: command line */}
          {server.commandLine && (
            <div
              className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
              title={server.commandLine}
            >
              {server.commandLine}
            </div>
          )}

          {/* 3 行目: host + 起動経過 + cpu + memory */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="font-mono">{server.host}</span>
            {elapsed && <span>{elapsed}</span>}
            <span>CPU {server.cpuPercent.toFixed(1)}%</span>
            <span>{server.memoryMb}MB</span>
            {server.isSelf && (
              <span className="rounded bg-muted px-1 py-px text-[9px]">
                Sumi 自身
              </span>
            )}
          </div>

          {/* 4 行目: アクション */}
          <div className="mt-1.5 flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={onOpenExternal}
                >
                  <ExternalLink className="mr-0.5 h-3 w-3" aria-hidden />
                  外部で開く
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {`http://${displayHost(server.host)}:${server.port} を OS のブラウザで開く`}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={onAddPreview}
                >
                  <SquarePlus className="mr-0.5 h-3 w-3" aria-hidden />
                  Preview
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                ワークスペースの Preview スロットに追加
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  onClick={onKill}
                  disabled={server.isSelf}
                >
                  <Square className="mr-0.5 h-3 w-3" aria-hidden />
                  停止
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {server.isSelf
                  ? "Sumi 自身は停止できません"
                  : `pid ${server.pid} を停止 (SIGTERM → 3 秒 → SIGKILL)`}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** server から外部 open / preview に渡す URL を組み立てる。 */
function buildUrl(server: LocalServer): string {
  return `http://${displayHost(server.host)}:${server.port}`;
}

/**
 * 0.0.0.0 / :: は外部ブラウザで開けないので localhost に置き換える。
 * IPv6 リテラルは [...] で括る。
 */
function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "::1") {
    return "localhost";
  }
  // IPv6 アドレス (`::` を含むが `::1` / `::` 単独でないもの)
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

/**
 * UNIX epoch ms → "N 分前起動" のような相対時刻文字列。
 * null / 0 の場合は null を返してスキップ表示。
 */
function formatElapsed(startedAt: number | null): string | null {
  if (startedAt == null || startedAt <= 0) return null;
  const diffMs = Date.now() - startedAt;
  if (diffMs < 0) return null;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前起動`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分前起動`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 時間前起動`;
  const day = Math.floor(hr / 24);
  return `${day} 日前起動`;
}
