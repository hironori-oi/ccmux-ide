"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callTauri } from "@/lib/tauri-api";
import { cn } from "@/lib/utils";

/**
 * PM-974: Claude Code 認証未設定ユーザー向けの永続アナウンスダイアログ。
 *
 * 旧実装（app/page.tsx）は 10 秒 toast のみで見落とされやすかった。本 component は
 * workspace 起動直後に認証状態を check し、未認証なら **modal ダイアログ** で
 * 明確に案内する:
 *
 * 1. `claude login`（Claude Max / Pro プラン、推奨）— ワンクリックコピー付き
 * 2. Anthropic API Key を設定画面で直接入力（従量課金派）
 *
 * ユーザー操作:
 * - 「設定を開く」→ `/settings` へ
 * - 「再確認」→ Rust check を再実行、成功なら自動 close
 * - 「閉じる」→ このセッション限定で隠す（再起動時に再表示）
 *
 * 自己完結のため workspace page から自動マウント（children overlay）。
 */
type AuthStatus = "Authenticated" | "NotFound" | "TokenMissing";

export function AuthPromptDialog() {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus | "checking" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // 起動時の初回チェック
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await callTauri<AuthStatus>("check_claude_authenticated");
        if (!cancelled) setStatus(s);
      } catch {
        // command 失敗時は dialog 出さない（古い binary 等）
        if (!cancelled) setStatus("Authenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRecheck() {
    setStatus("checking");
    try {
      const s = await callTauri<AuthStatus>("check_claude_authenticated");
      setStatus(s);
      if (s === "Authenticated") {
        toast.success("Claude Code の認証を確認しました");
      }
    } catch (e) {
      toast.error(
        `再確認に失敗: ${e instanceof Error ? e.message : String(e)}`
      );
      setStatus(null);
    }
  }

  async function handleCopyCmd() {
    try {
      await writeText("claude login");
      setCopiedCmd(true);
      toast.success("`claude login` をコピーしました");
      window.setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      toast.error("クリップボードへのコピーに失敗しました");
    }
  }

  // Authenticated / checking 初期 / dismissed はダイアログ非表示
  const isOpen =
    !dismissed &&
    status !== null &&
    status !== "Authenticated" &&
    status !== "checking";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden />
            Claude Code の認証が必要です
          </DialogTitle>
          <DialogDescription className="text-sm">
            Sumi は Claude Code の認証情報を利用します。以下のいずれかの方法で
            認証を完了してください。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-4">
          {/* Option A: claude login */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Terminal className="h-4 w-4 text-emerald-500" aria-hidden />
              方法 A: Claude Max / Pro プラン（推奨）
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              ターミナルで以下のコマンドを実行し、ブラウザで OAuth ログインを
              完了してください。完了後に下の「再確認」ボタンを押すと Sumi が
              認証状態を再読込します。
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background px-2 py-1.5 font-mono text-xs">
                claude login
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopyCmd()}
                className="h-7 gap-1 px-2 text-xs"
              >
                {copiedCmd ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden /> コピー済
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden /> コピー
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Option B: API Key */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4 text-blue-500" aria-hidden />
              方法 B: Anthropic API Key（従量課金）
            </div>
            <p className="text-xs text-muted-foreground">
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-primary"
              >
                Anthropic Console
              </a>
              で発行した API Key を設定画面に貼り付けると、OS keyring
              （Windows Credential Manager / macOS Keychain / Linux Secret Service）
              に安全に保存されます。
            </p>
          </div>

          {/* status 詳細 */}
          <div className={cn(
            "rounded-md border px-3 py-2 text-xs",
            status === "NotFound"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}>
            {status === "NotFound" && (
              <>
                <strong>検出結果:</strong>{" "}
                <code className="text-[11px]">~/.claude/.credentials.json</code>{" "}
                が見つかりません。
              </>
            )}
            {status === "TokenMissing" && (
              <>
                <strong>検出結果:</strong> 認証情報ファイルは存在しますが OAuth
                token が取得できませんでした（期限切れの可能性）。
              </>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDismissed(true)}
            className="h-8 text-xs"
          >
            閉じる（後で設定）
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDismissed(true);
              router.push("/settings");
            }}
            className="h-8 gap-1 text-xs"
          >
            <KeyRound className="h-3 w-3" aria-hidden />
            API Key を入力
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleRecheck()}
            disabled={status === "checking"}
            className="h-8 gap-1 text-xs"
          >
            <RefreshCw
              className={cn(
                "h-3 w-3",
                status === "checking" && "animate-spin"
              )}
              aria-hidden
            />
            {status === "checking" ? "確認中..." : "再確認"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
