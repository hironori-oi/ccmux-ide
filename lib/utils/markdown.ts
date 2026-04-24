/**
 * PRJ-012 v1.15.0 (DEC-061): Chat Markdown 前処理ユーティリティ。
 *
 * 真因分析: Claude の streaming 出力で table 直前の blank line が時折欠落する。
 * GFM parser (remark-gfm) は「直前が空行または他の table 行」でない `|` 行を
 * table として認識しないため、段落と table が連結した 1 枚岩の `<p>` になる。
 *
 * 本 util はその defensive 層として働き、以下の変換を行う。
 *
 * 1. 行頭が `|` の行で、直前行が
 *    - 空行でもなく
 *    - `|` 行でもなく
 *    - コードフェンス内でもない
 *   場合に、その直前に空行を挿入する。
 *
 * 2. コードフェンス (``` や ~~~) 内部は一切変更しない。GFM 仕様と remark-breaks
 *    仕様で fenced code 内は `\n` が保持されるのと整合。
 *
 * ## 例
 *
 * input:
 * ```
 * 以下が結果です。
 * | name | value |
 * | ---- | ----- |
 * | a    | 1     |
 * ```
 *
 * output:
 * ```
 * 以下が結果です。
 *
 * | name | value |
 * | ---- | ----- |
 * | a    | 1     |
 * ```
 *
 * ## 副作用なし
 * - 既に blank line がある場合は何もしない
 * - fenced code 内の `|` 行は触らない
 * - streaming 中の途中状態 (未完成の table) でも壊れない
 */
export function normalizeMarkdownForGfm(source: string): string {
  if (typeof source !== "string" || source.length === 0) return source;

  const lines = source.split("\n");
  const output: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // フェンス開閉検出 (``` or ~~~ で始まる行)
    if (!inFence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      inFence = true;
      fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
      output.push(line);
      continue;
    }
    if (inFence && fenceMarker && trimmed.startsWith(fenceMarker)) {
      inFence = false;
      fenceMarker = null;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }

    // 行頭 `|` + 直前行が非空 かつ `|` 行でもない → blank line を挿入
    if (trimmed.startsWith("|")) {
      const prev = output.length > 0 ? output[output.length - 1] : "";
      const prevTrim = prev.trimStart();
      const prevIsBlank = prev.trim().length === 0;
      const prevIsTable = prevTrim.startsWith("|");
      if (!prevIsBlank && !prevIsTable && output.length > 0) {
        output.push("");
      }
    }

    output.push(line);
  }

  return output.join("\n");
}

// ------------------------------------------------------------------
// 簡易 self-assertion (dev 起動時 / build 時に常に走る軽量チェック)。
// ------------------------------------------------------------------
// 目的: normalizeMarkdownForGfm の典型的な入出力が壊れていないことを保証。
// 本番 bundle でも数百バイトの overhead しかなく、回帰防止のほうが価値が大きい。
// Vitest を導入した際は移植する。
if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
  const cases: Array<[string, string, string]> = [
    [
      "段落の直後に table が来るケース",
      "以下が結果です。\n| a | b |\n| - | - |\n| 1 | 2 |",
      "以下が結果です。\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    ],
    [
      "既に blank line がある場合は変更しない",
      "段落\n\n| a | b |\n| - | - |",
      "段落\n\n| a | b |\n| - | - |",
    ],
    [
      "fenced code 内の `|` 行は触らない",
      "前段落\n```\n| not | table |\n```\n後段落",
      "前段落\n```\n| not | table |\n```\n後段落",
    ],
    [
      "空入力",
      "",
      "",
    ],
  ];
  for (const [label, input, expected] of cases) {
    const actual = normalizeMarkdownForGfm(input);
    if (actual !== expected) {
      // eslint-disable-next-line no-console
      console.warn(
        `[markdown.ts] normalizeMarkdownForGfm self-check failed: ${label}\n` +
          `  input:    ${JSON.stringify(input)}\n` +
          `  expected: ${JSON.stringify(expected)}\n` +
          `  actual:   ${JSON.stringify(actual)}`,
      );
    }
  }
}
