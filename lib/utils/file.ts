/**
 * PRJ-012 v1.25.1: ファイルパス系ユーティリティ。
 *
 * Editor pane の Markdown プレビューモード切替（components/editor/EditorPaneItem.tsx）
 * で、拡張子から Markdown ファイルかを判定するために使う pure helper。
 *
 * 判定対象拡張子: `.md` / `.mdx` / `.markdown`（lowercase 比較）。
 *
 * v1.25.2 (2026-04-25): 拡張子判定を **path segment 単位** で行うよう堅牢化。
 *   - ディレクトリ名に `.` を含む path（例: `C:\Users\foo.bar\file`）の誤判定を回避
 *   - 末尾の whitespace / `\r` を trim
 *   - URL fragment / query は念のため除去（ローカルパスでは通常出現しないが防御）
 *   - path segment は `/` と `\` 両方で split し、最後の segment の最後の `.` を見る
 */

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

/**
 * 指定パスが Markdown ファイル（.md / .mdx / .markdown）かを判定。
 *
 * - 拡張子は lowercase で比較（`.MD` / `.Mdx` 等も Markdown 扱い）
 * - 空文字列 / 非文字列 / 拡張子なしのパスは false
 * - ディレクトリ名に `.` を含む path（例: `C:\foo.bar\file`）でも、最後の
 *   path segment に `.` が無ければ false（旧実装は誤判定していた）
 * - 末尾 whitespace / `\r` / `\n` は trim、`?` `#` 以降は除去
 */
export function isMarkdownPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;

  // 末尾の whitespace / 改行 / 制御文字を除去（trailing `\r` 等の混入対策）
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;

  // URL fragment / query は除去（ローカルパスでは通常出現しないが防御）
  const beforeQuery = trimmed.split(/[?#]/)[0] ?? "";
  if (beforeQuery.length === 0) return false;

  // path を `/` と `\` の両方で segment 分割し、最後の non-empty segment を取る。
  // 末尾 separator `foo/` の場合は空文字列を捨てて `foo` を見る。
  const segments = beforeQuery.split(/[/\\]/).filter((s) => s.length > 0);
  const filename = segments[segments.length - 1] ?? "";
  if (filename.length === 0) return false;

  const idx = filename.lastIndexOf(".");
  // 拡張子なし、もしくは `.foo` のように先頭が `.` の dotfile（拡張子部 = 空）は false
  if (idx <= 0) return false;
  const ext = filename.slice(idx + 1).toLowerCase();
  if (ext.length === 0) return false;
  return MARKDOWN_EXTENSIONS.has(ext);
}
