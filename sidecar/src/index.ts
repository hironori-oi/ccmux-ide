/**
 * ccmux-ide Node sidecar entrypoint.
 *
 * DEC-023: Claude Agent SDK TypeScript を primary にするため、Tauri 本体（Rust）
 * とは別プロセスの Node.js sidecar として起動する。Tauri 側から stdin/stdout 経由で
 * JSON 行ベースのプロトコルで通信する。
 *
 * プロトコル (line-delimited JSON / NDJSON):
 *
 *   Tauri → sidecar:
 *     { "type": "prompt", "id": "uuid", "prompt": "...", "options": {...} }
 *
 *   sidecar → Tauri:
 *     { "type": "ready",       "id": "ready",  "payload": { "version": "0.1.0" } }
 *     { "type": "message",     "id": "uuid",   "payload": <SDKAssistantMessage> }
 *     { "type": "tool_use",    "id": "uuid",   "payload": { tool_use_id, name, input } }
 *     { "type": "tool_result", "id": "uuid",   "payload": <SDKUserMessage(tool_result)> }
 *     { "type": "system",      "id": "uuid",   "payload": <SDKSystemMessage> }
 *     { "type": "result",      "id": "uuid",   "payload": <SDKResultMessage> }
 *     { "type": "error",       "id": "uuid",   "payload": { message: "..." } }
 *     { "type": "done",        "id": "uuid",   "payload": {} }
 *
 * 認証は SDK 側の auto-detect に委譲:
 *   1. ANTHROPIC_API_KEY 環境変数
 *   2. ~/.claude/.credentials.json（Max / Pro OAuth token）
 */

import { runAgentQuery, type AgentQueryOptions } from "./agent.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// --- crash diagnostics ---
// Tauri spawn 経由で Node.js が uncaught exception crash するケースの診断用。
// stack trace を短く stderr に書き出し、toast 側に流す。
process.on("uncaughtException", (err: Error) => {
  try {
    process.stderr.write(
      `UNCAUGHT: ${err?.stack ? err.stack.split("\n").slice(0, 5).join(" | ") : String(err)}\n`
    );
  } catch {
    // stderr も書けない場合はあきらめ
  }
});
process.on("unhandledRejection", (reason: unknown) => {
  try {
    process.stderr.write(`UNHANDLED_REJECTION: ${String(reason).slice(0, 500)}\n`);
  } catch {}
});
process.on("exit", (code: number) => {
  try {
    process.stderr.write(`EXIT: code=${code}\n`);
  } catch {}
});
// stdout の write 時エラー (EPIPE 等) を握りつぶさず stderr に出す
const __origStdoutWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: typeof __origStdoutWrite }).write = ((
  chunk: string | Uint8Array,
  ...rest: unknown[]
): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return __origStdoutWrite(chunk as any, ...(rest as any[]));
  } catch (err) {
    try {
      process.stderr.write(`STDOUT_WRITE_ERR: ${String(err).slice(0, 300)}\n`);
    } catch {}
    return false;
  }
}) as typeof process.stdout.write;

interface PromptRequest {
  type: "prompt";
  id: string;
  prompt: string;
  options?: AgentQueryOptions;
}

type InboundMessage = PromptRequest;

type OutboundType =
  | "ready"
  | "message"
  | "tool_use"
  | "tool_result"
  | "system"
  | "result"
  | "error"
  | "done";

interface Outbound {
  type: OutboundType;
  id: string;
  payload: unknown;
}

function send(msg: Outbound): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/**
 * SDK の SDKAssistantMessage.message.content に含まれる tool_use ブロックを抽出し、
 * frontend に配信しやすいよう単独イベントとして emit する（オリジナルの assistant
 * message も別途 message イベントで送っているので重複情報だが、UI 側の描画が楽）。
 */
function emitToolUseBlocks(id: string, msg: SDKMessage): void {
  if (msg.type !== "assistant") return;
  // SDK の message 構造は Anthropic SDK の BetaMessage。content は ContentBlock[]。
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b && b.type === "tool_use") {
      send({
        type: "tool_use",
        id,
        payload: { tool_use_id: b.id, name: b.name, input: b.input },
      });
    }
  }
}

async function handlePrompt(req: PromptRequest): Promise<void> {
  try {
    const opts: AgentQueryOptions = {
      model: req.options?.model ?? "claude-opus-4-7",
      cwd: req.options?.cwd ?? process.cwd(),
      permissionMode: req.options?.permissionMode ?? "default",
      allowedTools: req.options?.allowedTools ?? [
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
      ],
      ...req.options,
    };

    for await (const ev of runAgentQuery(req.prompt, opts)) {
      switch (ev.type) {
        case "assistant": {
          send({ type: "message", id: req.id, payload: ev });
          emitToolUseBlocks(req.id, ev);
          break;
        }
        case "user": {
          // tool_result は user message に含まれる（SDK が内部で inject する）
          send({ type: "tool_result", id: req.id, payload: ev });
          break;
        }
        case "result": {
          send({ type: "result", id: req.id, payload: ev });
          break;
        }
        case "system": {
          send({ type: "system", id: req.id, payload: ev });
          break;
        }
        default: {
          // その他（partial_assistant, status, hook_*, auth_status 等）は
          // raw の message イベントとして流す（将来 UI 拡張で利用）
          send({ type: "message", id: req.id, payload: ev });
        }
      }
    }
    send({ type: "done", id: req.id, payload: {} });
  } catch (err) {
    send({
      type: "error",
      id: req.id,
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}

function main(): void {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as InboundMessage;
        if (msg.type === "prompt") {
          // await しない（並列実行可）
          void handlePrompt(msg);
        } else {
          process.stderr.write(
            `sidecar: unknown inbound type: ${JSON.stringify(msg)}\n`
          );
        }
      } catch (e) {
        process.stderr.write(
          `sidecar: failed to parse line: ${line} (${String(e)})\n`
        );
        send({
          type: "error",
          id: "parse",
          payload: { message: String(e) },
        });
      }
    }
  });

  // stdin EOF でも sidecar を即終了しない（Tauri 側の CommandChild.kill() or
  // プロセス親消失まで生きる）。前バージョンは end で exit(0) していたため、
  // Tauri 起動直後に「Claude sidecar が終了しました: 0」が発火していた。
  process.stdin.on("end", () => {
    process.stderr.write("sidecar: stdin closed, keeping process alive\n");
  });

  // keep-alive: Node.js の event loop に active handle を残すため、1 分ごとの
  // no-op interval を登録。これがないと `.on('data')` リスナー登録済でも EOF 後
  // に exit する可能性がある。
  setInterval(() => {
    // no-op heartbeat
  }, 60_000);

  // Tauri (親) が死んだら sidecar も終了する
  process.on("disconnect", () => {
    process.stderr.write("sidecar: parent disconnected, exiting\n");
    process.exit(0);
  });

  // ready 通知
  send({ type: "ready", id: "ready", payload: { version: "0.1.0" } });
  process.stderr.write("ccmux-ide sidecar ready\n");
}

main();
