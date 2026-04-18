/**
 * Claude Agent SDK TypeScript wrapper.
 *
 * `@anthropic-ai/claude-agent-sdk` の `query()` を薄くラップして、sidecar から
 * `AsyncIterable<SDKMessage>` として消費できるようにする。
 *
 * DEC-023 で採用した Agent SDK TS 経路。Quick Win 実装（M1 前半）:
 *
 * - `options.apiKey` は存在しない（Options 型にそのフィールドは無い）。
 *   代わりに SDK は自動で以下の順に認証情報を解決する:
 *     1. `ANTHROPIC_API_KEY` 環境変数
 *     2. `~/.claude/.credentials.json`（Claude Code CLI の `claude login` で作成される
 *        OAuth credentials / Max / Pro プランの token）
 *
 * - SDK は内部で `claude` CLI バイナリを subprocess として spawn する。
 *   `pathToClaudeCodeExecutable` / `executable` option で実行系を指定できるが、
 *   PATH 上に `claude` があれば未指定で動作する。オーナー環境（WSL2 / Ubuntu-24.04）
 *   では `claude` v2.1.113 がインストール済。
 */

import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import fs from "node:fs";

/**
 * Claude Code native binary の実パスを解決する。
 *
 * Agent SDK v0.2.114 は platform-specific optional deps
 * `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` として native binary
 * (Linux=`claude` ELF / Windows=`claude.exe` 236MB) を同梱する。
 * esbuild で JS バンドルしてもこの binary は bundle 内に含められないため、
 * packaged app では Tauri resources 経由で sidecar/node_modules に物理配置し、
 * ここで絶対パスを解決して SDK に `pathToClaudeCodeExecutable` で明示渡しする。
 */
function findClaudeExecutable(): string | undefined {
  const platform = process.platform; // "win32" | "darwin" | "linux"
  const arch = process.arch;         // "x64" | "arm64"
  const ext = platform === "win32" ? ".exe" : "";

  const pkgRel = path.join(
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${platform}-${arch}`,
    `claude${ext}`
  );

  // Tauri packaged app では cwd = sidecar_dir (_up_/sidecar/) にしているので
  // cwd 基準で resolve する。
  const candidate = path.join(process.cwd(), pkgRel);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return undefined;
}

export type AgentQueryOptions = Pick<
  Options,
  | "model"
  | "fallbackModel"
  | "cwd"
  | "env"
  | "permissionMode"
  | "allowedTools"
  | "disallowedTools"
  | "maxTurns"
  | "systemPrompt"
  | "pathToClaudeCodeExecutable"
  | "executable"
  | "additionalDirectories"
  | "settingSources"
>;

/**
 * Agent SDK に 1 回の query を投げて、SDK が返すイベントストリームを
 * そのまま yield する。
 *
 * prompt は文字列（one-shot）を想定。streaming input（AsyncIterable<SDKUserMessage>）
 * は PM-113 で対応。
 */
export async function* runAgentQuery(
  prompt: string,
  options: AgentQueryOptions
): AsyncGenerator<SDKMessage, void, unknown> {
  // pathToClaudeCodeExecutable が未指定なら auto-detect して明示設定する。
  // これがないと packaged app で "Native CLI binary for ... not found" エラー。
  const opts: AgentQueryOptions = { ...options };
  if (!opts.pathToClaudeCodeExecutable) {
    const claudePath = findClaudeExecutable();
    if (claudePath) {
      opts.pathToClaudeCodeExecutable = claudePath;
      try {
        process.stderr.write(`AUTO_CLAUDE_PATH: ${claudePath}\n`);
      } catch {}
    } else {
      try {
        process.stderr.write(
          `AUTO_CLAUDE_PATH: not found (cwd=${process.cwd()}, platform=${process.platform}-${process.arch})\n`
        );
      } catch {}
    }
  }

  const stream = query({ prompt, options: opts });
  for await (const ev of stream) {
    yield ev;
  }
}
