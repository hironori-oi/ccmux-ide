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
 * PM-900: FTS5 snippet など「truncated JSON fragment」から tool_use の主要情報を
 * 抽出するヘルパ。`parseToolMessageContent` は完全 JSON を前提とするが、snippet は
 * 16 token で切り詰められるため JSON.parse は通らない。そのため正規表現ベースで
 * `"name"` と代表 field (`file_path` / `command` / `pattern` 等) を拾い出す。
 *
 * SearchPalette から tool_use message の構造化プレビューを出す用途に限定する。
 * 見つからなかった field は undefined のまま返し、呼出側で raw snippet 表示に
 * フォールバックする。検索 hit の `[...]` マーカーは field 値にも含まれ得るため、
 * 呼出側は extractToolSnippetInfo から戻った値を HighlightedSnippet に直接渡せる。
 */
export interface ToolSnippetInfo {
  /** tool 名（例: "Edit" / "Bash" / "Read"）。抽出失敗時は undefined */
  name?: string;
  /** 主要 field 1 つ（summarizeInput 相当）。hit marker `[...]` を含み得る */
  preview?: string;
  /** preview がどの field 由来か（UI ラベル用。"file_path" / "command" 等） */
  previewKey?: string;
}

/**
 * tool content の snippet（truncated JSON 文字列）から tool 名と主要 field を
 * 正規表現で抽出する。完全 JSON なら `parseToolMessageContent` 側を優先すべき。
 *
 * 優先順位は `ToolUseCard` の `summarizeInput` と揃える:
 *   file_path → path → command → pattern → query → url → description
 *
 * hit marker `[` / `]` が値の途中に挿入されているケース（FTS5 snippet の仕様）も
 * そのまま preview に残す。呼出側は HighlightedSnippet でそのまま highlight する。
 */
export function extractToolSnippetInfo(snippet: string): ToolSnippetInfo {
  if (!snippet || typeof snippet !== "string") return {};

  const info: ToolSnippetInfo = {};

  // `"name":"Edit"` / `"name": "Bash"` など。hit marker を挟むケース
  //   `"n[ame]":"Edit"` / `"name":"[Edit]"` も許容する。
  const nameMatch = snippet.match(
    /"n\[?a?\]?m?e?\]?"\s*:\s*"([^"\]]*(?:\][^"]*)?[^"]*)"/
  );
  if (nameMatch) {
    // hit marker `[` `]` を剥がして tool 名だけ取り出す。
    const stripped = nameMatch[1].replace(/[[\]]/g, "").trim();
    if (stripped.length > 0) info.name = stripped;
  } else {
    // より緩い fallback: `"name"` の直後に quoted string があれば最初を採用
    const loose = snippet.match(/"name"\s*:\s*"([^"]+)"/);
    if (loose) info.name = loose[1].replace(/[[\]]/g, "").trim() || undefined;
  }

  // summarizeInput と同じ優先順で field を拾う。
  const keys = [
    "file_path",
    "path",
    "command",
    "pattern",
    "query",
    "url",
    "description",
  ];
  for (const key of keys) {
    // value 内に `"` が現れない前提（JSON では escape されている）。
    // 末尾は `"` で閉じる最短マッチ。hit marker `[` / `]` は残す。
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = snippet.match(re);
    if (m && m[1].length > 0) {
      info.preview = m[1];
      info.previewKey = key;
      break;
    }
  }

  return info;
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
