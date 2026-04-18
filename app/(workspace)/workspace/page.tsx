"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { callTauri, onTauriEvent } from "@/lib/tauri-api";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/**
 * Workspace — sidecar (Agent SDK) と接続してチャットするメイン画面。
 *
 * - マウント時に `start_agent_sidecar` を invoke し、Node sidecar を起動する。
 * - `agent:raw` event（NDJSON 1 行）を受信し、`message` / `result` から text を
 *   抽出して messages に追加する。
 * - アンマウント時に `stop_agent_sidecar` を呼んで子プロセスを終了する。
 */
export default function WorkspacePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("起動中...");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let unlistenRaw: (() => void) | null = null;
    let unlistenStderr: (() => void) | null = null;
    let unlistenTerm: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // agent:raw (stdout) - NDJSON 1 レコードを期待
      unlistenRaw = await onTauriEvent<string>("agent:raw", (payload) => {
        const lines = payload.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as {
              type: string;
              id: string;
              payload: unknown;
            };
            handleSidecarEvent(msg);
          } catch {
            // NDJSON parse 失敗は無視（stdout が行境界をまたいだ場合など）
          }
        }
      });

      // agent:stderr - sidecar の log / error
      unlistenStderr = await onTauriEvent<string>("agent:stderr", (payload) => {
        // eslint-disable-next-line no-console
        console.warn("[sidecar stderr]", payload);
      });

      // agent:terminated - 子プロセス終了
      unlistenTerm = await onTauriEvent<number | null>(
        "agent:terminated",
        (code) => {
          setReady(false);
          setStatus(`sidecar が終了しました (exit: ${code ?? "null"})`);
          toast.error(`Claude sidecar が終了しました: ${code ?? "unknown"}`);
        }
      );

      // sidecar 起動
      try {
        await callTauri<void>("start_agent_sidecar");
        if (!cancelled) {
          setReady(true);
          setStatus("Claude と接続中");
          toast.success("Claude と接続しました");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus(`起動失敗: ${String(e)}`);
          toast.error(`sidecar 起動失敗: ${String(e)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenRaw) unlistenRaw();
      if (unlistenStderr) unlistenStderr();
      if (unlistenTerm) unlistenTerm();
      callTauri<void>("stop_agent_sidecar").catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 新メッセージ追加時にスクロール最下部へ
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function handleSidecarEvent(ev: {
    type: string;
    id: string;
    payload: unknown;
  }): void {
    if (ev.type === "ready") {
      // ready 通知（起動確認用）
      return;
    }
    if (ev.type === "message") {
      const text = extractAssistantText(ev.payload);
      if (text) {
        setMessages((prev) => {
          // 同一 id の assistant message は上書き（turn 単位での append 表示）
          const lastIdx = prev.findIndex(
            (m) => m.id === ev.id + ":a" && m.role === "assistant"
          );
          if (lastIdx >= 0) {
            const next = [...prev];
            next[lastIdx] = { ...next[lastIdx], content: text };
            return next;
          }
          return [
            ...prev,
            { id: ev.id + ":a", role: "assistant", content: text },
          ];
        });
      }
      return;
    }
    if (ev.type === "result") {
      setSending(false);
      return;
    }
    if (ev.type === "error") {
      const msg =
        (ev.payload as { message?: string } | undefined)?.message ?? "unknown";
      toast.error(`Claude エラー: ${msg}`);
      setSending(false);
      return;
    }
    if (ev.type === "done") {
      setSending(false);
      return;
    }
  }

  function extractAssistantText(payload: unknown): string {
    const p = payload as {
      type?: string;
      message?: { content?: unknown };
    };
    if (p?.type !== "assistant") return "";
    const content = p.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (b: unknown): b is { type: string; text: string } =>
            typeof b === "object" &&
            b !== null &&
            (b as { type?: string }).type === "text"
        )
        .map((b) => b.text)
        .join("\n");
    }
    return "";
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !ready || sending) return;
    const id = String(Date.now());
    setMessages((prev) => [
      ...prev,
      { id: id + ":u", role: "user", content: text },
    ]);
    setInput("");
    setSending(true);
    try {
      await callTauri<void>("send_agent_prompt", {
        id,
        prompt: text,
      });
    } catch (e) {
      toast.error(`送信失敗: ${String(e)}`);
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <h1 className="text-sm font-medium">ccmux-ide</h1>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {!ready && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {status}
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Sparkles
                className="h-10 w-10 text-muted-foreground"
                aria-hidden
              />
              <p className="text-lg font-medium">
                まだメッセージはありません
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                下の入力欄にメッセージを入力して Claude に話しかけてください。
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) => (
              <Card
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[80%] bg-primary p-3 text-primary-foreground"
                    : "mr-auto max-w-[80%] p-3"
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {m.content}
                </p>
              </Card>
            ))}
            {sending && (
              <Card className="mr-auto max-w-[80%] p-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  考え中...
                </p>
              </Card>
            )}
          </div>
        )}
      </div>

      <footer className="border-t p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              ready ? "メッセージを入力..." : "sidecar 起動を待っています..."
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={!ready || sending}
          />
          <Button
            onClick={handleSend}
            disabled={!ready || sending || !input.trim()}
          >
            送信
          </Button>
        </div>
      </footer>
    </div>
  );
}
