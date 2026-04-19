/**
 * PM-162: ファイルパス拡張子から Monaco エディタ用の言語 ID を推定するユーティリティ。
 *
 * DiffViewer / MemoryEditor など Monaco を利用する箇所から共通で呼び出す。
 * 未知の拡張子、あるいは `filePath` 未指定時は `"plaintext"` を返す。
 */

const EXTENSION_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  md: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  scss: "css",
  html: "html",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  go: "go",
};

/**
 * ファイルパスから Monaco の言語 ID を返す。
 *
 * - 拡張子が見つからない / 未対応 → `"plaintext"`
 * - `filePath` が `undefined` / 空文字 → `"plaintext"`
 */
export function detectLang(filePath: string | undefined): string {
  if (!filePath) return "plaintext";

  // パス区切り文字（`/` `\`）を考慮しつつファイル名部分を抽出
  const baseName = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex <= 0) return "plaintext";

  const ext = baseName.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_LANG_MAP[ext] ?? "plaintext";
}
