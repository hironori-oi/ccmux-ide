"use client";

import { useEffect, useMemo } from "react";
import { AlertTriangle, Check, Globe, ShieldAlert, Terminal, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logger } from "@/lib/logger";
import {
  usePermissionRequestsStore,
  type PermissionRequest,
  type PermissionRememberScope,
} from "@/lib/stores/permission-requests";
import { useSessionPreferencesStore } from "@/lib/stores/session-preferences";
import { useChatStore } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { isAbsolutePath, isPathWithinCwd } from "@/lib/utils/path";

/**
 * PRJ-012 v1.13.0 (DEC-059 案B): ツール実行承認モーダル。
 *
 * - pending.length > 0 のとき、キュー先頭の 1 件を表示する (逐次処理)
 * - 4 ボタン: 今回のみ許可 / 今回のみ拒否 / セッション常時許可 / セッション常時拒否
 * - 常時許可/拒否 選択時は session-preferences.rememberToolPermission も呼ぶ
 * - ツール入力は tool 種別ごとに最適な summary 整形を行う (Bash / Write / Edit /
 *   WebSearch / WebFetch / others)
 * - アクセシビリティ: radix-ui Dialog のフォーカストラップを活用。
 *   Enter = 今回のみ許可、Esc = 今回のみ拒否 の hotkey も binding
 *
 * 設計判断:
 *  - モーダル中央表示で他 UI 操作をブロック (見落とし防止)
 *  - session / project の紐付けは `projectId` と `useChatStore.activePaneId`
 *    → `panes[activePaneId].currentSessionId` で推定。pane が close されている等の
 *    エッジケースでは session-preferences への記録のみ skip し、sidecar への応答
 *    は必ず完了させる (承認/拒否自体は project 単位で機能する)
 */
