/**
 * PM-831: tool message content / output の安全な JSON parse ヘルパ。
 *
 * # 背景
 * `persistMessageToDb` (lib/stores/chat.ts) は tool role の message を DB へ
 * 保存する際、`{ name, input, status, output }` を `JSON.stringify` した文字列を
 * `content` カラムに入れる。一方 `lib/stores/session.ts` の `toChatMessage` は
 * 復元時に content を素の string として返すだけで、`toolUse` field を組み立て
 * 直さない（store 側の append ロジックを侵さない方針のため）。
 *
 * 結果として、DB から復元された tool message は `MessageList` で
 * `m.role === "tool" && m.toolUse` の分岐に乗らず、`AssistantMessage` に流れて
 * raw JSON 文字列が markdown で表示されてしまう。
 *
 * このモジュールは display 層からのみ使う「読み取り専用の復元」ヘルパ:
 *  - `parseToolMessageContent`: DB content → ToolUseEvent shape
 *  - `tryParseJson`           : tool output が JSON 風の文字列なら parse
 *
 * いずれも失敗時は null を返し、呼出側で raw 表示にフォールバックする。
 */

import type { ToolUseEvent } from "@/lib/stores/chat";

/**
 * persisted tool content (`JSON.stringify({ name, input, status, output })`) を
 * `ToolUseEvent` shape へ復元する。型チェックに失敗 / parse 失敗時は null。
 *
 * 想定する shape:
 * ```json
 * { "name": "Edit", "input": { ... }, "status": "success", "output": "..." | null }
 * ```
 *
 * status が pending/success/error 以外でも success 扱いにフォールバックする
 * （DB から戻ってくる時点で実行終了しているはず、という前提）。
 */
export function parseToolMessageContent(content: string): ToolUseEvent | null {
  if (!content || typeof content !== "string") return null;
  // 最低限の早期 reject。`{` で始まらない content は JSON ではない。
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.name !== "string") return null;
  // input は object 必須（tool 仕様上 0 引数 tool でも `{}`）
  if (typeof obj.input !== "object" || obj.input === null) return null;

  const status: ToolUseEvent["status"] =
    obj.status === "pending" || obj.status === "error"
      ? obj.status
      : "success";

  let output: string | undefined;
  if (typeof obj.output === "string") {
    output = obj.output;
  } else if (obj.output !== null && obj.output !== undefined) {
    // 想定外の型（オブジェクト等）は文字列化して表示する
    try {
      output = JSON.stringify(obj.output);
    } catch {
      output = String(obj.output);
    }
  }

  return {
    name: obj.name,
    input: obj.input as Record<string, unknown>,
    status,
    output,
  };
}

/**
 * 文字列が JSON object / array なら parse して返す。それ以外は null。
 *
 * tool result の `content` は基本 string だが、Bash 等は `{ stdout, stderr,
 * exit_code }` のような JSON 文字列が返ってくることがある。pretty print
 * したいケースを拾うために try parse する。
 */
export function tryParseJson(text: string): unknown | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // object / array リテラルだけを対象に。"true" / "123" などプリミティブは弾く。
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return null;
  try {
    const v = JSON.parse(trimmed);
    if (typeof v === "object" && v !== null) return v;
    return null;
  } catch {
    return null;
  }
}
