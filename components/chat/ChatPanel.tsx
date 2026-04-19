"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { callTauri, onTauriEvent } from "@/lib/tauri-api";
import { useChatStore } from "@/lib/stores/chat";
import { MessageList } from "@/components/chat/MessageList";
import { InputArea } from "@/components/chat/InputArea";
import { ImagePasteZone } from "@/components/chat/ImagePasteZone";

/**
 * PM-132: チャット画面の親コンポーネント。
 *
 * 役割:
 *  1. マウント時に `start_agent_sidecar` を invoke して Node sidecar を起動
 *  2. sidecar の event (`agent:raw` NDJSON / `agent:stderr` / `agent:terminated`)
 *     を購読し、Zustand `useChatStore` のアクションへ dispatch
 *  3. Markdown / ToolUseCard / streaming 表示は子コンポーネントに委譲
 *
 * 既存 `src-tauri/src/commands/agent.rs` は 1 本の `agent:raw` チャネルに NDJSON を
 * 流してくる設計（DEC-023）なので、ここで `{type:"message"|"result"|"error"}` を
 * 振り分ける。Chunk B が event 名を `agent:message` / `agent:tool_use` /
 * `agent:done` に分離したら、下の switch をそれぞれの listener に置換する。
 */
export function ChatPanel() {
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateStreamingMessage = useChatStore((s) => s.updateStreamingMessage);
  const finalizeStreamingMessage = useChatStore(
    (s) => s.finalizeStreamingMessage
  );
  const setStreaming = useChatStore((s) => s.setStreaming);
  const appendToolUse = useChatStore((s) => s.appendToolUse);
  const updateToolUseStatus = useChatStore((s) => s.updateToolUseStatus);
  const messagesSnapshot = useChatStore.getState;

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("起動中...");

  // Week 7 PM-262 / Chunk 3 申し送り: `useChatStore.cwd` が変化したら sidecar を
  // 再起動する。
  //
  // NOTE(M3 緊急対応): 本 useEffect は workspace の無限 render ループ
  // (React error #185) の容疑者として一時 disable。原因切り分け後に再有効化予定。
  // worktree 切替時の sidecar 再起動は WorktreeTabs 側で手動トリガに一本化。
  // const cwd = useChatStore((s) => s.cwd);
  // const prevCwdRef = useRef<string | null>(null);
  // useEffect(() => {
  //   const prev = prevCwdRef.current;
  //   prevCwdRef.current = cwd;
  //   if (prev === cwd) return;
  //   if (prev === null && cwd === null) return;
  //   (async () => {
  //     try { await callTauri<void>("stop_agent_sidecar"); } catch {}
  //     try {
  //       await callTauri<void>("start_agent_sidecar", { cwd: cwd ?? null });
  //       toast.message(cwd ? `cwd を ${cwd} に切替え、sidecar を再起動しました` : "sidecar を再起動しました");
  //     } catch (e) { toast.error(`sidecar 再起動失敗: ${String(e)}`); }
  //   })();
  // }, [cwd]);

  useEffect(() => {
    let unlistenRaw: (() => void) | null = null;
    let unlistenStderr: (() => void) | null = null;
    let unlistenTerm: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      unlistenRaw = await onTauriEvent<string>("agent:raw", (payload) => {
        const lines = payload.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const ev = JSON.parse(line) as SidecarEvent;
            handleSidecarEvent(ev);
          } catch {
            // 行境界またぎや非 JSON は無視
          }
        }
      });

      unlistenStderr = await onTauriEvent<string>("agent:stderr", (payload) => {
        // eslint-disable-next-line no-console
        console.warn("[sidecar stderr]", payload);
        const trimmed = payload.trim();
        if (!trimmed) return;
        if (/ready$|sidecar starting|parent disconnected|stdin closed/i.test(trimmed)) {
          // 起動系 log は toast で軽く通知
          toast.message(`sidecar: ${trimmed.slice(0, 120)}`);
        }
      });

      unlistenTerm = await onTauriEvent<number | null>(
        "agent:terminated",
        (code) => {
          setReady(false);
          setStatus(`sidecar が終了しました (exit: ${code ?? "null"})`);
          setStreaming(false);
          toast.error(`Claude sidecar が終了しました: ${code ?? "unknown"}`);
        }
      );

      try {
        // PRJ-012 Stage 1: TitleBar から選択され localStorage に persist された
        // 作業ディレクトリを初回起動時に反映する。zustand/persist の rehydrate
        // は initial render 前後に同期的に行われるため、ここで getState() 参照
        // すると既に復元済の cwd を取得できる。未設定（null）なら従来通り
        // Rust 側のデフォルト（sidecar_dir）にフォールバック。
        const initialCwd = useChatStore.getState().cwd;
        await callTauri<void>("start_agent_sidecar", {
          cwd: initialCwd ?? null,
        });
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

  /**
   * sidecar NDJSON 1 レコードを store のアクションに dispatch する。
   *
   * Agent SDK の stream JSON 仕様を最低限カバー:
   *  - type="message", payload.type="assistant"                 → text delta / final
   *  - type="message", payload.type="assistant" + tool_use block → tool 開始
   *  - type="message", payload.type="user" + tool_result block   → tool 完了
   *  - type="result"                                             → streaming 完了
   *  - type="error"                                              → streaming 中止
   */
  function handleSidecarEvent(ev: SidecarEvent) {
    if (ev.type === "ready") {
      return;
    }
    if (ev.type === "message") {
      const p = ev.payload as AgentSdkMessage | undefined;
      if (!p) return;

      // Assistant からの返答 message。content は string or block array。
      if (p.type === "assistant" && p.message) {
        const text = extractText(p.message.content);
        const toolUses = extractToolUses(p.message.content);
        const assistantId = `${ev.id}:a`;

        if (text) {
          const existed = messagesSnapshot().messages.find(
            (m) => m.id === assistantId
          );
          if (existed) {
            // 差分を計算して update（Agent SDK は累積 message を送ってくるケースあり）
            const delta = text.slice(existed.content.length);
            if (delta) updateStreamingMessage(assistantId, delta);
          } else {
            appendMessage({
              id: assistantId,
              role: "assistant",
              content: text,
              streaming: true,
            });
          }
        }

        for (const tu of toolUses) {
          const tuId = `${ev.id}:t:${tu.id}`;
          const existed = messagesSnapshot().messages.find((m) => m.id === tuId);
          if (!existed) {
            appendToolUse(tuId, {
              name: tu.name,
              input: tu.input,
              status: "pending",
            });
          }
        }
        return;
      }

      // User role message 内の tool_result ブロック → tool 完了
      if (p.type === "user" && p.message) {
        const results = extractToolResults(p.message.content);
        for (const r of results) {
          const tuId = `${ev.id}:t:${r.tool_use_id}`;
          // 同じ turn id でない場合のために、messages 全探索で tool_use_id 一致を探す
          const match = messagesSnapshot().messages.find(
            (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
          );
          const targetId = match ? match.id : tuId;
          updateToolUseStatus(
            targetId,
            r.is_error ? "error" : "success",
            r.content
          );
        }
        return;
      }
      return;
    }
    if (ev.type === "tool_result") {
      // sidecar が user role message（= SDK が tool 実行後に注入する tool_result
      // ブロック入り message）を独立イベント化して送ってくる。ToolUseCard の
      // status を success / error に遷移させる。
      const p = ev.payload as AgentSdkMessage | undefined;
      if (!p || !p.message) return;
      const results = extractToolResults(p.message.content);
      for (const r of results) {
        const tuId = `${ev.id}:t:${r.tool_use_id}`;
        const match = messagesSnapshot().messages.find(
          (m) => m.toolUse && m.id.endsWith(`:t:${r.tool_use_id}`)
        );
        const targetId = match ? match.id : tuId;
        updateToolUseStatus(
          targetId,
          r.is_error ? "error" : "success",
          r.content
        );
      }
      return;
    }
    if (ev.type === "result") {
      // streaming 終了: 全 assistant messageを finalize
      const ids = messagesSnapshot()
        .messages.filter((m) => m.role === "assistant" && m.streaming)
        .map((m) => m.id);
      ids.forEach(finalizeStreamingMessage);
      setStreaming(false);
      return;
    }
    if (ev.type === "error") {
      const msg =
        (ev.payload as { message?: string } | undefined)?.message ?? "unknown";
      toast.error(`Claude エラー: ${msg}`);
      setStreaming(false);
      return;
    }
    if (ev.type === "done") {
      setStreaming(false);
      return;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-sm font-medium">ccmux-ide</h1>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {!ready && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {status}
        </p>
      </header>
      <MessageList />
      <ImagePasteZone />
      <InputArea />
    </div>
  );
}

// ---------- helpers ----------

interface SidecarEvent {
  type: "ready" | "message" | "tool_result" | "result" | "error" | "done" | "system";
  id: string;
  payload: unknown;
}

interface AgentSdkMessage {
  type: "assistant" | "user" | "system";
  message?: {
    content?: unknown;
  };
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function extractToolUses(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUseBlock[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "tool_use" &&
      typeof (block as { id?: unknown }).id === "string" &&
      typeof (block as { name?: unknown }).name === "string"
    ) {
      const b = block as {
        id: string;
        name: string;
        input?: Record<string, unknown>;
      };
      out.push({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.input ?? {},
      });
    }
  }
  return out;
}

function extractToolResults(content: unknown): Array<{
  tool_use_id: string;
  is_error: boolean;
  content: string;
}> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ tool_use_id: string; is_error: boolean; content: string }> =
    [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as ToolResultBlock).type === "tool_result" &&
      typeof (block as ToolResultBlock).tool_use_id === "string"
    ) {
      const b = block as ToolResultBlock;
      let text = "";
      if (typeof b.content === "string") {
        text = b.content;
      } else if (Array.isArray(b.content)) {
        text = extractText(b.content);
      }
      out.push({
        tool_use_id: b.tool_use_id,
        is_error: Boolean(b.is_error),
        content: text,
      });
    }
  }
  return out;
}