export function PermissionDialog(): React.ReactElement | null {
  const pending = usePermissionRequestsStore((s) => s.pending);
  const resolve = usePermissionRequestsStore((s) => s.resolve);

  const current: PermissionRequest | null = pending[0] ?? null;
  const open = current !== null;

  // Enter / Esc hotkey (radix の onKeyDown に頼ると Portal 都合で拾えないため window)
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleClick(current, "allow", "once");
      } else if (e.key === "Escape") {
        e.preventDefault();
        void handleClick(current, "deny", "once");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function handleClick(
    req: PermissionRequest,
    behavior: "allow" | "deny",
    remember: PermissionRememberScope,
  ): Promise<void> {
    // session 記録は先に行う (callTauri 失敗時でも UI sticky を優先するため)
    if (remember === "session") {
      const sessionId = resolveSessionIdForDecision(req.projectId);
      try {
        useSessionPreferencesStore
          .getState()
          .rememberToolPermission(
            sessionId,
            req.projectId,
            req.toolName,
            behavior === "allow",
          );
      } catch (e) {
        // 記録失敗は致命でない (次回は再度 dialog が出るだけ)。log のみ。
        logger.warn("[permission] rememberToolPermission failed", e);
      }
    }

    try {
      await resolve(req.id, {
        behavior,
        remember,
      });
    } catch (e) {
      toast.error(
        `ツール承認の送信に失敗しました。再試行してください: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      logger.error("[permission] resolve failed", e);
    }
  }

  const summary = useMemo(
    () => (current ? formatToolInputSummary(current.toolName, current.toolInput) : null),
    [current],
  );

  // DEC-060 (v1.14.0): Write/Edit/NotebookEdit の絶対パスが project cwd の外側を
  // 指している場合に赤色バナーで警告する。cwd は current.projectId から
  // useProjectStore.projects[].path で引く。取得不能なら警告抑制 (false positive 回避)。
  const cwdWarning = useMemo(() => {
    if (!current) return null;
    const absPath = extractAbsolutePathFromToolInput(current.toolName, current.toolInput);
    if (!absPath) return null;
    const cwd = resolveCwdForProject(current.projectId);
    if (!cwd) return null;
    if (isPathWithinCwd(absPath, cwd)) return null;
    return { path: absPath, cwd };
  }, [current]);

  if (!current) return null;

  return (
    <Dialog open={open}>
      <DialogContent
        // 閉じる X ボタンや overlay クリック / Esc での close は hotkey で
        // deny-once として処理させる。Dialog 既定の close パスは意図しない
        // 「応答なし」を招くので全て抑止する。
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          void handleClick(current, "deny", "once");
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby="permission-dialog-description"
        className={
          cwdWarning
            ? "border-red-400/60 sm:max-w-xl dark:border-red-500/50"
            : "sm:max-w-xl"
        }
      >
        {cwdWarning && (
          <div
            role="alert"
            className="rounded-md border border-red-400/60 bg-red-50/70 p-3 text-[12.5px] text-red-900 dark:border-red-500/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              作業ディレクトリ外への書込みです
            </div>
            <div className="space-y-0.5 font-mono text-[11.5px]">
              <div>
                <span className="text-red-700/80 dark:text-red-300/80">path:</span>{" "}
                {cwdWarning.path}
              </div>
              <div>
                <span className="text-red-700/80 dark:text-red-300/80">cwd :</span>{" "}
                {cwdWarning.cwd}
              </div>
            </div>
          </div>
        )}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert
              className="h-5 w-5 text-amber-500"
              aria-hidden
            />
            ツール実行の承認
          </DialogTitle>
          <DialogDescription id="permission-dialog-description">
            Claude が以下のツールを実行しようとしています。内容を確認して判断してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="flex items-center gap-1.5 border-amber-300/60 bg-amber-50/40 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <ToolIcon toolName={current.toolName} />
              <span className="font-mono text-[12px]">{current.toolName}</span>
            </Badge>
            {current.sessionId && (
              <Badge
                variant="secondary"
                className="font-mono text-[11px]"
                aria-label="プロジェクト ID"
              >
                {current.sessionId.slice(0, 8)}
              </Badge>
            )}
          </div>

          {summary && (
            <div className="rounded-md border bg-muted/40 p-3 text-[12.5px]">
              {summary}
            </div>
          )}
        </div>

        {/* v1.22.7: 4 ボタンを 2x2 grid で配置し dialog 枠からはみ出ないよう調整。
            左右で 拒否/許可、上下で 常時/今回 のグルーピング。 */}
        <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <Button
            variant="outline"
            onClick={() => void handleClick(current, "deny", "session")}
            aria-label="このセッションで常に拒否"
          >
            <X className="mr-1.5 h-4 w-4" aria-hidden />
            セッション常時拒否
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleClick(current, "allow", "session")}
            aria-label="このセッションで常に許可"
          >
            <Check className="mr-1.5 h-4 w-4" aria-hidden />
            セッション常時許可
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleClick(current, "deny", "once")}
            aria-label="今回のみ拒否"
          >
            今回のみ拒否
          </Button>
          <Button
            onClick={() => void handleClick(current, "allow", "once")}
            aria-label="今回のみ許可"
            autoFocus
          >
            今回のみ許可
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * tool 種別に応じてアイコンを切り替える (UI の視認性向上用)。
 * unknown tool は ShieldAlert (デフォルトの警告アイコン) で fallback。
 */
function ToolIcon({ toolName }: { toolName: string }): React.ReactElement {
  const name = toolName.toLowerCase();
  if (name === "bash") return <Terminal className="h-3.5 w-3.5" aria-hidden />;
  if (name === "websearch" || name === "webfetch")
    return <Globe className="h-3.5 w-3.5" aria-hidden />;
  return <ShieldAlert className="h-3.5 w-3.5" aria-hidden />;
}

/**
 * tool 別の input summary を React 要素で返す。
 *
 *  - Bash: `$ <command>` 先頭 200 文字
 *  - Write / Edit: ファイルパス (file_path / filePath / path)
 *  - WebSearch: query
 *  - WebFetch: url
 *  - その他: JSON.stringify(input, null, 2) を <pre> で 先頭 500 文字 + 省略表示
 */
function formatToolInputSummary(
  toolName: string,
  input: Record<string, unknown>,
): React.ReactElement | null {
  const name = toolName.toLowerCase();
  const get = (k: string): string | null => {
    const v = input[k];
    return typeof v === "string" ? v : null;
  };

  if (name === "bash") {
    const cmd = get("command") ?? "";
    return (
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">コマンド</div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px]">
          {"$ " + truncate(cmd, 200)}
        </pre>
      </div>
    );
  }

  if (name === "write" || name === "edit") {
    const p = get("file_path") ?? get("filePath") ?? get("path") ?? "";
    return (
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">ファイル</div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px]">
          {truncate(p, 300)}
        </pre>
      </div>
    );
  }

  if (name === "websearch") {
    const q = get("query") ?? "";
    return (
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">検索クエリ</div>
        <p className="whitespace-pre-wrap text-[13px]">{truncate(q, 500)}</p>
      </div>
    );
  }

  if (name === "webfetch") {
    const url = get("url") ?? "";
    return (
      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">URL</div>
        <p className="break-all font-mono text-[12px]">{truncate(url, 500)}</p>
      </div>
    );
  }

  // 汎用 fallback: 整形 JSON を 500 文字で切る
  let raw = "";
  try {
    raw = JSON.stringify(input, null, 2);
  } catch {
    raw = String(input);
  }
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">入力内容</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11.5px]">
        {truncate(raw, 500)}
      </pre>
    </div>
  );
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + "…";
}

/**
 * session-preferences に記録する際の sessionId を推定する。
 *
 * 現状の sidecar は project 単位で 1 sidecar。permission_request 自体は project
 * 単位で識別できるが、Frontend の preferences は session 単位で管理されているため、
 * 「現在アクティブな pane の currentSessionId」を projectId と突き合わせて導出する。
 *
 * 該当 pane が別 project / currentSessionId 未確定の場合は空文字列を返し、
 * session-preferences は no-op になる (sticky 記録は次回改めて行う余地を残す)。
 */
function resolveSessionIdForDecision(projectId: string): string {
  try {
    const activeProjectId = useProjectStore.getState().activeProjectId;
    if (activeProjectId !== projectId) return "";
    const chat = useChatStore.getState();
    const paneId = chat.activePaneId;
    return chat.panes[paneId]?.currentSessionId ?? "";
  } catch {
    return "";
  }
}

/**
 * DEC-060 (v1.14.0): tool input から対象ファイルの絶対パスを抽出する。
 *
 * 対象 tool:
 * - `Write` / `Edit` : `file_path` / `filePath` / `path`
 * - `NotebookEdit`   : `notebook_path` / `notebookPath`
 *
 * 相対パス (`./foo` / `../bar`) は null 扱い (SDK が cwd 基準で解決するため警告不要)。
 * 対象外 tool (Bash / Read / Grep / MCP 等) も null。v1.15 以降で拡張予定。
 */
function extractAbsolutePathFromToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const name = toolName.toLowerCase();
  const get = (k: string): string | null => {
    const v = input[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  let candidate: string | null = null;
  if (name === "write" || name === "edit") {
    candidate = get("file_path") ?? get("filePath") ?? get("path");
  } else if (name === "notebookedit") {
    candidate = get("notebook_path") ?? get("notebookPath");
  }
  if (!candidate) return null;
  // 相対パスは警告対象外
  if (!isAbsolutePath(candidate)) return null;
  return candidate;
}

/**
 * DEC-060 (v1.14.0): projectId から RegisteredProject.path (= session の cwd) を解決。
 *
 * - useProjectStore.projects から一致する id を探す
 * - 見つからない / 空文字列 → null を返し、呼出側は警告抑制 (false positive 回避)
 */
function resolveCwdForProject(projectId: string): string | null {
  try {
    const projects = useProjectStore.getState().projects;
    const hit = projects.find((p) => p.id === projectId);
    if (!hit || typeof hit.path !== "string" || hit.path.length === 0) return null;
    return hit.path;
  } catch {
    return null;
  }
}
