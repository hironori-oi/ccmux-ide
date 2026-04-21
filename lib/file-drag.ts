/**
 * ProjectTree → InputArea のファイルパス Drag & Drop 用ヘルパ
 * （v3.4.7、2026-04-20 新設）。
 *
 * Files タブでファイル/フォルダを掴み → チャット入力欄にドロップで `@"<path>"` 注入。
 * 既存の OS file drop（画像ファイルを attachment として保存）とは MIME type で区別。
 */

/** カスタム MIME: ProjectTree が source のとき dataTransfer にセットする。 */
export const CCMUX_FILE_PATH_MIME = "application/x-ccmux-file-path";

/**
 * `@"<path>"` mention を生成。Claude Code は `@path` を Read tool 自動発火の hint に使う。
 * path にスペースや全角文字が入っていても安全に解釈できるよう二重引用符で囲む。
 */
export function formatFileMention(path: string): string {
  return `@"${path}"`;
}
