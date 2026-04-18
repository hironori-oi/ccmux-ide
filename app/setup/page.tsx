"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { callTauri } from "@/lib/tauri-api";

/**
 * Welcome Wizard Step 2 — 認証方法の選択画面。
 *
 * DEC-023 を踏まえた Quick Win 実装:
 * 1. **Claude Pro / Max プランでサインイン** (primary)
 *    - すでに `claude login` 済みなら何もする必要なし。
 *    - `~/.claude/.credentials.json` の OAuth token を Agent SDK が自動検出する。
 * 2. **API Key を貼り付け** (secondary, 従量課金)
 *    - keyring に保存し、sidecar の ANTHROPIC_API_KEY として注入（PM-113 で実装）。
 * 3. **スキップ** — 既存セットアップが済んでいる前提で workspace へ。
 */
export default function Setup() {
  const router = useRouter();
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignInMax() {
    toast.info(
      "Max / Pro プランでサインイン済みなら「スキップ」を押してください。未サインインなら別ターミナルで `claude login` を実行してから戻ってきてください。"
    );
  }

  async function handlePasteApiKey() {
    const key = apiKey.trim();
    if (!key.startsWith("sk-ant-")) {
      toast.error("API Key は sk-ant- で始まる必要があります");
      return;
    }
    setBusy(true);
    try {
      await callTauri<void>("set_api_key", { key });
      toast.success("API Key を keyring に保存しました");
      router.push("/setup/done");
    } catch (e) {
      toast.error(`保存に失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    router.push("/setup/done");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-8">
      <Card className="w-full max-w-2xl space-y-6 p-12 shadow-lg">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">認証方法を選ぶ</h1>
          <p className="text-sm text-muted-foreground">
            Claude Code CLI と同じ認証情報を使います。既に
            <code className="px-1 text-foreground">claude login</code>
            済みなら「スキップ」を選んでください。
          </p>
        </div>

        <div className="space-y-4">
          {/* Primary: Max / Pro OAuth */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleSignInMax}
            disabled={busy}
          >
            Claude Pro / Max プランでサインイン
          </Button>

          <div className="relative py-2 text-center text-xs text-muted-foreground">
            <div className="absolute inset-x-0 top-1/2 -z-0 h-px bg-border" />
            <span className="relative z-10 bg-card px-2">または</span>
          </div>

          {/* Secondary: API Key */}
          {!showApiKey ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => setShowApiKey(true)}
              disabled={busy}
            >
              API Key を貼り付け（従量課金）
            </Button>
          ) : (
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handlePasteApiKey}
                  disabled={busy || !apiKey.trim()}
                  className="flex-1"
                >
                  {busy ? "保存中..." : "保存して続ける"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowApiKey(false)}
                  disabled={busy}
                >
                  取り消し
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Anthropic Console から取得:
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline underline-offset-2"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>
          )}

          {/* Skip */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={handleSkip}
            disabled={busy}
          >
            既にサインイン済み（スキップ）
          </Button>
        </div>

        <div className="flex justify-start pt-2">
          <Link href="/">
            <Button variant="ghost" size="sm" disabled={busy}>
              戻る
            </Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
