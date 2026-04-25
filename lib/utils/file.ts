/**
 * PRJ-012 v1.25.1: ファイルパス系ユーティリティ。
 *
 * Editor pane の Markdown プレビューモード切替（components/editor/EditorPaneItem.tsx）
 * で、拡張子から Markdown ファイルかを判定するために使う pure helper。
 *
 * 判定対象拡張子: `.md` / `.mdx` / `.markdown`（lowercase 比較）。
 */

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

/**
 * 指定パスが Markdown ファイル（.md / .mdx / .markdown）かを判定。
 *
 * - 拡張子は lowercase で比較（`.MD` / `.Mdx` 等も Markdown 扱い）
 * - 空文字列 / 非文字列 / 拡張子なしのパスは false
 * - クエリ / ハッシュは想定しない（ローカルファイルパス前提）
 */
export function isMarkdownPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const idx = path.lastIndexOf(".");
  if (idx < 0) return false;
  const ext = path.slice(idx + 1).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}
