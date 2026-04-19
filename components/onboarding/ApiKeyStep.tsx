"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { callTauri } from "@/lib/tauri-api";

/**
 * Step 2: 認証方法の選択（PM-122）。
 *
 * 3 系統の動線を 1 画面に統合:
 *  1. Anthropic サインイン（Claude Max プラン）: `@tauri-apps/plugin-shell` の
 *     `open()` で OAuth URL をブラウザに開く。実 OAuth 対応は PM-283 相当で後日。
 *  2. API Key を直接入力: `invoke('set_api_key', { key })` で keyring に保存、
 *     `get_api_key` で取得可否確認、Anthropic `/v1/messages` に最小呼出で検証。
 *  3. スキップ: Claude Max の credential（`~/.claude/.credentials.json`）が
 *     存在すれば Agent SDK が自動検出するため、そのまま次へ。
 *
 * 既存 `app/setup/page.tsx` の 3 択ロジックを本コンポーネントに統合する
 * （WelcomeWizard の 1 ステップとして組み込む想定）。
 */
export interface ApiKeyStepProps {
  /** 検証 or スキップで次ステップへ遷移する callback */
  onContinue: () => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

const ANTHROPIC_CONSOLE_URL = "https://console.anthropic.com/";

export function ApiKeyStep({ onContinue }: ApiKeyStepProps) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");

  async function handleOpenAnthropic() {
    try {
      // NOTE: dynamic import で SSR 時の plugin-shell 読込を回避
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(ANTHROPIC_CONSOLE_URL);
      toast.info(
        "ブラウザで Anthropic Console を開きました。サインイン後、このウィンドウに戻ってください。"
      );
    } catch (e) {
      toast.error(`ブラウザを開けませんでした: ${String(e)}`);
    }
  }

  async function handleTestAndSave() {
    const key = apiKey.trim();
    if (!key.startsWith("sk-ant-")) {
      toast.error("API Key は sk-ant- で始まる必要があります。");
      return;
    }
    setBusy(true);
    setTestState("testing");
    try {
      // 1. keyring に保存
      await callTauri<void>("set_api_key", { key });

      // 2. 保存できたかを get_api_key で確認
      const stored = await callTauri<string | null>("get_api_key");
      if (!stored) {
        throw new Error("keyring に保存できましたが、読み出しに失敗しました。");
      }

      // 3. Anthropic API に最小リクエストで疎通確認
      //    （/v1/messages の 1 token 呼出、fetch で直叩き）
      const ok = await verifyApiKey(key);
      if (!ok) {
        setTestState("fail");
        toast.error(
          "Anthropic API への接続に失敗しました。キーが正しいか確認してください。"
        );
        setBusy(false);
        return;
      }

      setTestState("ok");
      toast.success("API Key を保存し、接続を確認しました。");
      onContinue();
    } catch (e) {
      setTestState("fail");
      toast.error(`失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    // Claude Max credential（~/.claude/.credentials.json）が存在すれば
    // Agent SDK が自動検出する前提で、そのまま次ステップへ。
    toast.info("Claude Max の認証情報を自動検出します。");
    onContinue();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Claude に接続する</h2>
        <p className="text-sm text-muted-foreground">
          Claude Max プランでサインインするか、API キーを入力してください。
        </p>
      </div>

      <Card className="space-y-5 p-6">
        {/* Option 1: Anthropic OAuth */}
        <div className="space-y-2">
          <Button
            size="lg"
            className="w-full"
            onClick={handleOpenAnthropic}
            disabled={busy}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Anthropic でサインイン（Claude Max プラン）
          </Button>
          <p className="text-xs text-muted-foreground">
            ブラウザで Anthropic Console を開きます。サインイン後、このアプリに
            戻って「スキップ」を押してください。
          </p>
        </div>

        <Divider label="または API キーを直接入力" />

        {/* Option 2: API Key direct */}
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <KeyRound className="h-3 w-3" aria-hidden />
              Anthropic API Key
            </label>
            <Input
              type="password"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <Button
            onClick={handleTestAndSave}
            disabled={busy || !apiKey.trim()}
            variant="outline"
            className="w-full"
          >
            {testState === "testing" && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {testState === "ok" && (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
            {testState === "testing"
              ? "接続を確認中..."
              : testState === "ok"
                ? "接続できました"
                : "接続テストして保存"}
          </Button>
        </div>

        <Divider label="すでに設定済みの場合" />

        {/* Option 3: Skip */}
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={handleSkip}
          disabled={busy}
        >
          スキップ（Claude Max の認証を自動検出）
        </Button>
      </Card>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="relative py-1 text-center text-xs text-muted-foreground">
      <div className="absolute inset-x-0 top-1/2 -z-0 h-px bg-border" />
      <span className="relative z-10 bg-card px-2">{label}</span>
    </div>
  );
}

/**
 * Anthropic `/v1/messages` に最小 1 token のリクエストを投げてキーを検証する。
 *
 * 成功: 200 OK → true
 * 失敗: 401 / 403 / ネットワーク失敗 → false
 *
 * NOTE: デスクトップアプリ内部からの fetch なので CORS は関係ない。
 *       本来は Rust 側で reqwest を使うほうが安全だが、MVP では fetch 直叩き。
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
    // 200 を ok とする。429 等のレート制限もキー自体は有効なので ok 扱い。
    if (res.ok) return true;
    if (res.status === 429) return true;
    return false;
  } catch {
    return false;
  }
}
