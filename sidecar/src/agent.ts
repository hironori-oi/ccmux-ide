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
  const stream = query({ prompt, options });
  for await (const ev of stream) {
    yield ev;
  }
}
