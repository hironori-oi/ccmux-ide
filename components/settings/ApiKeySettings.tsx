"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Edit3,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { callTauri } from "@/lib/tauri-api";

/**
 * Week 6 Chunk 3 / PM-212: API Key 設定。
 *
 * 仕様:
 * - 現在のキー: 末尾 4 桁のみ表示（`****-abcd`）、`get_api_key` で読み込む
 * - 編集: Input に切替え、`set_api_key` で保存後に再表示
 * - 削除: shadcn `AlertDialog` で確認 → 空文字 `set_api_key` で削除
 *   （Rust 側は空文字受領時に entry を削除する実装）
 * - 接続テスト: `/v1/messages` に 1 token 疎通（ApiKeyStep と同じロジック）
 */

type TestState = "idle" | "testing" | "ok" | "fail";

export function ApiKeySettings() {
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await callTauri<string | null>("get_api_key");
        if (!cancelled) setCurrent(v);
      } catch (e) {
        if (!cancelled) {
          toast.error(`API Key の読み込みに失敗: ${String(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const masked = current ? maskApiKey(current) : null;

  const handleSave = async () => {
    const key = draft.trim();
    if (!key.startsWith("sk-ant-")) {
      toast.error("API Key は sk-ant- で始まる必要があります。");
      return;
    }
    setBusy(true);
    try {
      await callTauri<void>("set_api_key", { key });
      setCurrent(key);
      setEditing(false);
      setDraft("");
      toast.success("API Key を保存しました。");
    } catch (e) {
      toast.error(`保存に失敗: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      // Rust config.rs は空文字で entry を削除する契約
      await callTauri<void>("set_api_key", { key: "" });
      setCurrent(null);
      setConfirmDelete(false);
      toast.success("API Key を削除しました。");
    } catch (e) {
      toast.error(`削除に失敗: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (!current) {
      toast.info("テストする API Key がありません。");
      return;
    }
    setTestState("testing");
    try {
      const ok = await verifyApiKey(current);
      setTestState(ok ? "ok" : "fail");
      if (ok) toast.success("接続に成功しました。");
      else toast.error("接続に失敗しました。キーを確認してください。");
    } catch {
      setTestState("fail");
      toast.error("接続テストに失敗しました。");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">Anthropic API Key</h3>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            読み込み中...
          </div>
        ) : editing ? (
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="sk-ant-..."
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSave}
                disabled={busy || !draft.trim()}
                size="sm"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                保存
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
                disabled={busy}
              >
                キャンセル
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              キーは OS の資格情報ストア（Windows: Credential Manager / macOS:
              Keychain / Linux: Secret Service）に安全に保存されます。
            </p>
          </div>
        ) : masked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                {masked}
              </code>
              <span className="text-[11px] text-muted-foreground">
                （末尾 4 桁のみ表示）
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Edit3 className="h-3 w-3" aria-hidden />
                編集
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testState === "testing"}
              >
                {testState === "testing" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : testState === "ok" ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden />
                ) : (
                  <RefreshCw className="h-3 w-3" aria-hidden />
                )}
                接続テスト
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                削除
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              API Key が設定されていません。編集から登録してください。
            </p>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Edit3 className="h-3 w-3" aria-hidden />
              API Key を設定
            </Button>
          </div>
        )}
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              OS の資格情報ストアからキーを削除します。再度 Claude と会話するには
              API Key の再登録が必要です。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** API Key を末尾 4 桁のみ表示する形式にマスク */
function maskApiKey(key: string): string {
  if (key.length <= 4) return `****-${key}`;
  return `****-${key.slice(-4)}`;
}

/**
 * Anthropic `/v1/messages` に 1 token 疎通 → 接続検証。
 * ApiKeyStep の同名関数と整合。
 */
async function verifyApiKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (res.ok) return true;
    if (res.status === 429) return true;
    return false;
  } catch {
    return false;
  }
}
